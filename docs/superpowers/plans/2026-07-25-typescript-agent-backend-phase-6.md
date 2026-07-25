# TypeScript Agent Backend Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first-version verification loop with authenticated SSE progress, real MongoDB/Redis integration tests, BullMQ Worker E2E coverage, and deterministic Docker Compose API/browser smoke tests.

**Architecture:** Keep MongoDB as the durable event source and Redis as live fanout. Add a bearer-authenticated fetch-stream client with bounded reconnect and polling fallback, extract an injectable Worker factory, and use real ephemeral MongoDB/Redis containers for integration tests. A separate smoke-only Worker entry supplies deterministic fake model and validator collaborators to the normal Compose topology without adding a production fake-provider switch.

**Tech Stack:** TypeScript, Express, Mongoose, Redis, BullMQ, React, fetch streams, Node test runner, Testcontainers, Docker Compose, Playwright.

---

## Scope

Implement:

- Race-free server SSE backlog/live delivery with heartbeat and resume.
- Typed browser SSE parsing, retry, abort, de-duplication, and polling fallback.
- Real MongoDB/Redis integration environment and ownership/route tests.
- Injectable BullMQ Worker with deterministic create and repair E2E tests.
- Smoke-only Worker, Compose overlay, API smoke, and Playwright browser smoke.

Do not implement:

- Generated application preview execution.
- Run-specific rate limiting or queue outbox/reconciliation.
- Atomic Agent event sequence allocation.
- Production metrics, deployment, or authentication redesign.

## File Map

### Server

- Modify: `apps/server/package.json` — integration-test and smoke-worker scripts.
- Modify: `apps/server/src/agent/redis.ts` — test-safe connection reset/close behavior.
- Modify: `apps/server/src/agent/queue.ts` — explicit queue close/reset helper.
- Create: `apps/server/src/agent/sseStream.ts` — backlog/live merge, de-duplication, heartbeat, and cleanup.
- Create: `apps/server/src/agent/sseStream.test.ts` — deterministic stream delivery unit tests.
- Modify: `apps/server/src/routes/agent.ts` — delegate SSE delivery to the focused stream module.
- Create: `apps/server/src/agent/createWorker.ts` — dependency-injected BullMQ Worker factory.
- Create: `apps/server/src/agent/createWorker.test.ts` — job-name and dependency wiring tests.
- Modify: `apps/server/src/worker.ts` — production bootstrap through `createAgentWorker`.
- Create: `apps/server/src/agent/testing/fakeModelClient.ts` — deterministic plan/generate/repair implementation.
- Create: `apps/server/src/agent/testing/fakeValidator.ts` — programmable and always-passing validators.
- Create: `apps/server/src/testing/integrationEnvironment.ts` — Testcontainers lifecycle and data reset.
- Create: `apps/server/src/integration/agentRoutes.integration.ts` — auth, ownership, queue, SSE, and cancel tests.
- Create: `apps/server/src/integration/agentWorker.integration.ts` — create and repair Worker E2E.
- Create: `apps/server/src/smokeWorker.ts` — smoke-only Worker process entry.

### Web

- Create: `apps/web/src/services/agentEventStream.ts` — SSE parser and reconnecting fetch client.
- Create: `apps/web/src/services/agentEventStream.test.ts` — chunk, resume, duplicate, abort, and retry tests.
- Create: `apps/web/src/services/agentRunMonitor.ts` — stream-first orchestration with polling fallback.
- Create: `apps/web/src/services/agentRunMonitor.test.ts` — terminal and fallback behavior.
- Modify: `apps/web/src/services/api.ts` — event stream URL/type helpers.
- Modify: `apps/web/src/lib/v0Workspace.ts` — apply one streamed event without replacing unrelated Run state.
- Modify: `apps/web/src/lib/v0Workspace.test.ts` — streamed event ordering and terminal presentation.
- Modify: `apps/web/src/pages/V0Clone.tsx` — replace normal polling with the monitor and expose stable smoke selectors.
- Modify: `apps/web/nginx.conf` — same-origin API/SSE proxy with buffering disabled.

### Repository and Smoke

- Modify: `package.json` — root smoke commands and Playwright dependency.
- Modify: `package-lock.json` — dependency lock.
- Modify: `.gitignore` — Playwright result artifacts.
- Modify: `docker-compose.yml` — remove fixed container names so Compose project isolation works.
- Create: `playwright.config.ts` — smoke browser configuration.
- Create: `docker-compose.smoke.yml` — isolated deterministic smoke topology.
- Create: `tests/smoke/api-smoke.ts` — public HTTP smoke flow.
- Create: `tests/smoke/workspace.spec.ts` — visible browser flow.
- Create: `tests/smoke/run-smoke.ts` — Compose lifecycle, health wait, tests, logs, and scoped cleanup.

