# Create Template and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Create-mode Agent run a complete React Vite baseline and make the frontend show the current planning, generation, validation, repair, and terminal phase.

**Architecture:** A server-owned template module returns fresh required entry files and is used whenever no base snapshot exists, both in model context and validation input. The frontend keeps its existing event stream but advances one active progress step at a time using event type and phase payload mappings.

**Tech Stack:** TypeScript, React, Vite, Node.js test runner, BullMQ, MongoDB, Playwright

---

## File Map

- Create `apps/server/src/agent/projectTemplate.ts`: own the deterministic React Vite Create baseline and snapshot/template selection.
- Create `apps/server/src/agent/projectTemplate.test.ts`: verify required files, fresh values, entry wiring, and preservation of supplied snapshot files.
- Modify `apps/server/src/agent/contextBuilder.ts`: include template files in Create-mode model context when no snapshot exists.
- Modify `apps/server/src/agent/contextBuilder.test.ts`: verify the template can be represented in Agent context without losing required paths.
- Modify `apps/server/src/agent/orchestrator.ts`: validate model operations against template files when no snapshot exists.
- Modify `apps/server/src/agent/orchestrator.test.ts`: prove an App-only model result retains the Vite entry structure.
- Modify `apps/server/src/integration/agentWorker.integration.ts`: prove an App-only Create job receives and persists the server-owned entry files.
- Modify `apps/web/src/lib/v0Workspace.ts`: map real phases and advance the active progress step.
- Modify `apps/web/src/lib/v0Workspace.test.ts`: cover phase labels, active-step progression, deduplication, and terminal states.
- Modify `tests/smoke/workspace.spec.ts` only if an existing assertion depends on the old active-step behavior.

### Task 1: Deterministic React Vite Template

**Files:**
- Create: `apps/server/src/agent/projectTemplate.ts`
- Create: `apps/server/src/agent/projectTemplate.test.ts`

- [ ] **Step 1: Write failing template tests**

Create `apps/server/src/agent/projectTemplate.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProjectTemplateFiles,
  resolveProjectBaseFiles
} from './projectTemplate';

test('createProjectTemplateFiles returns a complete React Vite entry', () => {
  const files = createProjectTemplateFiles();

  assert.deepEqual(files.map(file => file.path), [
    'index.html',
    'src/App.tsx',
    'src/index.css',
    'src/main.tsx'
  ]);
  assert.equal(
    files.find(file => file.path === 'index.html')?.content.includes('/src/main.tsx'),
    true
  );
  assert.equal(
    files.find(file => file.path === 'src/main.tsx')?.content.includes('./App'),
    true
  );
  assert.equal(
    files.find(file => file.path === 'src/main.tsx')?.content.includes('./index.css'),
    true
  );
});

test('createProjectTemplateFiles returns fresh file objects', () => {
  const first = createProjectTemplateFiles();
  const second = createProjectTemplateFiles();

  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.deepEqual(first, second);
});

test('resolveProjectBaseFiles uses a snapshot even when it has no files', () => {
  const emptySnapshotFiles: ReturnType<typeof createProjectTemplateFiles> = [];

  assert.equal(resolveProjectBaseFiles(emptySnapshotFiles), emptySnapshotFiles);
});

test('resolveProjectBaseFiles creates the template only without a snapshot', () => {
  assert.deepEqual(
    resolveProjectBaseFiles(undefined).map(file => file.path),
    ['index.html', 'src/App.tsx', 'src/index.css', 'src/main.tsx']
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test apps/server/src/agent/projectTemplate.test.ts
```

Expected: FAIL because `projectTemplate.ts` does not exist.

- [ ] **Step 3: Implement the template factory**

Create `apps/server/src/agent/projectTemplate.ts`:

```ts
import { ProjectFile } from './types';

export const createProjectTemplateFiles = (): ProjectFile[] => [
  {
    path: 'index.html',
    language: 'html',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  },
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: `export default function App() {
  return <main>Start building your application.</main>;
}
`
  },
  {
    path: 'src/index.css',
    language: 'css',
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #171717;
  background: #ffffff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}
`
  },
  {
    path: 'src/main.tsx',
    language: 'tsx',
    content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
  }
];

export const resolveProjectBaseFiles = (
  snapshotFiles: ProjectFile[] | undefined
): ProjectFile[] => snapshotFiles ?? createProjectTemplateFiles();
```

- [ ] **Step 4: Run focused tests and type-check**

Run:

```bash
node --import tsx --test apps/server/src/agent/projectTemplate.test.ts
npm run type-check --workspace @v0/server
```

Expected: 4 template tests PASS and type-check exits with code 0.

- [ ] **Step 5: Commit the template**

```bash
git add apps/server/src/agent/projectTemplate.ts apps/server/src/agent/projectTemplate.test.ts
git commit -m "feat: add create project template"
```

### Task 2: Create Context and Orchestrator Integration

**Files:**
- Modify: `apps/server/src/agent/contextBuilder.ts`
- Modify: `apps/server/src/agent/contextBuilder.test.ts`
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/agent/orchestrator.test.ts`
- Modify: `apps/server/src/integration/agentWorker.integration.ts`

