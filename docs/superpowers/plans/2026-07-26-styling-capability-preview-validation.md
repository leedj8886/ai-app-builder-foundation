# Styling Capability Preview and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Preview and production validation automatically detect the styling technologies used by each Snapshot, compile Tailwind correctly for old and new projects, and reject builds whose styling directives were not applied.

**Architecture:** A pure `StylingCapabilityResolver` derives one or more capabilities from files and package evidence. Small registered adapters augment the in-memory Preview model and validate source/build evidence; Tailwind compatibility is injected only when Tailwind evidence is present, while persisted old Snapshots remain unchanged.

**Tech Stack:** TypeScript, React, Sandpack, Vite, Tailwind CSS 3, PostCSS, Node.js filesystem APIs, Node test runner, Docker Compose, Playwright.

---

## File Responsibility Map

- `apps/server/src/agent/styling/types.ts`: shared styling capability, evidence, issue, and adapter contracts.
- `apps/server/src/agent/styling/resolveCapabilities.ts`: pure evidence-based capability detection.
- `apps/server/src/agent/styling/tailwindAdapter.ts`: Tailwind configuration factories and source/build validation.
- `apps/server/src/agent/styling/registry.ts`: adapter composition without a global styling mode.
- `apps/server/src/agent/styling/buildEvidence.ts`: bounded reading of emitted CSS assets.
- `apps/server/src/agent/projectTemplate.ts`: new-project files, including complete Tailwind/PostCSS configuration.
- `apps/server/src/agent/validator.ts`: invokes styling resolution and adapters around existing validation phases.
- `apps/web/src/lib/stylingCapabilities.ts`: browser-safe resolver and Tailwind Preview augmentation using the same evidence rules.
- `apps/web/src/lib/snapshotPreview.ts`: converts augmented files and dependencies into a Sandpack model.
- `tests/smoke/workspace.spec.ts`: computed-style regression coverage.

The server and browser use equivalent pure evidence rules. Configuration file
contents live in adapter factories, with parity tests preventing the two
runtimes from drifting.

### Task 1: Support JavaScript Configuration Files in Snapshots

**Files:**
- Modify: `apps/server/src/agent/types.ts`
- Modify: `apps/server/src/agent/fileOperations.ts`
- Modify: `apps/server/src/agent/fileOperations.test.ts`
- Modify: `apps/server/src/models/ProjectSnapshot.ts`
- Modify: `apps/web/src/services/api.ts`
- Modify: `apps/web/src/lib/v0Workspace.ts`
- Modify: `apps/web/src/lib/snapshotPreview.ts`
- Modify: `apps/web/src/lib/snapshotPreview.test.ts`

- [ ] **Step 1: Write failing server tests for `.js`, `.cjs`, and `.mjs`**

Add to `fileOperations.test.ts`:

```ts
test('infers supported JavaScript configuration languages', () => {
  assert.equal(inferProjectFileLanguage('tailwind.config.js'), 'js');
  assert.equal(inferProjectFileLanguage('postcss.config.cjs'), 'js');
  assert.equal(inferProjectFileLanguage('vite.config.mjs'), 'js');
});
```

- [ ] **Step 2: Write a failing Preview conversion test**

Add a Snapshot containing `tailwind.config.js` and `postcss.config.cjs` and
assert:

```ts
const model = createSnapshotPreviewModel(snapshot);
assert.equal(model.files['/tailwind.config.js'], tailwindConfig);
assert.equal(model.files['/postcss.config.cjs'], postcssConfig);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --import tsx --test apps/server/src/agent/fileOperations.test.ts
node --import tsx --test apps/web/src/lib/snapshotPreview.test.ts
```

Expected: server rejects the extensions and Preview reports unsupported files.

- [ ] **Step 4: Add the `js` language and supported extensions**

Change the shared server language list to:

```ts
export const projectFileLanguages = [
  'ts', 'tsx', 'js', 'css', 'json', 'html', 'md'
] as const;
```