## Task 1: Test and Smoke Tooling

**Files:**

- Modify: `apps/server/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `playwright.config.ts`

- [ ] **Step 1: Install integration and browser-test dependencies**

Run:

```bash
npm install --save-dev testcontainers --workspace @v0/server
npm install --save-dev @playwright/test tsx
```

Expected: `apps/server/package.json`, root `package.json`, and `package-lock.json` change; no application source changes.

- [ ] **Step 2: Add isolated commands**

Add to `apps/server/package.json`:

```json
{
  "scripts": {
    "test:integration": "node --import tsx --test --test-concurrency=1 \"src/integration/**/*.integration.ts\"",
    "start:smoke-worker": "node dist/smokeWorker.js"
  }
}
```

Add to the root `package.json`:

```json
{
  "scripts": {
    "test:smoke:api": "tsx tests/smoke/api-smoke.ts",
    "test:smoke:browser": "playwright test tests/smoke/workspace.spec.ts",
    "test:smoke": "tsx tests/smoke/run-smoke.ts"
  }
}
```

- [ ] **Step 3: Add Playwright configuration and ignored artifacts**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: 'workspace.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  outputDir: 'test-results/playwright'
});
```

Append to `.gitignore`:

```text
test-results/
playwright-report/
```

- [ ] **Step 4: Verify command parsing and existing builds**

Run:

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npx playwright install chromium
```

Expected: existing tests and type-checks pass; Chromium installs outside the repository.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json apps/server/package.json .gitignore playwright.config.ts
git commit -m "test: add phase 6 test tooling"
```

## Task 2: Race-Free Server SSE Delivery

**Files:**

- Create: `apps/server/src/agent/sseStream.test.ts`
- Create: `apps/server/src/agent/sseStream.ts`
- Modify: `apps/server/src/routes/agent.ts`

- [ ] **Step 1: Write failing stream delivery tests**

Create tests with injected event loading, subscriber, response, and timers. Cover:

```ts
test('streamAgentRunEvents emits backlog and buffered live events once in sequence order', async () => {
  // subscribe first; publish sequence 3 while backlog [1, 2] is loading
  // assert emitted sequences are [1, 2, 3]
});

test('streamAgentRunEvents resumes strictly after lastEventId', async () => {
  // load [4, 5] for lastEventId 3; assert [4, 5]
});

test('streamAgentRunEvents ignores duplicate and older live sequences', async () => {
  // backlog ends at 5; live publishes 5, 4, 6; assert only 6 is appended
});

test('streamAgentRunEvents heartbeats and closes the subscriber once', async () => {
  // advance fake timer, close request twice, assert one heartbeat and one quit
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server
```

Expected: FAIL because `streamAgentRunEvents` does not exist.

- [ ] **Step 3: Implement the focused stream module**

Create this public contract in `sseStream.ts`:

```ts
export interface PublicAgentEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  message: string;
  payload?: unknown;
  createdAt: string;
}

export interface StreamAgentRunEventsInput {
  runId: string;
  userId: string;
  lastEventId?: number;
  req: Pick<Request, 'on'>;
  res: Pick<Response, 'write' | 'end'>;
  subscriber: Pick<IORedis, 'subscribe' | 'on' | 'off' | 'quit'>;
  loadEvents?: (afterSequence?: number) => Promise<PublicAgentEvent[]>;
  heartbeatMs?: number;
}

export const streamAgentRunEvents = async (
  input: StreamAgentRunEventsInput
): Promise<void> => {
  // attach the message handler, then subscribe, before loading durable events
  // buffer subscriber messages until backlog is emitted
  // sort by sequence and ignore sequence <= lastWrittenSequence
  // write id/event/data frames
  // heartbeat with ": heartbeat\n\n"
  // close subscriber and interval exactly once
};
```

Use `serializeAgentEvent` for MongoDB documents. Do not create a second public event shape in the route.

- [ ] **Step 4: Delegate the route**

In `routes/agent.ts`:

1. Keep authentication, ObjectId validation, and ownership lookup.
2. Write the SSE response headers.
3. Pass `Last-Event-ID`, request, response, and a dedicated Redis subscriber to `streamAgentRunEvents`.
4. Remove the route-local backlog loop and subscriber message handler.

The route must still include `userId` in the durable event query through the injected loader.

- [ ] **Step 5: Verify green**