- [ ] **Step 1: Add a context representation regression test**

Add to `apps/server/src/agent/contextBuilder.test.ts`:

```ts
import { createProjectTemplateFiles } from './projectTemplate';

test('buildAgentContext includes the Create template file contents', () => {
  const templateFiles = createProjectTemplateFiles();
  const context = buildAgentContext({
    ...input,
    mode: 'create',
    files: templateFiles.map(file => ({
      path: file.path,
      content: file.content
    }))
  }, 20_000);

  assert.deepEqual(
    context.files.map(file => file.path),
    ['index.html', 'src/App.tsx', 'src/index.css', 'src/main.tsx']
  );
  assert.equal(
    context.files.find(file => file.path === 'index.html')?.content?.includes('/src/main.tsx'),
    true
  );
});
```

This test documents the context representation and will pass after Task 1. The
RED behavior for automatic fallback is covered by the orchestrator test below,
where the existing Create baseline is empty.

- [ ] **Step 2: Write a failing App-only Create generation test**

Add to `apps/server/src/agent/orchestrator.test.ts`:

```ts
import { createProjectTemplateFiles } from './projectTemplate';

test('Create generation keeps required template files when the model only updates App', async () => {
  const templateFiles = createProjectTemplateFiles();
  const context: AgentContext = {
    prompt: 'Build a contact form',
    mode: 'create',
    project: {
      name: 'Contact',
      framework: 'react',
      styling: 'tailwind',
      uiLibrary: 'none'
    },
    messages: [],
    files: templateFiles.map(file => ({
      path: file.path,
      content: file.content
    }))
  };
  const modelClient: ModelClient = {
    generatePlan: async () => ({
      value: {
        summary: 'Build contact form',
        steps: [{
          title: 'Update App',
          intent: 'Render the form',
          filesLikelyTouched: ['src/App.tsx']
        }],
        assumptions: []
      }
    }),
    generateFiles: async () => ({
      value: {
        message: 'Created contact form',
        operations: [{
          type: 'update',
          path: 'src/App.tsx',
          content: 'export default function App() { return <main>Contact</main>; }'
        }],
        dependencies: {},
        devDependencies: {}
      }
    }),
    repairFiles: async () => {
      throw new Error('repair should not run');
    }
  };

  const result = await runAgentGeneration({
    context,
    baseFiles: templateFiles,
    modelClient,
    onEvent: async () => undefined
  });

  assert.deepEqual(
    result.files.map(file => file.path),
    ['index.html', 'package.json', 'src/App.tsx', 'src/index.css', 'src/main.tsx']
  );
  assert.match(
    result.files.find(file => file.path === 'src/App.tsx')?.content ?? '',
    /Contact/
  );
});
```

- [ ] **Step 3: Write and run a failing Worker integration test**

In `apps/server/src/integration/agentWorker.integration.ts`, add:

```ts
import type { ModelClient } from '../agent/types';
```

Widen the existing `withWorker` parameter from
`ReturnType<typeof createFakeModelClient>` to `ModelClient`, then add:

```ts
test('BullMQ Create run seeds required files when the model only updates App', async () => {
  const { run } = await createQueuedRun();
  const modelClient: ModelClient = {
    generatePlan: async input => {
      assert.deepEqual(
        input.context.files.map(file => file.path),
        ['index.html', 'src/App.tsx', 'src/index.css', 'src/main.tsx']
      );
      return {
        value: {
          summary: 'Build app',
          steps: [{
            title: 'Update App',
            intent: 'Render the app',
            filesLikelyTouched: ['src/App.tsx']
          }],
          assumptions: []
        }
      };
    },
    generateFiles: async () => ({
      value: {
        message: 'Updated App',
        operations: [{
          type: 'update',
          path: 'src/App.tsx',
          content: 'export default function App() { return <main>Real app</main>; }'
        }],
        dependencies: {},
        devDependencies: {}
      }
    }),
    repairFiles: async () => {
      throw new Error('repair should not run');
    }
  };

  await enqueueAgentRun(run._id.toString());
  await withWorker(modelClient, createPassingValidator(), async () => {
    const completed = await waitForTerminalRun(run._id.toString());
    assert.equal(completed.status, 'completed');
  });

  const snapshot = await ProjectSnapshot.findOne({ sourceRunId: run._id });
  assert.deepEqual(
    snapshot?.files.map(file => file.path),
    ['index.html', 'package.json', 'src/App.tsx', 'src/index.css', 'src/main.tsx']
  );
});
```

