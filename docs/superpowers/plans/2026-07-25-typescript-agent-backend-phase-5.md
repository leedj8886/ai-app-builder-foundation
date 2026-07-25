# TypeScript Agent Backend Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the v0 workspace product loop with cancellation, project run history, snapshot rollback, dependency visibility, and concise validation errors.

**Architecture:** Add a project-level active snapshot pointer rather than cloning snapshots during rollback. Expose ownership-scoped run-history and rollback APIs, then extend the pure workspace state model so the React page can reuse one project, cancel active work, inspect history, activate snapshots, and present validation/dependency metadata without embedding API logic in rendering helpers.

**Tech Stack:** TypeScript, Express, Mongoose, React, Axios, Tailwind CSS, Node test runner, Vite.

---

## Scope

- Cancel the active run from the workspace.
- List recent runs for the current project.
- List snapshots and activate a prior snapshot as the project base.
- Use the active snapshot as the base for future edit runs.
- Mark newly completed snapshots active.
- Display snapshot dependencies and validation status.
- Convert validation failures into concise user-facing diagnostics.
- Reuse one demo project across multiple prompts in the current browser session.

Deferred:

- Cross-device project selection.
- Snapshot deletion or diff visualization.
- Deployment and GitHub integration.
- Production authentication/onboarding redesign.

## File Map

- Modify: `apps/server/src/models/Project.ts` — add `activeSnapshotId`.
- Modify: `apps/server/src/agent/models.test.ts` — model contract test.
- Modify: `apps/server/src/routes/agent.ts` — project run history and active-base selection.
- Modify: `apps/server/src/routes/project.ts` — active snapshot metadata and rollback route.
- Modify: `apps/server/src/agent/orchestrator.ts` — activate successful snapshots.
- Modify: `apps/web/src/services/api.ts` — run history, cancel, snapshot metadata, rollback APIs.
- Modify: `apps/web/src/lib/v0Workspace.ts` — history, snapshot metadata, rollback, cancel, and error state.
- Modify: `apps/web/src/lib/v0Workspace.test.ts` — pure state behavior.
- Modify: `apps/web/src/pages/V0Clone.tsx` — controls and panels.

## Task 1: Active Snapshot Domain

- [x] **Step 1: Write failing model/state tests**

Assert `Project` exposes `activeSnapshotId`. Add pure workspace tests for applying a snapshot with package metadata and marking it active.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/server
npm run test --workspace @v0/web
```

Expected: FAIL because the active snapshot contract and workspace helpers are missing.

- [x] **Step 3: Implement active snapshot data**

Add optional `activeSnapshotId` to Project. Successful agent completion sets it after the run reaches completed. Snapshot list responses include `isActive`; full snapshot responses include package and validation metadata.

- [x] **Step 4: Verify green**

Run Task 1 commands. Expected: PASS.

## Task 2: Run History And Rollback APIs

- [x] **Step 1: Write failing API/schema coverage**

Add unauthenticated route checks for:

```text
GET /api/agent/runs?projectId=<id>
POST /api/projects/:id/snapshots/:snapshotId/rollback
```

Add pure query-schema tests for valid project IDs and limits.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/server
```

Expected: FAIL until routes and schemas exist.

- [x] **Step 3: Implement ownership-scoped APIs**

`GET /api/agent/runs` validates project ownership and returns the newest 30 runs with compact status, prompt, error, timestamps, attempts, and snapshot IDs. Rollback validates project/snapshot ownership and atomically updates `activeSnapshotId`.

- [x] **Step 4: Use the active base**

Run creation uses `Project.activeSnapshotId` when valid, then falls back to the newest passed snapshot. `edit` still fails when no base exists.

- [x] **Step 5: Verify green**

Run server tests, type-check, and build.

## Task 3: Workspace Product State

- [x] **Step 1: Write failing state tests**

Cover:

- cancelled runs map to a cancelled presentation rather than generic failure;
- validation errors prefer the first concise stderr/stdout diagnostic;
- run history is stored newest first;
- snapshot metadata includes dependencies and validation;
- applying rollback replaces the visible file tree and selected file.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/web
```

Expected: FAIL until Phase 5 state helpers and types exist.

- [x] **Step 3: Implement state helpers**

Add `cancelled` generation status, `runHistory`, `snapshots`, package metadata, validation metadata, `applyRunHistory`, `applySnapshotList`, and `applyWorkspaceSnapshot`.

- [x] **Step 4: Verify green**

Run web tests and type-check.

## Task 4: Workspace Interaction

- [x] **Step 1: Extend API clients**

Add `agentApi.cancelRun`, `agentApi.getRuns`, and `projectApi.rollbackSnapshot`. Expand snapshot/run response types.

- [x] **Step 2: Reuse the current project**

Store `projectId` in the page and localStorage. Create/register only when needed. Subsequent prompts use `mode: "edit"` when an active snapshot exists.

- [x] **Step 3: Add product controls**

Add:

- Stop button while running.
- Real recent run list with status labels.
- Snapshot history with active marker and rollback action.
- Dependency list grouped by runtime/dev.
- Passed/failed validation summary.
- Concise validation error card.

- [x] **Step 4: Verify interaction build**

Run web tests, type-check, and build.

## Task 5: Complete Verification

- [x] **Step 1: Run repository checks**

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
git diff --check
```

- [x] **Step 2: Review security and scope**

Verify every history/rollback lookup includes `userId` and `projectId`, rollback cannot reference another project, cancelled runs are not restarted, validation output is summarized rather than dumped, and no deployment behavior was added.

## Completion Checklist

- [x] Active runs can be cancelled from the UI.
- [x] Current-project run history is visible.
- [x] Prior snapshots can become the active project version.
- [x] Future edit runs use the active snapshot.
- [x] Dependencies and validation are visible.
- [x] Validation errors are concise.
- [x] Server and web tests, type-checks, and builds pass.
