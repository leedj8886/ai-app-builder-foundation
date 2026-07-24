# TypeScript Agent Backend Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 file snapshot slice so agent runs produce structured project snapshots and the v0 workspace can read those snapshots through real APIs.

**Architecture:** Keep Phase 1 queue/run/event infrastructure. Add a durable `ProjectSnapshot` model, deterministic file operation utilities, project snapshot APIs, and a Phase 2 fake worker that writes a snapshot instead of only completing the run. The web app will still use a mock provider for file content, but prompt submit will call the real API and render the returned snapshot.

**Tech Stack:** TypeScript, Express, Mongoose, BullMQ, Redis, React, Axios, Node test runner, Vite.

---

## Scope

This plan implements Phase 2 only:

- `ProjectSnapshot` model with full file tree storage.
- Structured file operation types and deterministic patch application.
- Snapshot APIs under `/api/projects/:projectId/snapshots`.
- `GET /api/agent/runs/:runId` includes `resultSnapshot` when available.
- Worker creates a deterministic snapshot with `file.changed` events and sets `AgentRun.resultSnapshotId`.
- v0 workspace submits prompt through real project/agent APIs and renders snapshot files.

Deferred:

- Real LLM provider and `ModelClient`.
- Validation workspace, type-check/build execution, and repair loop.
- Secure production-grade onboarding/auth UI for v0 workspace.

## Files

- Create: `apps/server/src/models/ProjectSnapshot.ts`
- Create: `apps/server/src/agent/fileOperations.ts`
- Create: `apps/server/src/agent/snapshotGenerator.ts`
- Modify: `apps/server/src/agent/types.ts`
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/agent/orchestrator.test.ts`
- Modify: `apps/server/src/agent/models.test.ts`
- Modify: `apps/server/src/routes/agent.ts`
- Modify: `apps/server/src/routes/project.ts`
- Modify: `apps/web/src/services/api.ts`
- Modify: `apps/web/src/lib/v0Workspace.ts`
- Modify: `apps/web/src/lib/v0Workspace.test.ts`
- Modify: `apps/web/src/pages/V0Clone.tsx`

## Task 1: Snapshot Types And Model

- [ ] **Step 1: Write model tests**

Add assertions to `apps/server/src/agent/models.test.ts` that `ProjectSnapshot` exposes `userId`, `projectId`, `sourceRunId`, `files`, `packageJson`, `validation`, and indexes:

```ts
assert.deepEqual(indexes[0], { projectId: 1, createdAt: -1 });
assert.deepEqual(indexes[1], { userId: 1, createdAt: -1 });
assert.deepEqual(indexes[2], { sourceRunId: 1 });
```

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/models.test.ts
```

Expected: FAIL because `ProjectSnapshot` does not exist.

- [ ] **Step 3: Implement snapshot model and shared types**

Add `ProjectFile`, `ValidationResult`, `ProjectSnapshotPackageJson`, `FileOperation`, and `GenerationResult` to `apps/server/src/agent/types.ts`.

Create `apps/server/src/models/ProjectSnapshot.ts` with:

- embedded `files` array
- embedded `packageJson`
- embedded `validation`
- indexes from Step 1

- [ ] **Step 4: Verify green**

Run the same test command. Expected: PASS.

## Task 2: File Operation Utilities

- [ ] **Step 1: Write file operation tests**

Create `apps/server/src/agent/fileOperations.test.ts` covering:

- create/update/delete operations
- sorted output by path
- language inference for `.ts`, `.tsx`, `.css`, `.json`, `.html`, `.md`
- rejection of absolute paths, `..` escaping, unsupported extensions, and deleting required files

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/fileOperations.test.ts
```

Expected: FAIL because `fileOperations.ts` does not exist.

- [ ] **Step 3: Implement deterministic patch application**

Create `apps/server/src/agent/fileOperations.ts` exporting:

```ts
export const applyFileOperations = (
  baseFiles: ProjectFile[],
  operations: FileOperation[],
  generatedByRunId?: Types.ObjectId
): ProjectFile[];
```

Rules:

- normalize to POSIX relative paths
- reject absolute paths and path traversal
- allow `ts`, `tsx`, `css`, `json`, `html`, `md`
- reject binary-looking content with `\0`
- disallow deleting `package.json`, `index.html`, `src/main.tsx`
- return files sorted by path

- [ ] **Step 4: Verify green**

Run the same test command. Expected: PASS.

## Task 3: Snapshot Generator And Worker

- [ ] **Step 1: Write generator/orchestrator tests**

Extend `apps/server/src/agent/orchestrator.test.ts` or create `snapshotGenerator.test.ts` to assert deterministic Phase 2 generation returns:

- `src/App.tsx`
- `src/main.tsx`
- `src/index.css`
- `package.json`
- `index.html`
- `README.md`

and includes dependencies/scripts in `packageJson`.

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/orchestrator.test.ts
```

Expected: FAIL because Phase 2 snapshot generation is missing.