Map `.js`, `.cjs`, and `.mjs` to `js` in `fileOperations.ts`. Add `js` to the
Snapshot Mongoose enum through the shared list, the API types, workspace types,
and Preview supported-language set.

- [ ] **Step 5: Run tests and type-check**

```bash
node --import tsx --test apps/server/src/agent/fileOperations.test.ts
node --import tsx --test apps/web/src/lib/snapshotPreview.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/types.ts \
  apps/server/src/agent/fileOperations.ts \
  apps/server/src/agent/fileOperations.test.ts \
  apps/server/src/models/ProjectSnapshot.ts \
  apps/web/src/services/api.ts \
  apps/web/src/lib/v0Workspace.ts \
  apps/web/src/lib/snapshotPreview.ts \
  apps/web/src/lib/snapshotPreview.test.ts
git commit -m "feat: support JavaScript project configuration files"
```

### Task 2: Resolve Styling Capabilities from Project Evidence

**Files:**
- Create: `apps/server/src/agent/styling/types.ts`
- Create: `apps/server/src/agent/styling/resolveCapabilities.ts`
- Create: `apps/server/src/agent/styling/resolveCapabilities.test.ts`

- [ ] **Step 1: Define failing resolver scenarios**

Create tests using small `ProjectFile[]` fixtures:

```ts
test('detects Tailwind from directives and dependencies', () => {
  const result = resolveStylingCapabilities(files({
    'package.json': JSON.stringify({
      devDependencies: { tailwindcss: '^3.4.17' }
    }),
    'src/index.css': '@tailwind base;\\n@tailwind utilities;'
  }));
  assert.deepEqual(result.capabilities, ['plain-css', 'tailwind']);
  assert.match(result.evidence.tailwind!.join(' '), /@tailwind/);
});

test('supports mixed Tailwind and CSS Modules', () => {
  const result = resolveStylingCapabilities(files({
    'package.json': JSON.stringify({
      devDependencies: { tailwindcss: '^3.4.17' }
    }),
    'src/index.css': '@tailwind utilities;',
    'src/Card.module.css': '.card { display: grid; }'
  }));
  assert.deepEqual(result.capabilities, [
    'plain-css', 'tailwind', 'css-modules'
  ]);
});

test('does not infer Tailwind from className alone', () => {
  const result = resolveStylingCapabilities(files({
    'src/App.tsx': '<div className="card primary" />'
  }));
  assert.deepEqual(result.capabilities, ['plain-css']);
});
```

Also cover styled-components imports and metadata/source conflict.

- [ ] **Step 2: Run the new test and verify RED**

```bash
node --import tsx --test \
  apps/server/src/agent/styling/resolveCapabilities.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define focused contracts**

Create:

```ts
export type StylingCapability =
  | 'plain-css'
  | 'tailwind'
  | 'css-modules'
  | 'styled-components';

export interface StylingIssue {
  capability: StylingCapability;
  code:
    | 'MISSING_DEPENDENCY'
    | 'MISSING_CONFIGURATION'
    | 'MISSING_ENTRY_IMPORT'
    | 'UNEXPANDED_DIRECTIVE'
    | 'MISSING_BUILD_OUTPUT';
  phase: 'source-contract' | 'build-evidence';
  message: string;
  file?: string;
  previewRecoverable: boolean;
}

export interface StylingResolution {
  capabilities: StylingCapability[];
  evidence: Partial<Record<StylingCapability, string[]>>;
  issues: StylingIssue[];
}
```

- [ ] **Step 4: Implement deterministic evidence resolution**

Use sorted file paths and capability order. Tailwind requires at least one
strong signal: a Tailwind dependency, an `@tailwind` directive, or a Tailwind
configuration file. CSS Modules use `*.module.css`; styled-components uses its
dependency or imports; any `.css` file enables plain CSS.

Accept an optional metadata hint:

```ts
export const resolveStylingCapabilities = (
  files: ProjectFile[],
  hint?: string
): StylingResolution
```

Record the hint as evidence but never remove capabilities established by files.

- [ ] **Step 5: Run tests and type-check**

```bash
node --import tsx --test \
  apps/server/src/agent/styling/resolveCapabilities.test.ts
