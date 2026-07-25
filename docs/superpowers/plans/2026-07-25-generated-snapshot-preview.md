# Generated Snapshot Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workspace's static Preview mock with an isolated Sandpack runtime that executes the active React TypeScript snapshot.

**Architecture:** Convert the persisted `WorkspaceSnapshot` into a validated Sandpack file/dependency model with a pure function, then render that model through a focused iframe-based component. Keep snapshot loading and selection in the existing workspace state so completion, rollback, and reload all drive the same preview path.

**Tech Stack:** React 18, TypeScript, Sandpack React, Node test runner, Playwright, Docker Compose.

---

## Scope

Implement:

- safe deterministic snapshot-to-Sandpack conversion;
- React TypeScript execution inside Sandpack's iframe;
- empty, loading, executable, and conversion-error preview states;
- reload control and snapshot-keyed runtime reset;
- browser smoke assertions inside the generated application's iframe.

Do not implement:

- Vue or Svelte preview;
- generated backend processes;
- shell execution;
- persistent preview deployments or public URLs;
- host credential or API-client injection into generated code.

## File Map

- Create: `apps/web/src/lib/snapshotPreview.ts` — validate and convert a workspace snapshot into Sandpack input.
- Create: `apps/web/src/lib/snapshotPreview.test.ts` — path, entry, dependency, and determinism tests.
- Create: `apps/web/src/components/SnapshotPreview.tsx` — isolated Sandpack provider, preview surface, and reload control.
- Modify: `apps/web/src/pages/V0Clone.tsx` — replace the static template Preview with snapshot-driven states.
- Modify: `tests/smoke/workspace.spec.ts` — verify generated content inside the iframe before and after reload.
- Modify: `apps/server/src/agent/testing/fakeModelClient.ts` — retain a stable preview assertion marker in the smoke-generated app.

## Task 1: Snapshot Preview Conversion

**Files:**

- Create: `apps/web/src/lib/snapshotPreview.test.ts`
- Create: `apps/web/src/lib/snapshotPreview.ts`

- [x] **Step 1: Write failing conversion tests**

Cover these behaviors with real `WorkspaceSnapshot` objects:

```ts
test('converts a React snapshot to deterministic Sandpack input', () => {
  const result = createSnapshotPreviewModel(snapshot({
    files: [
      { path: 'src/App.tsx', content: 'export default function App() {}', language: 'tsx' },
      { path: 'src/main.tsx', content: 'import App from "./App"', language: 'tsx' },
      { path: 'src/index.css', content: 'body {}', language: 'css' },
    ],
    dependencies: { 'lucide-react': '^0.344.0' },
  }));

  assert.equal(result.entry, '/src/main.tsx');
  assert.equal(result.files['/src/App.tsx'], 'export default function App() {}');
  assert.deepEqual(result.dependencies, {
    'lucide-react': '^0.344.0',
    react: '^18.2.0',
    'react-dom': '^18.2.0',
  });
});

test('rejects unsafe unsupported and missing-entry snapshots', () => {
  assert.throws(() => createSnapshotPreviewModel(snapshot({
    files: [{ path: '../secret.ts', content: '', language: 'ts' }],
  })), /Unsafe preview file path/);
  assert.throws(() => createSnapshotPreviewModel(snapshot({
    files: [{ path: 'asset.png', content: '', language: 'png' as never }],
  })), /Unsupported preview file/);
  assert.throws(() => createSnapshotPreviewModel(snapshot({
    files: [{ path: 'src/App.tsx', content: '', language: 'tsx' }],
  })), /Preview entry file is missing/);
});
```

Also verify:

- leading `/` is normalized exactly once;
- duplicate normalized paths are rejected;
- dev dependencies are excluded;
- existing React versions are preserved;
- repeated conversion returns deeply equal output without mutating the snapshot.

- [x] **Step 2: Run tests and verify red**

Run:

```bash
npm run test --workspace @v0/web
```

Expected: FAIL because `snapshotPreview.ts` does not exist.

- [x] **Step 3: Implement the pure preview model**

Create this contract:

```ts
import type { WorkspaceSnapshot } from './v0Workspace';

export interface SnapshotPreviewModel {
  files: Record<string, string>;
  dependencies: Record<string, string>;
  entry: string;
}

export const createSnapshotPreviewModel = (
  snapshot: WorkspaceSnapshot,
): SnapshotPreviewModel;
```

Implementation rules:

- accept only `ts`, `tsx`, `css`, `json`, `html`, and `md`;
- trim paths, convert `src/App.tsx` to `/src/App.tsx`, and preserve already-rooted safe paths;
- reject empty paths, backslashes, `.`/`..` segments, and duplicates;
- require `/src/main.tsx` or `/src/index.tsx`, preferring `/src/main.tsx`;
- copy only `packageJson.dependencies`;
- default missing `react` and `react-dom` to `^18.2.0`;
- sort file and dependency keys for deterministic output.

- [x] **Step 4: Verify green**

Run:

```bash
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
```