- [ ] **Step 3: Implement fake Phase 2 snapshot generation**

Create `apps/server/src/agent/snapshotGenerator.ts` with deterministic `buildPhaseTwoGeneration(prompt)` returning structured file operations and package metadata.

Modify `processAgentRun` to:

- load latest base snapshot for the project
- emit `run.started`
- emit `agent.step` for structured file generation
- apply operations
- emit `file.changed` per operation
- create `ProjectSnapshot` with `validation.status = 'skipped'`
- set `run.resultSnapshotId`
- set `run.status = 'completed'`
- emit `run.completed` with `snapshotId`

- [ ] **Step 4: Verify green**

Run the same test command. Expected: PASS.

## Task 4: Snapshot APIs

- [ ] **Step 1: Write API tests**

Extend `apps/server/src/app.test.ts` with unauthenticated checks for:

- `GET /api/projects/:projectId/snapshots` returns `401`
- `GET /api/projects/:projectId/snapshots/:snapshotId` returns `401`

Add unit-level route behavior only if a DB test harness exists later; for now keep model/service tests as the durable coverage.

- [ ] **Step 2: Verify red if route missing**

Run:

```bash
npm run test --workspace @v0/server -- src/app.test.ts
```

Expected: PASS for auth middleware once route is mounted; if it returns `404`, implement route before considering the task complete.

- [ ] **Step 3: Implement project snapshot routes**

Modify `apps/server/src/routes/project.ts`:

- `GET /:id/snapshots`: validate project ownership, list snapshots sorted newest first with compact fields.
- `GET /:id/snapshots/:snapshotId`: validate project ownership and snapshot ownership, return full snapshot.

Modify `apps/server/src/routes/agent.ts`:

- when creating a run, attach latest snapshot as `baseSnapshotId`
- reject `edit` mode when no base snapshot exists
- include `resultSnapshot` in `GET /api/agent/runs/:runId`

- [ ] **Step 4: Verify green**

Run:

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: PASS.

## Task 5: Web Workspace API Integration

- [ ] **Step 1: Write pure web state tests**

Extend `apps/web/src/lib/v0Workspace.test.ts` to cover:

- starting an API-backed generation sets status to `running`
- agent events map to generation steps
- completed snapshot files can be stored in workspace state

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/web -- src/lib/v0Workspace.test.ts
```

Expected: FAIL until state helpers exist.

- [ ] **Step 3: Add web API clients and state helpers**

Modify `apps/web/src/services/api.ts`:

- add `agentApi.createRun`
- add `agentApi.getRun`
- add `projectApi.getSnapshots`
- add `projectApi.getSnapshot`

Modify `apps/web/src/lib/v0Workspace.ts`:

- add `ApiGenerationStatus = 'idle' | 'running' | 'ready' | 'failed'`
- add snapshot file state
- add helpers for starting generation and applying run detail

- [ ] **Step 4: Connect `V0Clone` to real APIs**

Modify `apps/web/src/pages/V0Clone.tsx`:

- ensure a local demo auth token by login/register
- ensure a demo project
- submit prompt with `agentApi.createRun`
- poll `agentApi.getRun` until terminal
- render snapshot file names and selected code when available
- show a visible error when backend/API fails

- [ ] **Step 5: Verify web**

Run:

```bash
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: PASS.

## Task 6: Local E2E Verification

- [ ] **Step 1: Start dependencies**

Run:

```bash
docker compose up -d mongodb redis
```

- [ ] **Step 2: Start API and worker**

Run API:

```bash
MONGODB_URI='mongodb://admin:password@localhost:27017/v0-by-kimi?authSource=admin' \
REDIS_URL='redis://localhost:6379' \
JWT_SECRET='your-super-secret-jwt-key' \
PORT=3001 \
AGENT_QUEUE_NAME='v0-agent-runs' \
npm run dev --workspace @v0/server
```

Run worker:

```bash
MONGODB_URI='mongodb://admin:password@localhost:27017/v0-by-kimi?authSource=admin' \
REDIS_URL='redis://localhost:6379' \
JWT_SECRET='your-super-secret-jwt-key' \
AGENT_QUEUE_NAME='v0-agent-runs' \
npm run worker --workspace @v0/server
```

- [ ] **Step 3: API smoke**

Register/login, create project, create run, wait for completed, and verify:

- response includes `run.resultSnapshotId`
- response includes `resultSnapshot.files`
- events include `file.changed`

- [ ] **Step 4: Browser smoke**

Open the web app, submit a prompt, and verify:

- network calls include `/api/agent/runs`
- UI does not instantly mark ready before API response
- workspace renders snapshot file names/code

## Completion Checklist

- [ ] Server tests pass.
- [ ] Server type-check passes.
- [ ] Server build passes.
- [ ] Web tests pass.
- [ ] Web type-check passes.
- [ ] Web build passes.
- [ ] Local API/worker E2E produces a snapshot.
- [ ] Browser E2E shows snapshot-backed workspace.