npm run type-check --workspace @v0/server
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/styling
git commit -m "feat: infer styling capabilities from project evidence"
```

### Task 3: Implement Tailwind Adapter Contracts

**Files:**
- Create: `apps/server/src/agent/styling/tailwindAdapter.ts`
- Create: `apps/server/src/agent/styling/tailwindAdapter.test.ts`
- Create: `apps/server/src/agent/styling/registry.ts`
- Create: `apps/server/src/agent/styling/registry.test.ts`

- [ ] **Step 1: Write failing Tailwind source-contract tests**

Assert the adapter reports:

```ts
assert.deepEqual(
  adapter.validateSource(filesWithDirectivesButNoConfig).map(x => x.code),
  ['MISSING_CONFIGURATION']
);
assert.deepEqual(
  adapter.validateSource(filesWithCssNotImported).map(x => x.code),
  ['MISSING_ENTRY_IMPORT']
);
```

Assert a complete Tailwind project has no source issues.

- [ ] **Step 2: Write failing configuration factory tests**

```ts
const compatibility = adapter.previewCompatibility(oldSnapshotFiles);
assert.equal(
  compatibility.files['postcss.config.cjs'],
  `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\\n`
);
assert.match(
  compatibility.files['tailwind.config.js'],
  /\\.\\/src\\/\\*\\*\\/\\*\\.\\{js,ts,jsx,tsx\\}/
);
assert.equal(compatibility.dependencies.tailwindcss, '^3.4.17');
```

- [ ] **Step 3: Run tests and verify RED**

```bash
node --import tsx --test \
  apps/server/src/agent/styling/tailwindAdapter.test.ts \
  apps/server/src/agent/styling/registry.test.ts
```

Expected: FAIL because adapters are missing.

- [ ] **Step 4: Implement the Tailwind adapter**

Export constants and pure factories:

```ts
export const tailwindVersions = {
  tailwindcss: '^3.4.17',
  postcss: '^8.4.49',
  autoprefixer: '^10.4.20'
} as const;

export const createTailwindConfig = (): string =>
  `/** @type {import('tailwindcss').Config} */\n` +
  `module.exports = {\n` +
  `  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n` +
  `  theme: { extend: {} },\n` +
  `  plugins: []\n` +
  `};\n`;

export const createPostcssConfig = (): string =>
  `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`;
```

`previewCompatibility` adds only missing configuration files and dependencies.
It must clone outputs and never mutate its input.

- [ ] **Step 5: Implement adapter composition**

The registry API is:

```ts
export interface StylingAdapter {
  capability: StylingCapability;
  validateSource(files: ProjectFile[]): StylingIssue[];
  validateBuild?(input: {
    files: ProjectFile[];
    cssAssets: Array<{ path: string; content: string }>;
  }): StylingIssue[];
}

export const adaptersFor = (
  resolution: StylingResolution
): StylingAdapter[]
```

Register plain CSS, Tailwind, CSS Modules, and styled-components. Non-Tailwind
adapters do not add Tailwind files or assertions.

- [ ] **Step 6: Run tests and commit**

```bash
node --import tsx --test apps/server/src/agent/styling/*.test.ts
npm run type-check --workspace @v0/server
git add apps/server/src/agent/styling
git commit -m "feat: define composable styling adapters"
```

### Task 4: Add Backward-compatible Preview Augmentation

**Files:**
- Create: `apps/web/src/lib/stylingCapabilities.ts`
- Create: `apps/web/src/lib/stylingCapabilities.test.ts`
- Modify: `apps/web/src/lib/snapshotPreview.ts`
- Modify: `apps/web/src/lib/snapshotPreview.test.ts`

- [ ] **Step 1: Add a failing regression fixture**

Build a Snapshot equivalent to `6a657633a57f5bdf2acfccd0`: it contains
`bg-blue-100`, Tailwind directives, and Tailwind devDependencies, but no config.

Assert:

```ts
const before = structuredClone(snapshot);
const model = createSnapshotPreviewModel(snapshot);

assert.match(model.files['/tailwind.config.js'], /src\\/\\*\\*/);
assert.match(model.files['/postcss.config.cjs'], /tailwindcss/);
assert.equal(model.dependencies.tailwindcss, '^3.4.17');
assert.deepEqual(snapshot, before);
```

Add a plain-CSS fixture and assert no Tailwind files or dependency are added.

- [ ] **Step 2: Run the Preview tests and verify RED**

```bash
node --import tsx --test \
  apps/web/src/lib/stylingCapabilities.test.ts \
  apps/web/src/lib/snapshotPreview.test.ts