Run:

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: all commands pass and existing SSE response fields remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/sseStream.ts apps/server/src/agent/sseStream.test.ts apps/server/src/routes/agent.ts
git commit -m "feat: make agent event streaming resumable"
```

## Task 3: Browser SSE Parser and Reconnecting Client

**Files:**

- Create: `apps/web/src/services/agentEventStream.test.ts`
- Create: `apps/web/src/services/agentEventStream.ts`
- Modify: `apps/web/src/services/api.ts`

- [ ] **Step 1: Write failing parser tests**

Cover protocol behavior with `ReadableStream` chunks:

```ts
it('parses frames split across chunks and preserves event ids', async () => {
  const chunks = [
    'id: 1\nevent: run.',
    'started\ndata: {"sequence":1,"type":"run.started","message":"started"}\n\n',
  ];
  // assert one typed event with sequence 1
});

it('sends bearer authorization and Last-Event-ID on reconnect', async () => {
  // capture fetch headers and assert Authorization + Last-Event-ID
});

it('ignores duplicate or older sequence numbers', async () => {
  // stream 2, 2, 1, 3; assert callbacks receive 2 and 3
});

it('aborts without retrying', async () => {
  // abort the signal; assert no additional fetch call
});

it('returns exhausted after bounded retryable failures', async () => {
  // inject failing fetch and zero-delay sleep; assert exact attempt count
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/web
```

Expected: FAIL because the SSE client module is missing.

- [ ] **Step 3: Implement the stream client**

Create this contract:

```ts
export type AgentStreamState = 'connected' | 'retrying';

export interface StreamAgentEventsOptions {
  runId: string;
  token: string;
  signal: AbortSignal;
  lastEventId?: number;
  maxReconnectAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>;
  onEvent: (event: AgentEvent) => void | Promise<void>;
  onState?: (state: AgentStreamState) => void;
}

export type StreamAgentEventsResult =
  | { outcome: 'terminal'; lastEventId: number }
  | { outcome: 'exhausted'; lastEventId?: number };

export const streamAgentEvents = async (
  options: StreamAgentEventsOptions
): Promise<StreamAgentEventsResult> => {
  // fetch /api/agent/runs/:id/events with bearer and Last-Event-ID
  // parse UTF-8 chunks using TextDecoder streaming mode
  // reconnect on EOF/network/5xx with bounded 250/500/1000 ms delays
  // do not retry 401/403/404 or AbortError
  // return terminal after completed/failed/cancelled event
};
```

Export an API helper from `services/api.ts`:

```ts
export const agentEventStreamUrl = (runId: string) =>
  `${API_URL}/api/agent/runs/${runId}/events`;
```

Pass the URL into the stream function or import the helper; do not duplicate API base URL resolution.

- [ ] **Step 4: Verify green**

Run:

```bash
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
```

Expected: parser, retry, abort, and existing workspace tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/agentEventStream.ts apps/web/src/services/agentEventStream.test.ts apps/web/src/services/api.ts
git commit -m "feat: add authenticated agent event stream client"
```

## Task 4: Stream-First Run Monitor and Workspace Integration

**Files:**

- Create: `apps/web/src/services/agentRunMonitor.test.ts`
- Create: `apps/web/src/services/agentRunMonitor.ts`
- Modify: `apps/web/src/lib/v0Workspace.test.ts`
- Modify: `apps/web/src/lib/v0Workspace.ts`
- Modify: `apps/web/src/pages/V0Clone.tsx`

- [ ] **Step 1: Write failing monitor tests**

Use injected stream, detail fetch, polling, and delay functions:

```ts
it('uses SSE events and fetches final detail after a terminal event', async () => {
  // stream emits run.started then run.completed
  // assert onEvent order and one final getRun call
});

it('falls back to polling only after stream exhaustion', async () => {
  // stream returns exhausted; polling returns running then completed
  // assert polling starts after exhaustion and final detail is returned
});

it('does not poll after abort or authentication failure', async () => {
  // assert no getRun calls
});
```

Add workspace reducer tests:

```ts
it('applies one newer streamed event without discarding the active snapshot', () => {
  // apply sequence 2 after sequence 1; preserve snapshot and run history
});

it('ignores a stale streamed event from a replaced run', () => {
  // current run_new, incoming run_old; state remains unchanged
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/web
```

Expected: FAIL because monitor and streamed-event state helper are missing.

- [ ] **Step 3: Implement monitor and state helper**

Create:

```ts
export interface MonitorAgentRunOptions {
  runId: string;
  token: string;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  stream?: typeof streamAgentEvents;
  getRun?: typeof agentApi.getRun;
  delay?: (durationMs: number, signal: AbortSignal) => Promise<void>;
}

export const monitorAgentRun = async (
  options: MonitorAgentRunOptions
): Promise<AgentRunDetailResponse> => {
  // stream first
  // if terminal, fetch and return final details
  // if exhausted, poll at 500 ms with the existing 60-attempt bound
  // respect AbortSignal before every fetch and delay
};
```

Add `applyAgentEvent(state, runId, event)` in `v0Workspace.ts`. It must:

- ignore mismatched Run IDs;
- ignore sequences already represented in steps;
- append a mapped step without deleting snapshot/history;
- represent terminal event status immediately;
- leave the final snapshot replacement to `applyAgentRunDetail`.

- [ ] **Step 4: Replace normal polling in `V0Clone`**

For each submitted persisted Run:

1. create one `AbortController`;
2. call `monitorAgentRun`;
3. apply each event with `applyAgentEvent`;
4. apply returned final details with `applyAgentRunDetail`;
5. refresh project history and snapshots;
6. abort the previous controller on replacement, cancellation, back-home transition, or unmount.

Keep `pollRunUntilTerminal` only inside the monitor as fallback; remove the page-local polling loop.

Add stable attributes for smoke assertions:

```tsx
<div data-testid="agent-generation-status" data-status={state.generation.status}>
<div data-testid="agent-timeline">
<div data-testid="snapshot-history">
```

- [ ] **Step 5: Verify green**

Run:

```bash
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: stream-first tests pass; normal builds contain no page-local polling loop.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/agentRunMonitor.ts apps/web/src/services/agentRunMonitor.test.ts apps/web/src/lib/v0Workspace.ts apps/web/src/lib/v0Workspace.test.ts apps/web/src/pages/V0Clone.tsx
git commit -m "feat: stream agent progress with polling fallback"
```

## Task 5: Real MongoDB and Redis Integration Environment

**Files:**

- Modify: `apps/server/src/agent/redis.ts`
- Modify: `apps/server/src/agent/queue.ts`
- Create: `apps/server/src/testing/integrationEnvironment.ts`
- Create: `apps/server/src/integration/environment.integration.ts`

- [ ] **Step 1: Write a failing environment lifecycle test**

Create `environment.integration.ts`:

```ts
test('integration environment provides isolated MongoDB Redis and BullMQ state', async () => {
  const environment = await createIntegrationEnvironment();
  try {
    await environment.redis.set(`${environment.namespace}:probe`, 'ok');
    assert.equal(await environment.redis.get(`${environment.namespace}:probe`), 'ok');
    assert.equal(mongoose.connection.readyState, 1);

    await environment.reset();
    assert.equal(await environment.redis.get(`${environment.namespace}:probe`), null);
  } finally {
    await environment.close();
  }
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test:integration --workspace @v0/server
```

Expected: FAIL because `createIntegrationEnvironment` does not exist. If Docker is unavailable, stop and restore Docker before continuing.

- [ ] **Step 3: Add explicit singleton cleanup**

In `redis.ts`, keep `closeSharedRedisConnection` idempotent and add no global key deletion.

In `queue.ts`, add:

```ts
export const closeAgentRunQueue = async (): Promise<void> => {
  if (!agentRunQueue) return;
  await agentRunQueue.close();
  agentRunQueue = undefined;
};
```

Use these helpers during integration teardown so later tests can change queue configuration safely.

- [ ] **Step 4: Implement the integration environment**

Create:

```ts
export interface IntegrationEnvironment {
  namespace: string;
  mongoUri: string;
  redisUrl: string;
  queueName: string;
  redis: IORedis;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export const createIntegrationEnvironment = async (): Promise<IntegrationEnvironment> => {
  // start mongo:7 and redis:7-alpine GenericContainer instances
  // create random namespace/database/queue names
  // set MONGODB_URI, REDIS_URL, AGENT_QUEUE_NAME, JWT_SECRET before dynamic imports
  // connect Mongoose and Redis
  // reset deletes model collections and obliterates only the unique queue
  // close shared queue/redis, mongoose, clients, then containers
};
```

Wrap container startup errors with:

```text
Phase 6 integration tests require a running Docker daemon: <original message>
```

- [ ] **Step 5: Verify green**

Run:

```bash
npm run test:integration --workspace @v0/server
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: integration lifecycle and all unit tests pass without leaked Node handles.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/redis.ts apps/server/src/agent/queue.ts apps/server/src/testing/integrationEnvironment.ts apps/server/src/integration/environment.integration.ts
git commit -m "test: add real agent integration environment"
```

## Task 6: Authenticated Route, Queue, SSE, and Ownership Integration

**Files:**

- Create: `apps/server/src/integration/agentRoutes.integration.ts`
- Modify: `apps/server/src/agent/sseStream.ts` only if integration reveals a delivery defect.

- [ ] **Step 1: Write the authenticated create-and-queue test**

Use one shared integration environment with `before`, `beforeEach`, and `after`.
Create real users through `User.create`, sign tokens with `generateToken`, and call
`createApp()` through Supertest.

Assert:

```ts
const response = await request(app)
  .post('/api/agent/runs')
  .set('Authorization', `Bearer ${ownerToken}`)
  .send({ projectId: project._id.toString(), prompt: 'Build a dashboard' })
  .expect(201);

assert.equal(response.body.run.status, 'queued');
assert.equal(await AgentRun.countDocuments({ _id: response.body.run._id }), 1);
assert.equal(await AgentEvent.countDocuments({
  runId: response.body.run._id,
  type: 'run.created'
}), 1);
assert.ok(await queue.getJob(response.body.run._id));
```

- [ ] **Step 2: Write ownership isolation tests**

Assert a second authenticated user receives 404 when:

- creating a Run against the owner's Project;
- reading the owner's Run;
- opening the owner's SSE endpoint;
- reading the owner's Snapshot;
- rolling back the owner's Snapshot.

Also assert a Chat from another Project cannot be supplied during Run creation.

- [ ] **Step 3: Write SSE backlog, live, and resume tests**

Create stored events 1–3, open the authenticated stream, and assert:

- backlog arrives as 1, 2, 3;
- publishing sequence 4 through `emitAgentEvent` arrives exactly once;
- reconnecting with `Last-Event-ID: 2` begins at 3;
- closing the request closes the dedicated subscriber without hanging the test.

Use a bounded stream reader helper; do not wait indefinitely for socket close.

- [ ] **Step 4: Write cancellation integration**

Create a queued Run, call cancel, and assert:

```ts
assert.equal(response.body.run.status, 'cancelled');
assert.equal(await AgentEvent.countDocuments({
  runId,
  type: 'run.cancelled'
}), 1);
```

Process its queued job later in Task 8 and assert it remains cancelled.

- [ ] **Step 5: Run and fix only route-level defects**

Run:

```bash
npm run test:integration --workspace @v0/server
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: all route, ownership, queue, and SSE integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/integration/agentRoutes.integration.ts apps/server/src/agent/sseStream.ts
git commit -m "test: cover authenticated agent routes end to end"
```

## Task 7: Injectable Worker and Deterministic Fakes

**Files:**

- Create: `apps/server/src/agent/createWorker.test.ts`
- Create: `apps/server/src/agent/createWorker.ts`
- Create: `apps/server/src/agent/testing/fakeModelClient.ts`
- Create: `apps/server/src/agent/testing/fakeValidator.ts`
- Modify: `apps/server/src/worker.ts`

- [ ] **Step 1: Write failing Worker factory tests**

Cover:

```ts
test('createAgentWorker rejects unsupported job names', async () => {
  // call exported processor with name "unknown"; assert rejection
});

test('createAgentWorker delegates agent-run jobs with injected dependencies', async () => {
  // inject processRun spy and assert job data/modelClient/validator forwarding
});
```

Export the processor builder separately so this unit test does not require Redis:

```ts
export const createAgentJobProcessor = (dependencies: {
  modelClient: ModelClient;
  validator: ProjectValidator;
  processRun?: typeof processAgentRun;
}) => async (job: Pick<Job<AgentRunJobData>, 'name' | 'data'>): Promise<void>;
```

- [ ] **Step 2: Verify red**

Run:

```bash
npm run test --workspace @v0/server
```

Expected: FAIL because the Worker factory does not exist.

- [ ] **Step 3: Implement the Worker factory**

Create:

```ts
export interface CreateAgentWorkerOptions {
  connection: ConnectionOptions;
  queueName: string;
  modelClient: ModelClient;
  validator: ProjectValidator;
  concurrency?: number;
}

export const createAgentWorker = (
  options: CreateAgentWorkerOptions
): Worker<AgentRunJobData> =>
  new Worker(
    options.queueName,
    createAgentJobProcessor(options),
    {
      connection: options.connection,
      concurrency: options.concurrency ?? 2
    }
  );
```

Update `worker.ts` to keep only configuration, database connection, production
collaborator creation, event logging, and signal cleanup.

- [ ] **Step 4: Implement deterministic fakes**

`fakeModelClient.ts` must export a factory with observable counters:

```ts
export interface FakeModelClient extends ModelClient {
  calls: { plan: number; generate: number; repair: number };
}

export const createFakeModelClient = (): FakeModelClient => ({
  calls: { plan: 0, generate: 0, repair: 0 },
  generatePlan: async () => ({ value: deterministicPlan }),
  generateFiles: async () => ({ value: deterministicGeneration }),
  repairFiles: async () => ({ value: deterministicRepair })
});
```

The generated files must include valid supported paths:

```text
index.html
src/main.tsx
src/App.tsx
src/index.css
```

`fakeValidator.ts` must export:

```ts
export const createPassingValidator = (): ProjectValidator;
export const createFailOnceValidator = (): ProjectValidator & {
  calls: number;
};
```

The fail-once result contains one concise `type-check` diagnostic; the second
result passes.

- [ ] **Step 5: Verify green**

Run:

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: production bootstrap and fake collaborators compile; unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/createWorker.ts apps/server/src/agent/createWorker.test.ts apps/server/src/agent/testing/fakeModelClient.ts apps/server/src/agent/testing/fakeValidator.ts apps/server/src/worker.ts
git commit -m "refactor: make agent worker injectable"
```

## Task 8: BullMQ Worker Create, Repair, and Cancel E2E

**Files:**

- Create: `apps/server/src/integration/agentWorker.integration.ts`
- Modify: production files only if the E2E exposes an actual lifecycle defect.

- [ ] **Step 1: Write the successful create E2E**

Arrange a User, Project, queued AgentRun, `run.created` event, real Queue, and real
Worker factory. Inject `createFakeModelClient()` and `createPassingValidator()`.

Wait for BullMQ completion with a 20-second bound, then assert:

```ts
assert.equal(run.status, 'completed');
assert.ok(run.resultSnapshotId);
assert.equal(snapshot.validation.status, 'passed');
assert.ok(snapshot.files.some(file => file.path === 'src/App.tsx'));
assert.equal(project.activeSnapshotId?.toString(), snapshot._id.toString());
assert.equal(project.activeSnapshotRevision, 1);
assert.deepEqual(
  events.map(event => event.type),
  [
    'run.created',
    'run.started',
    'agent.plan',
    'agent.step',
    // file.changed entries,
    'validation.started',
    'validation.passed',
    'run.completed'
  ]
);
```

For the event assertion, filter repeated `file.changed` entries separately rather
than hard-coding their count into unrelated lifecycle order assertions.

- [ ] **Step 2: Verify red if Worker wiring is incomplete**

Run:

```bash
npm run test:integration --workspace @v0/server
```

Expected: PASS if Task 7 wiring is correct, otherwise fail at the exact lifecycle boundary.

- [ ] **Step 3: Write the repair E2E**

Use `createFailOnceValidator()` and assert:

- one `repair.started` event;
- fake model `repair` counter is 1;
- Run attempt is 1;
- final validation passed;
- only one passed Snapshot exists;
- active revision advances once.

- [ ] **Step 4: Write the cancelled queued job E2E**

Cancel the Run before starting the Worker, then enqueue/process its job. Assert:

- Run remains `cancelled`;
- no `run.started` event;
- no Snapshot;
- fake model counters remain zero.

- [ ] **Step 5: Verify all integration and unit checks**

Run:

```bash
npm run test:integration --workspace @v0/server
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: create, repair, cancel, route, and environment integration suites pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/integration/agentWorker.integration.ts
git commit -m "test: exercise agent worker lifecycle end to end"
```

## Task 9: Smoke Worker and Compose Topology

**Files:**

- Create: `apps/server/src/smokeWorker.ts`
- Modify: `apps/web/nginx.conf`
- Modify: `docker-compose.yml`
- Create: `docker-compose.smoke.yml`

- [ ] **Step 1: Add the smoke-only Worker entry**

Create a process bootstrap that:

```ts
await connectDB();
const config = getAgentConfig();
const connection = createRedisConnection();
const worker = createAgentWorker({
  connection,
  queueName: config.queueName,
  modelClient: createFakeModelClient(),
  validator: createPassingValidator(),
  concurrency: 1
});
```

Install the same SIGINT/SIGTERM cleanup as production. The production `worker.ts`
must not import `agent/testing/*`.

- [ ] **Step 2: Add same-origin API and SSE proxying**

Add before the SPA location in `apps/web/nginx.conf`:

```nginx
location /api/ {
    proxy_pass http://server:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
}
```

This makes the web bundle's default relative API URL work in both normal and smoke Compose.

- [ ] **Step 3: Make Compose project isolation effective**

Remove every fixed `container_name` entry from `docker-compose.yml`. Compose will
then scope container and network names by the `-p` project name. Do not rename
services because internal hostnames such as `mongodb`, `redis`, and `server` are
part of the application configuration.

- [ ] **Step 4: Create the smoke Compose overlay**

Define:

```yaml
services:
  mongodb:
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
      interval: 2s
      timeout: 2s
      retries: 30
  redis:
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 30
  server:
    ports:
      - "${SMOKE_API_PORT:-43001}:3001"
    environment:
      JWT_SECRET: phase6-smoke-secret
      AGENT_QUEUE_NAME: phase6-smoke-runs
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 2s
      timeout: 2s
      retries: 60
  worker:
    command: npm run start:smoke-worker --workspace @v0/server
    environment:
      JWT_SECRET: phase6-smoke-secret
      AGENT_QUEUE_NAME: phase6-smoke-runs
  web:
    ports:
      - "${SMOKE_WEB_PORT:-4173}:80"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/"]
      interval: 2s
      timeout: 2s
      retries: 60
```

Do not add `OPENAI_API_KEY` to the smoke Worker.

- [ ] **Step 5: Validate images and Compose shape**

Run:

```bash
npm run build --workspace @v0/server
npm run build --workspace @v0/web
docker compose -f docker-compose.yml -f docker-compose.smoke.yml config
docker compose -f docker-compose.yml -f docker-compose.smoke.yml build server worker web
```

Expected: Compose config is valid; server build contains `dist/smokeWorker.js`; images build without an OpenAI key.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/smokeWorker.ts apps/web/nginx.conf docker-compose.yml docker-compose.smoke.yml
git commit -m "test: add deterministic agent smoke topology"
```

## Task 10: API Smoke

**Files:**

- Create: `tests/smoke/api-smoke.ts`

- [ ] **Step 1: Implement a bounded HTTP helper**

Use native fetch and a structured assertion helper:

```ts
const requestJson = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
};
```

Read `SMOKE_API_URL`, defaulting to `http://127.0.0.1:43001`.

- [ ] **Step 2: Implement the public API flow**

The script must:

1. register `phase6-${Date.now()}@v0.local`;
2. create a React/Tailwind Project;
3. create a Run with a unique prompt;
4. poll at 250 ms for at most 30 seconds;
5. require `completed`;
6. read the result Snapshot;
7. list snapshots and require the result to be active;
8. require `src/App.tsx` and passed validation.

On timeout, throw an error containing the last serialized Run response.

- [ ] **Step 3: Verify against the smoke topology**

Run:

```bash
phase6_smoke_project="phase6-api-$(date +%s)"
docker compose -p "$phase6_smoke_project" -f docker-compose.yml -f docker-compose.smoke.yml up -d --build --wait
npm run test:smoke:api
docker compose -p "$phase6_smoke_project" -f docker-compose.yml -f docker-compose.smoke.yml down
```

Expected: API smoke exits zero and no OpenAI request occurs.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke/api-smoke.ts
git commit -m "test: add agent API smoke flow"
```

## Task 11: Browser Smoke and Scoped Compose Runner

**Files:**

- Modify: `apps/web/src/pages/V0Clone.tsx`
- Create: `tests/smoke/workspace.spec.ts`
- Create: `tests/smoke/run-smoke.ts`

- [ ] **Step 1: Add only the missing stable selectors**

Prefer existing roles and labels. Add `data-testid` only for generated state that
has no semantic locator:

```tsx
data-testid="agent-generation-status"
data-status={state.generation.status}

data-testid="agent-timeline"
data-testid="snapshot-history"
data-testid={`snapshot-${snapshot.id}`}
```

- [ ] **Step 2: Write the browser smoke**

Create:

```ts
test('workspace completes a streamed run and restores its active snapshot', async ({ page }) => {
  const prompt = `Phase 6 browser smoke ${Date.now()}`;
  await page.goto('/');
  await page.getByPlaceholder('让 v0 构建...').fill(prompt);
  await page.getByLabel('Build prompt').click();

  await expect(page.getByTestId('agent-timeline')).toContainText('Worker started');
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Code' }).click();
  await expect(page.getByText('src/App.tsx', { exact: true })).toBeVisible();
  await expect(page.getByTestId('snapshot-history')).toContainText('active');
  await expect(page.getByTestId('snapshot-history')).toContainText('passed');

  await page.reload();
  await expect(page.getByText('src/App.tsx', { exact: true })).toBeVisible();
  await expect(page.getByTestId('snapshot-history')).toContainText('active');
});
```

If the existing localized copy differs, use the existing accessible labels rather
than adding duplicate buttons for the test.

- [ ] **Step 3: Implement the scoped Compose runner**

`run-smoke.ts` must use `spawn` with argument arrays and no shell:

```ts
const projectName = process.env.SMOKE_PROJECT_NAME ??
  `phase6-${process.pid}-${Date.now()}`;
const composeArgs = [
  'compose',
  '-p', projectName,
  '-f', 'docker-compose.yml',
  '-f', 'docker-compose.smoke.yml'
];
```

Required flow:

1. `docker ... up -d --build --wait`;
2. run `npm run test:smoke:api`;
3. run `npm run test:smoke:browser`;
4. on failure, run `docker ... logs --no-color`;
5. in `finally`, run `docker ... down --volumes --remove-orphans`.

The generated Compose project name is unique to this smoke invocation, so
`--volumes` removes only its ephemeral MongoDB volume. The runner must never use
the normal development Compose project name or delete unrelated Docker data.

- [ ] **Step 4: Verify the full smoke command**

Run:

```bash
npm run test:smoke
```

Expected: Compose becomes healthy, API smoke passes, Chromium smoke passes,
containers stop, and the command exits zero.

- [ ] **Step 5: Re-run web checks**

```bash
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all checks pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/V0Clone.tsx tests/smoke/workspace.spec.ts tests/smoke/run-smoke.ts
git commit -m "test: add browser agent smoke flow"
```

## Task 12: Complete Verification and Documentation Sync

**Files:**

- Modify: `docs/superpowers/plans/2026-07-25-typescript-agent-backend-phase-6.md` — check completed items.

- [ ] **Step 1: Run unit, type, and build checks**

```bash
npm run test --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
npm run test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected:

- Server unit tests: zero failures.
- Web unit tests: zero failures.
- Both type-checks and builds exit zero.

- [ ] **Step 2: Run real integration checks**

```bash
npm run test:integration --workspace @v0/server
```

Expected: real MongoDB/Redis route, SSE, create, repair, and cancellation tests pass with no open-handle warning.

- [ ] **Step 3: Run deterministic Compose smoke**

```bash
npm run test:smoke
```

Expected: API and Playwright browser smoke both pass without `OPENAI_API_KEY`.

- [ ] **Step 4: Review security and isolation**

Confirm from code and test evidence:

- every Run/Event/Snapshot integration lookup is scoped by authenticated user and Project;
- SSE authorization uses only the existing bearer token;
- SSE reconnect cannot duplicate or omit persisted sequences;
- abort and terminal events stop background stream/poll work;
- fake model and validator imports occur only in tests and `smokeWorker.ts`;
- production `worker.ts` cannot activate fake collaborators;
- integration and smoke cleanup targets only their generated namespace/project name;
- no smoke command deletes normal Docker volumes.

- [ ] **Step 5: Check the tree and plan**

```bash
git diff --check
git status --short
rg -n "^- \\[ \\]" docs/superpowers/plans/2026-07-25-typescript-agent-backend-phase-6.md
```

Expected: no whitespace errors; only intentional Phase 6 files are changed; all implementation and verification boxes are checked before final commit.

- [ ] **Step 6: Final commit**

```bash
git add \
  .gitignore \
  package.json \
  package-lock.json \
  playwright.config.ts \
  docker-compose.yml \
  docker-compose.smoke.yml \
  apps/server/package.json \
  apps/server/src/agent/redis.ts \
  apps/server/src/agent/queue.ts \
  apps/server/src/agent/sseStream.ts \
  apps/server/src/agent/sseStream.test.ts \
  apps/server/src/routes/agent.ts \
  apps/server/src/agent/createWorker.ts \
  apps/server/src/agent/createWorker.test.ts \
  apps/server/src/agent/testing/fakeModelClient.ts \
  apps/server/src/agent/testing/fakeValidator.ts \
  apps/server/src/testing/integrationEnvironment.ts \
  apps/server/src/integration/environment.integration.ts \
  apps/server/src/integration/agentRoutes.integration.ts \
  apps/server/src/integration/agentWorker.integration.ts \
  apps/server/src/worker.ts \
  apps/server/src/smokeWorker.ts \
  apps/web/src/services/agentEventStream.ts \
  apps/web/src/services/agentEventStream.test.ts \
  apps/web/src/services/agentRunMonitor.ts \
  apps/web/src/services/agentRunMonitor.test.ts \
  apps/web/src/services/api.ts \
  apps/web/src/lib/v0Workspace.ts \
  apps/web/src/lib/v0Workspace.test.ts \
  apps/web/src/pages/V0Clone.tsx \
  apps/web/nginx.conf \
  tests/smoke/api-smoke.ts \
  tests/smoke/workspace.spec.ts \
  tests/smoke/run-smoke.ts \
  docs/superpowers/plans/2026-07-25-typescript-agent-backend-phase-6.md
git commit -m "docs: complete agent backend phase 6 plan"
```

## Completion Checklist

- [ ] Normal workspace progress uses authenticated SSE.
- [ ] SSE resumes from `Last-Event-ID` without duplicates or gaps.
- [ ] Polling is used only after bounded stream recovery fails.
- [ ] Integration tests use real MongoDB, Redis, BullMQ, auth, and routes.
- [ ] Fake Worker create and repair paths complete end to end.
- [ ] A cancelled queued Run remains cancelled when its job is consumed.
- [ ] API smoke passes against Docker Compose.
- [ ] Browser smoke observes progress, completion, files, active Snapshot, and reload restoration.
- [ ] Smoke requires no OpenAI key.
- [ ] Server/Web unit tests, type-checks, builds, integration tests, and smoke tests pass.
- [ ] Independent review reports no unresolved Critical or Important findings.
