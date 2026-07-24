# TypeScript Agent Backend Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate generated React projects in isolated temporary workspaces and repair failed candidates up to the run's configured repair limit.

**Architecture:** Materialize each candidate file tree under the configured workspace root, install declared packages with lifecycle scripts disabled, and invoke fixed npm scripts without a shell. Keep workspace creation, command execution, validation, and repair orchestration behind focused interfaces so tests use temporary directories and fake runners/model clients rather than network access.

**Tech Stack:** TypeScript, Node.js filesystem/process APIs, OpenAI Node SDK, Zod, Mongoose, Node test runner.

---

## Scope

Phase 4 includes:

- Safe temporary workspace creation and guaranteed cleanup.
- Fixed `npm install --ignore-scripts`, `npm run type-check`, and `npm run build` execution.
- Command timeouts, bounded output capture, and minimal child-process environment.
- Validation results persisted only with successful snapshots.
- `repairFiles` on `ModelClient`, with structured output validation.
- Validation/repair state transitions and events.
- At most `AgentRun.maxRepairAttempts` repair calls.
- Failed validation leaves no promoted project snapshot.

Deferred:

- Remote/container sandbox workers.
- Dependency allowlists or vulnerability policy.
- UI-specific validation error rendering.
- Snapshot rollback and deployment.

## File Map

- Create: `apps/server/src/agent/workspace/createWorkspace.ts` — safe workspace materialization and cleanup.
- Create: `apps/server/src/agent/workspace/createWorkspace.test.ts` — traversal, writing, and cleanup tests.
- Create: `apps/server/src/agent/workspace/runCommand.ts` — no-shell fixed command execution with timeout/output caps.
- Create: `apps/server/src/agent/workspace/runCommand.test.ts` — success, failure, timeout, and truncation tests.
- Create: `apps/server/src/agent/validator.ts` — install and fixed validation checks.
- Create: `apps/server/src/agent/validator.test.ts` — deterministic validation sequencing tests.
- Modify: `apps/server/src/agent/types.ts` — validator and repair contracts.
- Modify: `apps/server/src/agent/modelClient.ts` — structured repair request.
- Modify: `apps/server/src/agent/modelClient.test.ts` — repair prompt and schema tests.
- Modify: `apps/server/src/agent/orchestrator.ts` — validation/repair loop and success-only persistence.
- Modify: `apps/server/src/agent/orchestrator.test.ts` — pass, repaired-pass, and exhausted failure tests.
- Modify: `apps/server/src/agent/config.ts` — command timeout/output limit settings.
- Modify: `apps/server/src/agent/config.test.ts` — configuration defaults and parsing.

## Task 1: Workspace Materialization

- [x] **Step 1: Write failing workspace tests**

Create tests using `mkdtemp` that require `createValidationWorkspace` to write nested text files, reject invalid run IDs and escaping paths, and remove the workspace through its cleanup callback.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/server -- src/agent/workspace/createWorkspace.test.ts
```

Expected: FAIL because the workspace module does not exist.

- [x] **Step 3: Implement workspace creation**

Create a unique directory beneath `AGENT_WORKSPACE_ROOT`, revalidate every file path before writing, use exclusive server-selected paths, and expose an idempotent cleanup function based on the exact created directory.

- [x] **Step 4: Verify green**

Run the Task 1 test command. Expected: PASS.

## Task 2: Bounded No-Shell Command Runner

- [x] **Step 1: Write failing command tests**

Use `process.execPath` as the executable to test exit code capture, stdout/stderr capture, timeout termination, and truncation to a configured character limit.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/server -- src/agent/workspace/runCommand.test.ts
```

Expected: FAIL because the command runner does not exist.

- [x] **Step 3: Implement command execution**

Use `spawn(executable, args, { shell: false, cwd, env })`, a server-controlled timeout, and bounded buffers. Return `exitCode`, `stdout`, `stderr`, and `durationMs`; timeout returns a non-zero exit and a concise diagnostic.

- [x] **Step 4: Verify green**

Run the Task 2 test command. Expected: PASS.

## Task 3: Fixed Project Validator

- [x] **Step 1: Write failing validator tests**

Inject a fake runner and assert the exact sequence:

```text
npm install --ignore-scripts --no-audit --no-fund
npm run type-check
npm run build
```

Assert install failure produces a failed validation without running checks, check results map to the existing `ValidationResult`, output stays bounded, and cleanup occurs for pass and failure.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/server -- src/agent/validator.test.ts
```

Expected: FAIL because `validator.ts` does not exist.

- [x] **Step 3: Implement validation**

Add a `ProjectValidator` interface and production validator. Commands are constants owned by the server and never read from snapshot scripts or model output. Return `passed` only when installation and both checks exit zero.

- [x] **Step 4: Verify green**

Run the Task 3 test command. Expected: PASS.

## Task 4: Structured Repair Model Call

- [x] **Step 1: Write failing model-client tests**

Add a repair call test that verifies the request contains the original context, plan, candidate files, attempt number, and bounded validation diagnostics. Assert the response uses `generationResultSchema`.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/server -- src/agent/modelClient.test.ts
```

Expected: FAIL because `ModelClient.repairFiles` is missing.

- [x] **Step 3: Implement repair contracts and adapter**

Add `RepairInput` and `repairFiles`. The repair system prompt requires minimal complete-file operations and forbids commands. Reuse the same JSON parsing, Zod validation, retry, and usage normalization path as generation.

- [x] **Step 4: Verify green**

Run the Task 4 test command. Expected: PASS.

## Task 5: Validation And Repair Loop

- [x] **Step 1: Write failing pipeline tests**

Extend pure orchestrator tests for:

- first validation passes without repair;
- first validation fails, one repair changes files, second validation passes;
- validation continues failing until `maxRepairAttempts` is exhausted;
- events occur in the order `validation.started`, `validation.failed`, `repair.started`, file changes, and final validation result;
- usage includes planner, generator, and repair calls.

- [x] **Step 2: Verify red**

```bash
npm run test --workspace @v0/server -- src/agent/orchestrator.test.ts
```

Expected: FAIL because validation and repair are not part of the pipeline.

- [x] **Step 3: Implement the pure loop**

After generation, validate the candidate. On failure and remaining attempts, call `repairFiles`, apply operations, merge dependencies, regenerate server-owned `package.json`, and validate again. Throw typed `VALIDATION_FAILED` with bounded `ValidationResult` details when exhausted.

- [x] **Step 4: Integrate persistence and state transitions**

Inject the production validator from the worker. Persist status transitions:

```text
generating -> validating
validating -> repairing -> generating -> validating
validating -> completed | failed
```

Check cancellation through existing atomic transitions before each model call, validation, and snapshot persistence. Create `ProjectSnapshot` only after validation passes and persist the real `ValidationResult`.

- [x] **Step 5: Verify green**

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: PASS.

## Task 6: Complete Verification

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

Verify no `shell: true`, model-selected executable, unbounded validation output, workspace-root deletion, failed snapshot promotion, or Phase 5 UI behavior was introduced.

## Completion Checklist

- [x] Workspaces are unique, contained, and always cleaned.
- [x] Child processes never use a shell.
- [x] Only server-owned commands execute.
- [x] Validation logs are bounded.
- [x] Successful snapshots store passed validation results.
- [x] Failed candidates do not create snapshots.
- [x] Repair calls never exceed `maxRepairAttempts`.
- [x] Server and web tests, type-checks, and builds pass.