```

Expected: missing generated config and dependency assertions fail.

- [ ] **Step 3: Implement browser-safe capability resolution**

Create pure helpers operating on `WorkspaceSnapshot` files. Match the server
strong-evidence rules and export:

```ts
export const augmentPreviewStyling = (
  files: Record<string, string>,
  packageJson: WorkspaceSnapshot['packageJson']
): {
  files: Record<string, string>;
  dependencies: Record<string, string>;
  capabilities: StylingCapability[];
}
```

Tailwind augmentation adds configuration only when strong Tailwind evidence is
present. Merge both package dependency maps with adapter-required dependencies
for Sandpack.

- [ ] **Step 4: Integrate augmentation into Preview conversion**

In `createSnapshotPreviewModel`, normalize Snapshot files first, call
`augmentPreviewStyling`, then return the augmented files/dependencies. Preserve
deterministic sorting and existing path-safety checks.

- [ ] **Step 5: Run tests, type-check, and commit**

```bash
node --import tsx --test apps/web/src/lib/*.test.ts
npm run type-check --workspace @v0/web
git add apps/web/src/lib/stylingCapabilities.ts \
  apps/web/src/lib/stylingCapabilities.test.ts \
  apps/web/src/lib/snapshotPreview.ts \
  apps/web/src/lib/snapshotPreview.test.ts
git commit -m "fix: compile styling capabilities in snapshot preview"
```

### Task 5: Generate Complete Tailwind Projects

**Files:**
- Modify: `apps/server/src/agent/projectTemplate.ts`
- Modify: `apps/server/src/agent/projectTemplate.test.ts`
- Modify: `apps/server/src/agent/dependencies.ts`
- Modify: `apps/server/src/agent/dependencies.test.ts`
- Modify: `apps/server/src/agent/fileOperations.ts`
- Modify: `apps/server/src/agent/fileOperations.test.ts`

- [ ] **Step 1: Write failing template tests**

Assert new template files contain:

```ts
assert.equal(byPath.has('tailwind.config.js'), true);
assert.equal(byPath.has('postcss.config.cjs'), true);
assert.match(byPath.get('src/index.css')!.content, /@tailwind utilities/);
assert.match(byPath.get('src/main.tsx')!.content, /import '.\\/index.css'/);
```

Assert required template configuration cannot be deleted by generated file
operations.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --import tsx --test \
  apps/server/src/agent/projectTemplate.test.ts \
  apps/server/src/agent/dependencies.test.ts \
  apps/server/src/agent/fileOperations.test.ts
```

Expected: config files are absent and deletion protection fails.

- [ ] **Step 3: Use adapter factories in the template**

Add `tailwind.config.js` and `postcss.config.cjs` using the Tailwind adapter
factories. Keep configuration contents centralized; do not copy literal config
strings into `projectTemplate.ts`.

Keep Tailwind/PostCSS dependencies in `devDependencies` for production
workspaces. Add both configuration files to `requiredTemplateFiles`.

- [ ] **Step 4: Run tests and commit**

```bash
node --import tsx --test \
  apps/server/src/agent/projectTemplate.test.ts \
  apps/server/src/agent/dependencies.test.ts \
  apps/server/src/agent/fileOperations.test.ts
npm run type-check --workspace @v0/server
git add apps/server/src/agent/projectTemplate.ts \
  apps/server/src/agent/projectTemplate.test.ts \
  apps/server/src/agent/dependencies.ts \
  apps/server/src/agent/dependencies.test.ts \
  apps/server/src/agent/fileOperations.ts \
  apps/server/src/agent/fileOperations.test.ts
git commit -m "feat: generate complete Tailwind project configuration"
```

### Task 6: Validate Styling Source and Build Evidence

**Files:**
- Create: `apps/server/src/agent/styling/buildEvidence.ts`
- Create: `apps/server/src/agent/styling/buildEvidence.test.ts`
- Modify: `apps/server/src/agent/styling/tailwindAdapter.ts`
- Modify: `apps/server/src/agent/styling/tailwindAdapter.test.ts`
- Modify: `apps/server/src/agent/types.ts`
- Modify: `apps/server/src/agent/validator.ts`
- Modify: `apps/server/src/agent/validator.test.ts`
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/agent/orchestrator.test.ts`

- [ ] **Step 1: Write failing emitted-CSS reader tests**

Create temporary `dist/assets/*.css` fixtures and assert:

```ts
const assets = await readCssBuildEvidence({
  workspacePath,
  maxChars: 200_000
});
assert.deepEqual(assets.map(asset => asset.path), [
  'dist/assets/index.css'
]);
assert.match(assets[0]!.content, /bg-blue-100/);
```

Also verify path sorting, output bounding, and an empty result when `dist` has no
CSS.

- [ ] **Step 2: Write failing Tailwind build-evidence tests**

Cover:

```ts
assert.equal(
  adapter.validateBuild({
    files: tailwindFiles,
    cssAssets: [{ path: 'dist/app.css', content: '@tailwind utilities;' }]
  })[0]?.code,
  'UNEXPANDED_DIRECTIVE'
);

assert.deepEqual(
  adapter.validateBuild({
    files: appUsingBlue100,
    cssAssets: [{
      path: 'dist/app.css',
      content: '.bg-blue-100{background-color:rgb(219 234 254)}'
    }]
  }),
  []
);
```

- [ ] **Step 3: Write failing validator orchestration tests**

Assert source styling issues stop before npm, and build-evidence issues turn an
otherwise successful build into:

```ts
{
  status: 'failed',
  category: 'STYLING_CONFIGURATION_ERROR',
  retryable: false
}
```

Assert the orchestrator routes this category through code repair, not dependency
or infrastructure retry.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
node --import tsx --test \
  apps/server/src/agent/styling/buildEvidence.test.ts \
  apps/server/src/agent/styling/tailwindAdapter.test.ts \
  apps/server/src/agent/validator.test.ts \
  apps/server/src/agent/orchestrator.test.ts
```

Expected: new evidence/category behavior is missing.

- [ ] **Step 5: Implement bounded CSS evidence reading**

Walk only `dist`, accept only regular `.css` files, sort paths, and stop reading
after the configured character budget. Do not follow symlinks.

- [ ] **Step 6: Add the structured styling category**

Extend:

```ts
export type ValidationErrorCategory =
  | 'CODE_ERROR'
  | 'DEPENDENCY_ERROR'
  | 'INFRA_ERROR'
  | 'STYLING_CONFIGURATION_ERROR';
```

Represent adapter issues in a failed `ValidationCheckResult` with phase
`structure` for source-contract failures or `build` for emitted-CSS failures.
Store sanitized issue data in the existing validation details.

- [ ] **Step 7: Integrate adapters into validation**

Before dependency preparation:

```ts
const resolution = resolveStylingCapabilities(input.files);
const adapters = adaptersFor(resolution);
const sourceIssues = adapters.flatMap(adapter =>
  adapter.validateSource(input.files)
);
```

After a successful build, read CSS evidence from `workspace.path` and run every
adapter's `validateBuild`. Styling failures are non-retryable and must leave
workspace cleanup in the existing `finally`.

- [ ] **Step 8: Route styling repair**

In orchestration, treat `STYLING_CONFIGURATION_ERROR` as an actionable source
repair. The repair prompt receives the structured issue but secrets, absolute
workspace paths, and emitted CSS contents remain excluded.

- [ ] **Step 9: Run tests, type-check, and commit**

```bash
node --import tsx --test apps/server/src/agent/styling/*.test.ts
node --import tsx --test \
  apps/server/src/agent/validator.test.ts \
  apps/server/src/agent/orchestrator.test.ts
npm run type-check --workspace @v0/server
git add apps/server/src/agent/styling \
  apps/server/src/agent/types.ts \
  apps/server/src/agent/validator.ts \
  apps/server/src/agent/validator.test.ts \
  apps/server/src/agent/orchestrator.ts \
  apps/server/src/agent/orchestrator.test.ts
git commit -m "feat: reject ineffective styling builds"
```

### Task 7: Expose Styling Diagnostics in Timeline and Preview

**Files:**
- Modify: `apps/web/src/services/api.ts`
- Modify: `apps/web/src/lib/v0Workspace.ts`
- Modify: `apps/web/src/lib/v0Workspace.test.ts`
- Modify: `apps/web/src/lib/chatTimeline.ts`
- Modify: `apps/web/src/lib/chatTimeline.test.ts`
- Modify: `apps/web/src/components/ConversationTimeline.tsx`

- [ ] **Step 1: Write failing diagnostic presentation tests**

Assert a failed validation check with category
`STYLING_CONFIGURATION_ERROR` produces:

```ts
assert.equal(
  validationEventLabel(stylingFailure),
  '样式构建未生效 · Tailwind 指令未展开'
);
```

Assert workspace error selection prefers the sanitized styling issue over raw
build output.

- [ ] **Step 2: Run web tests and verify RED**

```bash
node --import tsx --test \
  apps/web/src/lib/chatTimeline.test.ts \
  apps/web/src/lib/v0Workspace.test.ts
```

Expected: category is unknown or displays a generic validation failure.

- [ ] **Step 3: Extend API types and labels**

Add `STYLING_CONFIGURATION_ERROR` to validation category unions. Map structured
issue codes to concise Chinese labels. Keep raw CSS and command output out of
the timeline.

- [ ] **Step 4: Render a distinct actionable failure**

Use the existing danger state and display the affected file when supplied.
Do not show the “重新验证” button because this is deterministic and
non-retryable; normal code repair/regeneration remains available.

- [ ] **Step 5: Run tests, type-check, and commit**

```bash
node --import tsx --test apps/web/src/**/*.test.ts
npm run type-check --workspace @v0/web
git add apps/web/src/services/api.ts \
  apps/web/src/lib/v0Workspace.ts \
  apps/web/src/lib/v0Workspace.test.ts \
  apps/web/src/lib/chatTimeline.ts \
  apps/web/src/lib/chatTimeline.test.ts \
  apps/web/src/components/ConversationTimeline.tsx
