# TypeScript Agent Backend Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic Phase 2 snapshot generator with a model-backed planner and structured React/TypeScript/Tailwind file generator.

**Architecture:** Keep queueing, events, snapshots, and deterministic file application unchanged. Add a provider-neutral `ModelClient`, an OpenAI JSON adapter, Zod schemas at the model boundary, and a context builder that selects chat and snapshot content within the configured character budget. The orchestrator receives a client through dependency injection so its full planning and generation flow can be tested without network access.

**Tech Stack:** TypeScript, OpenAI Node SDK, Zod, Mongoose, Node test runner.

---

## Scope

Phase 3 includes:

- Provider-neutral planner and generator contracts.
- Runtime validation for model plan and generation responses.
- Project, chat, and base-snapshot context assembly.
- OpenAI-backed JSON model client selected by worker configuration.
- Planner and generator integration in the run state machine.
- React + TypeScript + Tailwind constraints in model instructions.
- Deterministic dependency/script merging and snapshot persistence.

Deferred to Phase 4:

- Temporary validation workspaces.
- `type-check` and Vite build execution.
- Repair model calls and repair attempts.
- Promotion rules based on successful validation.

## File Map

- Modify: `apps/server/src/agent/types.ts` — Phase 3 domain contracts.
- Modify: `apps/server/src/agent/schemas.ts` — Zod schemas for all model output.
- Modify: `apps/server/src/agent/schemas.test.ts` — model boundary validation tests.
- Create: `apps/server/src/agent/contextBuilder.ts` — bounded prompt context construction.
- Create: `apps/server/src/agent/contextBuilder.test.ts` — context selection tests.
- Create: `apps/server/src/agent/modelClient.ts` — provider-neutral interface and OpenAI adapter.
- Create: `apps/server/src/agent/modelClient.test.ts` — adapter parsing and prompt contract tests.
- Create: `apps/server/src/agent/dependencies.ts` — deterministic package metadata merge.
- Create: `apps/server/src/agent/dependencies.test.ts` — merge tests.
- Modify: `apps/server/src/agent/orchestrator.ts` — planning/generation state flow.
- Modify: `apps/server/src/agent/orchestrator.test.ts` — model-backed pipeline tests.
- Modify: `apps/server/src/worker.ts` — construct and inject production model client.
- Delete: `apps/server/src/agent/snapshotGenerator.ts` — Phase 2 fake generator.
- Delete: `apps/server/src/agent/snapshotGenerator.test.ts` — Phase 2 fake tests.

## Task 1: Structured Agent Contracts

- [x] **Step 1: Write failing schema tests**

Add tests that accept a complete plan and generation response, then reject blank plan steps, absolute file paths, unsupported extensions, missing file content, and non-object dependency maps.

- [x] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/schemas.test.ts
```

Expected: FAIL because `agentPlanSchema` and `generationResultSchema` are not exported.

- [x] **Step 3: Add the contracts and schemas**

Define `AgentPlan`, `AgentContext`, `PlanInput`, `GenerateInput`, `ModelUsage`, `ModelResult<T>`, and `ModelClient`. Implement strict Zod schemas for plan and generation output. File operations accept only relative `.ts`, `.tsx`, `.css`, `.json`, `.html`, and `.md` paths.

- [x] **Step 4: Verify green**

Run the schema test command. Expected: PASS.

## Task 2: Bounded Agent Context

- [x] **Step 1: Write failing context tests**

Test that context always includes the current prompt, project metadata, recent chat messages, and base snapshot file manifest; small snapshots include contents, while content over `contextCharLimit` falls back to the manifest.

- [x] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/contextBuilder.test.ts
```

Expected: FAIL because `contextBuilder.ts` does not exist.

- [x] **Step 3: Implement pure and database context builders**

Export a pure `buildAgentContext` selector plus `loadAgentContext(run, limit)` that ownership-scopes Project, Chat, and ProjectSnapshot reads. Throw typed `PROJECT_NOT_FOUND` or invalid-base errors rather than silently generating without required context.

- [x] **Step 4: Verify green**

Run the context test command. Expected: PASS.

## Task 3: Model Client Boundary

- [x] **Step 1: Write failing client tests**

Inject a fake chat-completions transport and assert that planner/generator JSON is parsed through Zod, React/TypeScript/Tailwind constraints are present in system instructions, usage is normalized, and malformed JSON becomes `INVALID_MODEL_OUTPUT`.

- [x] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/modelClient.test.ts
```

Expected: FAIL because `modelClient.ts` does not exist.

- [x] **Step 3: Implement the interface and OpenAI adapter**

Use `chat.completions.create` with `response_format: { type: "json_object" }`. Parse the returned content as JSON and then with the Phase 3 Zod schema. Convert provider exceptions to `MODEL_REQUEST_FAILED` and never log prompts or credentials.

- [x] **Step 4: Verify green**

Run the client test command. Expected: PASS.

## Task 4: Deterministic Package Metadata

- [x] **Step 1: Write failing merge tests**

Cover sorted merging of base and generated dependencies, mandatory React/Vite/Tailwind packages, generated version override, and fixed server-owned scripts.

- [x] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/dependencies.test.ts
```

Expected: FAIL because `dependencies.ts` does not exist.

- [x] **Step 3: Implement dependency merging**

Return sorted dependency maps and fixed `dev`, `type-check`, and `build` scripts. The model may request package versions but cannot supply executable scripts.

- [x] **Step 4: Verify green**

Run the dependency test command. Expected: PASS.

## Task 5: Model-Backed Orchestration

- [x] **Step 1: Write failing orchestration tests**

Test a pure `runAgentGeneration` function with a fake `ModelClient`. Assert planner precedes generator, the plan is passed into generation, events include `agent.plan` and `file.changed`, and generated operations are applied to the base files.

- [x] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server -- src/agent/orchestrator.test.ts
```

Expected: FAIL because the model-backed pipeline does not exist.

- [x] **Step 3: Implement the Phase 3 pipeline**

Transition `running -> planning -> generating`, emit state events after persistence, invoke planner then generator, apply deterministic file operations, merge package metadata, save a snapshot with `validation.status = "skipped"`, set model usage on the run, and complete it. On failure, persist a typed error and emit `run.failed`.

- [x] **Step 4: Inject the production client from the worker**

Construct one OpenAI adapter from `OPENAI_API_KEY` and the configured run model, then pass it to `processAgentRun`. Remove the Phase 2 fake snapshot generator.

- [x] **Step 5: Verify green**

Run:

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: PASS.

## Task 6: Phase 3 Verification

- [x] **Step 1: Run all repository checks**

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

- [x] **Step 2: Review diff and scope**

Confirm no Phase 4 validation/repair behavior was added, no model-selected shell command can execute, all model output crosses a Zod boundary, and `git diff --check` is clean.

## Completion Checklist

- [x] Planner and generator are behind `ModelClient`.
- [x] OpenAI adapter uses structured JSON and Zod validation.
- [x] Context includes project/chat/base snapshot with a size cap.
- [x] Orchestrator emits a persisted plan before generation.
- [x] React/TypeScript/Tailwind constraints are explicit.
- [x] Generated scripts remain server-controlled.
- [x] Server and web tests, type-checks, and builds pass.