Run:

```bash
node --import tsx --test --test-concurrency=1 --test-name-pattern="seeds required files" apps/server/src/integration/agentWorker.integration.ts
```

Expected: FAIL because Create context files are empty and the persisted
snapshot lacks the server-owned template files.

- [ ] **Step 4: Wire the template into model context**

In `apps/server/src/agent/contextBuilder.ts`, import:

```ts
import { resolveProjectBaseFiles } from './projectTemplate';
```

After the edit-mode snapshot guard, resolve files:

```ts
const contextFiles = resolveProjectBaseFiles(
  baseSnapshot
    ? baseSnapshot.files.map(file => ({
        path: file.path,
        content: file.content,
        language: file.language
      }))
    : undefined
);
```

Replace the existing `files` expression passed to `buildAgentContext` with:

```ts
files: contextFiles.map(file => ({
  path: file.path,
  content: file.content
}))
```

- [ ] **Step 5: Wire the same baseline into generation and validation**

In `apps/server/src/agent/orchestrator.ts`, import:

```ts
import { resolveProjectBaseFiles } from './projectTemplate';
```

Before calling `runAgentGenerationWithValidation`, add:

```ts
const baseFiles = resolveProjectBaseFiles(
  baseSnapshot
    ? baseSnapshot.files.map(file => ({
        path: file.path,
        content: file.content,
        language: file.language,
        generatedByRunId: file.generatedByRunId
      }))
    : undefined
);
```

Replace:

```ts
baseFiles: baseSnapshot?.files ?? [],
```

with:

```ts
baseFiles,
```

An existing empty snapshot array remains an empty Edit baseline because
`resolveProjectBaseFiles([])` returns the supplied array.

- [ ] **Step 6: Run backend tests, type-check, and build**

Run:

```bash
node --import tsx --test apps/server/src/agent/projectTemplate.test.ts apps/server/src/agent/contextBuilder.test.ts apps/server/src/agent/orchestrator.test.ts
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: focused and full Server tests PASS; type-check and build exit with
code 0.

- [ ] **Step 7: Commit backend integration**

```bash
git add apps/server/src/agent/contextBuilder.ts apps/server/src/agent/contextBuilder.test.ts apps/server/src/agent/orchestrator.ts apps/server/src/agent/orchestrator.test.ts apps/server/src/integration/agentWorker.integration.ts
git commit -m "feat: seed create runs with Vite template"
```

### Task 3: Accurate Frontend Progress

**Files:**
- Modify: `apps/web/src/lib/v0Workspace.ts`
- Modify: `apps/web/src/lib/v0Workspace.test.ts`

- [ ] **Step 1: Write failing phase-label tests**

Add to `apps/web/src/lib/v0Workspace.test.ts`:

```ts
it('maps streamed Agent phases to user-facing progress labels', () => {
  const events = [
    {
      type: 'agent.step',
      message: 'Planning project changes',
      sequence: 2,
      payload: { phase: 'planning' }
    },
    {
      type: 'agent.step',
      message: 'Generating React TypeScript files',
      sequence: 3,
      payload: { phase: 'generating' }
    },
    {
      type: 'validation.started',
      message: 'Validating generated project',
      sequence: 4,
      payload: { phase: 'validating' }
    },
    {
      type: 'repair.started',
      message: 'Repair attempt 1 started',
      sequence: 5,
      payload: { phase: 'repairing', attempt: 1 }
    }
  ];

  const state = events.reduce(
    (current, event) => applyAgentEvent(current, 'run_current', event),
    startApiGeneration(
      createInitialWorkspaceState(),
      'Build a dashboard',
      'run_current'
    )
  );

  assert.deepEqual(
    state.generation.steps.map(step => step.label),
    [
      'Run queued',
      'Planning project changes',
      'Generating application files',
      'Validating generated project',
      'Repairing generated project'
    ]
  );
});
```

- [ ] **Step 2: Write a failing active-step progression test**

Add:

```ts
it('completes the previous active step when progress advances', () => {
  const queued = startApiGeneration(
    createInitialWorkspaceState(),
    'Build a dashboard',
    'run_current'
  );
  const started = applyAgentEvent(queued, 'run_current', {
    type: 'run.started',
    message: 'Agent run started',
    sequence: 2
  });
  const validating = applyAgentEvent(started, 'run_current', {
    type: 'validation.started',
    message: 'Validating generated project',
    sequence: 3,
    payload: { phase: 'validating' }
  });

  assert.deepEqual(
    validating.generation.steps.map(step => step.status),
    ['done', 'done', 'active']
  );
  assert.equal(
    validating.generation.steps.filter(step => step.status === 'active').length,
    1
  );
});
```

- [ ] **Step 3: Run Web tests to verify the new tests fail**

Run:

```bash
npm test --workspace @v0/web
```

Expected: FAIL because phase-specific labels are absent and the initial queued
step remains active.

- [ ] **Step 4: Implement phase-aware labels**

In `apps/web/src/lib/v0Workspace.ts`, extend `eventTypeLabels`:

```ts
const eventTypeLabels: Record<string, string> = {
  'run.created': 'Run queued',
  'run.started': 'Worker started',
  'agent.plan': 'Plan ready',
  'file.changed': 'File changed',
  'validation.started': 'Validating generated project',
  'validation.failed': 'Validation failed',
  'validation.passed': 'Validation passed',
  'repair.started': 'Repairing generated project',
  'run.completed': 'Snapshot ready',
  'run.failed': 'Generation failed',
  'run.cancelled': 'Generation cancelled',
};
```

Add:

```ts
const phaseLabels: Record<string, string> = {
  planning: 'Planning project changes',
  generating: 'Generating application files',
  validating: 'Validating generated project',
  repairing: 'Repairing generated project',
  persisting: 'Saving generated snapshot',
};
```

Resolve the label in `mapEventToStep`:

```ts
const phase = typeof event.payload?.phase === 'string'
  ? event.payload.phase
  : undefined