git commit -m "feat: explain styling validation failures"
```

### Task 8: Add Computed-style End-to-end Regression Coverage

**Files:**
- Create: `apps/server/src/testing/seedLegacyStylingSmoke.ts`
- Modify: `tests/smoke/run-smoke.ts`
- Modify: `tests/smoke/api-smoke.ts`
- Modify: `tests/smoke/workspace.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Create a deterministic old-Snapshot seed**

Create `seedLegacyStylingSmoke.ts` using the existing Mongoose models. In the
fresh Smoke database, create a fixed user, project, Chat, completed Run, active
Snapshot, and assistant message. The Snapshot contains:

```tsx
<main
  data-testid="tailwind-background"
  className="min-h-screen bg-blue-100"
>
  Generated app
</main>
```

Include Tailwind directives and development dependencies but omit
`tailwind.config.js` and `postcss.config.cjs`. Use deterministic ObjectIds and
credentials exported by the module:

```ts
export const legacyStylingSmoke = {
  email: 'legacy-styling@v0.local',
  password: 'legacy-styling-password',
  chatId: '64b7f5086f1f8e9f0f000101'
} as const;
```

The script must refuse to run unless `SMOKE_LEGACY_STYLING_SEED=true`.

- [ ] **Step 2: Seed before browser Smoke**