Expected: all conversion and existing Web tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/snapshotPreview.ts apps/web/src/lib/snapshotPreview.test.ts
git commit -m "feat: prepare snapshots for isolated preview"
```

## Task 2: Sandpack Runtime Component

**Files:**

- Create: `apps/web/src/components/SnapshotPreview.tsx`
- Modify: `apps/web/src/pages/V0Clone.tsx`

- [x] **Step 1: Add a failing Preview state test**

Extend `snapshotPreview.test.ts` with a pure state selector:

```ts
assert.deepEqual(
  getSnapshotPreviewState(undefined, 'idle'),
  { kind: 'empty' },
);
assert.equal(
  getSnapshotPreviewState(validSnapshot, 'running').kind,
  'running',
);
assert.equal(
  getSnapshotPreviewState(validSnapshot, 'ready').kind,
  'ready',
);
```

The returned `running` state includes the existing preview model so the last
active snapshot remains visible while a new Run executes. Invalid conversion
returns `{ kind: 'error', message }` instead of throwing through React render.

- [x] **Step 2: Run tests and verify red**

Run:

```bash
npm run test --workspace @v0/web
```

Expected: FAIL because `getSnapshotPreviewState` does not exist.

- [x] **Step 3: Implement the state selector**

Add:

```ts
export type SnapshotPreviewState =
  | { kind: 'empty' }
  | { kind: 'running'; model: SnapshotPreviewModel }
  | { kind: 'ready'; model: SnapshotPreviewModel }
  | { kind: 'error'; message: string };

export const getSnapshotPreviewState = (
  snapshot: WorkspaceSnapshot | undefined,
  generationStatus: GenerationStatus,
): SnapshotPreviewState;
```

Use `createSnapshotPreviewModel` inside a `try/catch`. Return only a concise
`Error.message` and never include source contents.

- [x] **Step 4: Create `SnapshotPreview`**

Render:

```tsx
<SandpackProvider
  key={`${snapshotId}:${reloadKey}`}
  template="react-ts"
  files={model.files}
  customSetup={{
    entry: model.entry,
    dependencies: model.dependencies,
  }}
  options={{ activeFile: model.entry }}
>
  <SandpackLayout data-testid="snapshot-preview">
    <SandpackPreview
      showNavigator
      showRefreshButton={false}
      showOpenInCodeSandbox={false}
    />
  </SandpackLayout>
</SandpackProvider>
```

The component owns a numeric `reloadKey`, renders a `Reload preview` button,
uses a minimum iframe height of 620px, and displays a small “Generating a new
version” badge when the state kind is `running`.

- [x] **Step 5: Replace the static Preview panel**

In `V0Clone.tsx`:

- pass `state.snapshot` and `state.generation.status` into `PreviewPanel`;
- render the empty explanation when no snapshot exists;
- render concise conversion errors without hiding other workspace panels;
- render `SnapshotPreview` for `ready` and `running` states;
- remove the fake dashboard, fake `preview.v0.local` URL, template image, and
  mocked Design Mode preview overlay;
- leave the separate Design and Deploy panels unchanged.

- [x] **Step 6: Verify Web**

Run:

```bash
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: tests, type-check, and production build pass.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/snapshotPreview.ts apps/web/src/lib/snapshotPreview.test.ts apps/web/src/components/SnapshotPreview.tsx apps/web/src/pages/V0Clone.tsx
git commit -m "feat: execute active snapshot in preview"
```

## Task 3: Browser End-to-End Preview Verification

**Files:**

- Modify: `apps/server/src/agent/testing/fakeModelClient.ts`
- Modify: `tests/smoke/workspace.spec.ts`

- [x] **Step 1: Write the failing browser assertion**

After the Run reaches `ready`, assert generated content inside the iframe:

```ts
const generatedPreview = page.frameLocator(
  '[data-testid="snapshot-preview"] iframe',
);
await expect(
  generatedPreview.getByTestId('generated-app'),
).toContainText('Generated app', { timeout: 30_000 });
```

After `page.reload()`, wait for the restored snapshot and repeat the iframe
assertion. Keep the existing active-snapshot and code-file assertions.

- [x] **Step 2: Run smoke and verify red**

Run:

```bash
npm run test:smoke
```

Expected: FAIL until the real Preview component is connected to the active
snapshot. The generated Compose project must still be cleaned in `finally`.

- [x] **Step 3: Stabilize the deterministic smoke application**

Keep the fake generated `src/App.tsx` marker:

```tsx
<main data-testid="generated-app">Generated app</main>
```

Do not add preview-only behavior to production model or validator code.

- [x] **Step 4: Verify complete smoke**

Run:

```bash
npm run test:smoke
```

Expected: API smoke passes, Playwright observes `Generated app` inside the
Sandpack iframe before and after reload, and Compose removes only its generated
containers, network, and volume.

- [x] **Step 5: Commit**

```bash
git add apps/server/src/agent/testing/fakeModelClient.ts tests/smoke/workspace.spec.ts
git commit -m "test: verify generated snapshot preview"
```

## Task 4: Complete Verification and Documentation

**Files:**

- Modify: `docs/superpowers/plans/2026-07-25-generated-snapshot-preview.md`

- [x] **Step 1: Run Web regression checks**

```bash
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: zero test failures and successful type-check/build.

- [x] **Step 2: Run Server regression checks**

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: zero test failures and successful type-check/build.

- [x] **Step 3: Run deterministic end-to-end smoke**

```bash
npm run test:smoke
```

Expected: API and browser smoke pass and the generated Compose project is
removed.

- [x] **Step 4: Review isolation**

Confirm:

- generated source appears only in Sandpack file props;
- no token, Axios client, local storage value, or privileged message bridge is
  passed to the iframe;
- no `eval`, `Function`, shell command, or backend preview process was added;
- production Worker does not import smoke collaborators;
- Preview failure cannot mutate Run or snapshot persistence.

- [x] **Step 5: Complete the plan and commit**

Check every box in this plan, then run:

```bash
git diff --check
git status --short
git add docs/superpowers/plans/2026-07-25-generated-snapshot-preview.md
git commit -m "docs: complete generated preview plan"
```