const label = event.type === 'file.changed'
  ? event.message
  : phase
    ? phaseLabels[phase] ?? event.message
    : eventTypeLabels[event.type] ?? event.message
```

- [ ] **Step 5: Advance exactly one active step**

In `applyAgentEvent`, replace the direct append with:

```ts
const previousSteps = state.generation.steps.map(existing => ({
  ...existing,
  status: existing.status === 'active' ? 'done' as const : existing.status,
}))
```

Return:

```ts
steps: [...previousSteps, step],
```

Keep the existing run-id guard, sequence/type deduplication, terminal status,
and concise failure message logic.

- [ ] **Step 6: Run Web tests, type-check, and build**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all Web tests PASS; type-check and build exit with code 0.

- [ ] **Step 7: Commit frontend progress**

```bash
git add apps/web/src/lib/v0Workspace.ts apps/web/src/lib/v0Workspace.test.ts
git commit -m "fix: show current agent generation phase"
```

### Task 4: Full and Real-Provider Verification

**Files:**
- Modify: `tests/smoke/workspace.spec.ts` only if required by an outdated progress assertion.
- Modify: `docs/superpowers/plans/2026-07-25-create-template-and-progress.md` to record execution results.

- [ ] **Step 1: Run all automated verification**

Run:

```bash
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: Server and Web unit/integration tests PASS; both type-checks and builds
exit with code 0.

- [ ] **Step 2: Run deterministic browser smoke on alternate ports**

The retained real manual stack owns `43001` and `4173`, so run:

```bash
SMOKE_API_PORT=43002 \
SMOKE_API_URL=http://127.0.0.1:43002 \
SMOKE_WEB_PORT=4174 \
SMOKE_WEB_URL=http://127.0.0.1:4174 \
npm run test:smoke
```

Expected: API and Playwright smoke PASS using FakeModelClient.

- [ ] **Step 3: Rebuild the retained real validation stack**

Run:

```bash
docker compose \
  -p phase6-manual \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f work/docker-compose.real-validation.yml \
  up -d --build --force-recreate server worker web
```

Expected: Server, production Worker, and Web start; Worker logs
`Agent worker listening`, not `Smoke agent worker listening`.

- [ ] **Step 4: Submit one real DeepSeek Create run**

From `http://127.0.0.1:4173`, register or log in, enter a new prompt, and submit
it. Verify from persisted events:

- planning and file generation events arrive;
- validation and any repair attempts are shown as the active frontend step;
- the initial Worker waiting step becomes done;
- the Run reaches `completed`, or a genuine generated-code diagnostic is shown;
- the build does not fail solely because `index.html` or `src/main.tsx` is
  missing.

- [ ] **Step 5: Review repository state**

Run:

```bash
git diff --check
git status --short
git log -8 --oneline
```

Expected: no uncommitted production changes, no whitespace errors, and all task
commits are present locally.

- [ ] **Step 6: Complete and commit the plan record**

Mark completed checklist items, add the final test counts and real-run outcome,
then run:

```bash
git add docs/superpowers/plans/2026-07-25-create-template-and-progress.md
git commit -m "docs: complete create template progress plan"
```