After API Smoke and before Playwright, make `run-smoke.ts` execute:

```bash
docker compose ... exec -T \
  -e SMOKE_LEGACY_STYLING_SEED=true \
  server node dist/testing/seedLegacyStylingSmoke.js
```

Use the current Compose project name and files already held by `run-smoke.ts`.
Expected output: one JSON line containing `{"seeded":true}`.

- [ ] **Step 3: Add API Smoke assertions for new projects**

For the normal generated Smoke project, assert validation contains no styling
error and the new persisted Snapshot includes complete configuration:

```ts
assert.ok(snapshot.files.some(file => file.path === 'tailwind.config.js'));
assert.ok(snapshot.files.some(file => file.path === 'postcss.config.cjs'));
```

- [ ] **Step 4: Open the seeded legacy Snapshot in Playwright**

At the start of a dedicated test, call `/api/auth/login` with the fixed seed
credentials, set the returned token in `localStorage`, and navigate to:

```ts
await page.goto(`/v0/chats/${legacyStylingSmoke.chatId}`);
```

Assert Code does not list either injected configuration file, proving persisted
Snapshot files remain unchanged.

- [ ] **Step 5: Add the browser computed-style assertion**

Use the Preview iframe:

```ts
const generatedPreview = page.frameLocator(
  '[data-testid="snapshot-preview"] iframe'
);
const background = generatedPreview.getByTestId('tailwind-background');
await expect(background).toHaveCSS(
  'background-color',
  'rgb(219, 234, 254)'
);
```

This assertion must fail if the class exists but Tailwind was not compiled.

- [ ] **Step 6: Document automatic capability behavior**

Document that styling is inferred from files/dependencies, metadata is a weak
hint, old Snapshot compatibility is Preview-only, and production validation
checks emitted CSS.

- [ ] **Step 7: Run complete verification**

```bash
# Use a Node.js 20+ runtime available on PATH.
npm test --workspace @v0/server
npm test --workspace @v0/web
TESTCONTAINERS_RYUK_DISABLED=true \
  npm run test:integration --workspace @v0/server
npm run type-check
npm run build
SMOKE_API_PORT=43101 \
SMOKE_WEB_PORT=4183 \
SMOKE_API_URL=http://127.0.0.1:43101 \
SMOKE_WEB_URL=http://127.0.0.1:4183 \
  npm run test:smoke
```

Expected: all unit and integration tests pass; production builds pass; API
Smoke passes; Playwright confirms the computed shallow-blue background.

- [ ] **Step 8: Inspect cleanup and security evidence**

Confirm:

- temporary validation workspaces are removed;
- Preview compatibility files were not persisted;
- Docker Smoke containers and volumes were removed;
- emitted CSS contents, proxy values, registry credentials, and filesystem
  paths do not appear in public events.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/testing/seedLegacyStylingSmoke.ts \
  tests/smoke/run-smoke.ts \
  tests/smoke/api-smoke.ts \
  tests/smoke/workspace.spec.ts \
  README.md
git commit -m "test: verify styling capability compilation"
```

## Final Acceptance Checklist

- [ ] Snapshot `6a657633a57f5bdf2acfccd0` has an equivalent automated regression fixture.
- [ ] `bg-blue-100` produces computed color `rgb(219, 234, 254)` in Preview.
- [ ] Old persisted Snapshots are not modified by compatibility augmentation.
- [ ] New Tailwind templates contain complete Tailwind/PostCSS configuration.
- [ ] Plain CSS, CSS Modules, and styled-components do not receive Tailwind injection.
- [ ] Mixed styling capabilities activate multiple adapters.
- [ ] Metadata conflicts do not override stronger source/package evidence.
- [ ] Unexpanded Tailwind directives fail validation despite Vite exit code zero.
- [ ] Styling failures are actionable, sanitized, and non-retryable.
- [ ] Preview, production build, and validation use compatible adapter contracts.
