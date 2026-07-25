# TypeScript Agent Backend Phase 6 Design

## Goal

Close the remaining first-version verification gap by making the workspace consume
real-time Agent events, exercising the Agent pipeline against real MongoDB and
Redis services, and providing deterministic API and browser smoke tests that do
not require a real model provider.

Phase 6 covers four connected outcomes:

1. The web workspace consumes SSE with authenticated `fetch` streaming and falls
   back to polling only after streaming recovery is exhausted.
2. Server integration tests run against real ephemeral MongoDB and Redis
   containers.
3. A BullMQ Worker with injected fake collaborators completes create and repair
   runs end to end.
4. A Docker Compose smoke environment proves the API and browser product loop.

## Scope

Included:

- Bearer-authenticated SSE consumption in the web application.
- SSE parsing, reconnect, resume, heartbeat, de-duplication, and polling fallback.
- Race-free server-side backlog and live-event delivery.
- A `testcontainers`-based MongoDB and Redis test environment.
- Authenticated route, ownership, queue, SSE, cancellation, and Worker integration
  coverage.
- An injectable Worker factory shared by production and tests.
- Deterministic fake model and validator implementations for tests and smoke only.
- Docker Compose API smoke and Playwright browser smoke.
- One-command local and CI-oriented verification entry points.

Deferred:

- Generated application preview execution.
- Run-specific rate limiting and queue outbox/reconciliation.
- Atomic Agent event sequence allocation.
- Production observability, dashboards, and alerting.
- Production authentication or onboarding redesign.
- Deployment and GitHub integration.

## Architectural Decisions

### Authenticated SSE Transport

The web application will use `fetch` rather than native `EventSource`. The request
will include the existing bearer token in the `Authorization` header, so Phase 6
does not introduce a second authentication mechanism or a stream-token endpoint.

The stream client owns protocol concerns:

- send `Last-Event-ID` when reconnecting;
- parse SSE frames split across arbitrary network chunks;
- ignore duplicate or out-of-order event sequences;
- expose typed event, connected, retrying, and exhausted callbacks;
- abort promptly when the run changes or the component unmounts;
- use bounded exponential backoff;
- report exhaustion so the caller can start polling.

The React hook owns lifecycle concerns:

- start one stream for the current persisted Run ID;
- apply streamed events to workspace state;
- fetch final Run details on a terminal event;
- stop streaming on completion, failure, cancellation, run replacement, or
  unmount;
- start the existing polling loop only after stream retries are exhausted.

### Race-Free SSE Server Delivery

The API must not lose an event published between reading MongoDB history and
subscribing to Redis. The endpoint will:

1. authenticate and validate Run ownership;
2. subscribe to the Run Redis channel;
3. read stored events after the requested sequence;
4. buffer live messages received during the backlog query;
5. emit backlog and buffered messages in sequence order with de-duplication;
6. continue emitting live messages with monotonically increasing sequence checks.

The response will send a comment heartbeat at a fixed interval. Request close,
write failure, and route errors will clear the heartbeat and close the dedicated
Redis subscriber exactly once.

MongoDB remains the durable source of truth. Redis messages only reduce latency.
Reconnect always resumes from MongoDB using `Last-Event-ID`.

## Integration Test Environment

Server integration tests will use Node's existing test runner plus
`testcontainers`:

- MongoDB 7 container;
- Redis 7 Alpine container;
- a unique MongoDB database name per test process;
- a unique BullMQ queue name per test process.

The integration environment will set connection environment variables before
dynamically importing modules that cache configuration. It will expose explicit
setup, reset, and teardown helpers:

- connect Mongoose;
- create Redis connections and the queue;
- clear MongoDB collections;
- drain and obliterate the test queue;
- clear only keys belonging to the unique test namespace;
- close Workers, queues, Redis clients, Mongoose, and containers.

Integration tests will not silently skip when Docker is unavailable. The command
will fail with an actionable message explaining that Docker is required.

Unit tests remain fast and container-free under the existing `test` command.
Integration coverage runs through a separate `test:integration` command.

## Injectable Worker

Worker construction will move out of the process bootstrap into a focused factory:

```ts
interface CreateAgentWorkerOptions {
  connection: RedisOptions;
  queueName: string;
  modelClient: ModelClient;
  validator: ProjectValidator;
  concurrency?: number;
}

createAgentWorker(options: CreateAgentWorkerOptions): Worker<AgentRunJobData>
```

The production `worker.ts` will continue to load configuration, connect MongoDB,
create the production model client and validator, install signal handlers, and
delegate BullMQ construction to this factory.

Integration tests will use the same factory with:

- a deterministic fake `ModelClient`;
- a programmable fake `ProjectValidator`;
- real MongoDB;
- real Redis and BullMQ.

The create scenario must verify the entire durable result:

- queued Run consumed;
- ordered lifecycle events persisted;
- structured files generated;
- validation passed;
- `ProjectSnapshot` created;
- Run completed with `resultSnapshotId`;
- Project active snapshot revision advanced.

The repair scenario will fail validation once, assert one repair call, pass the
second validation, and verify that only the passed candidate becomes the active
snapshot.

## Route and Ownership Integration Coverage

Authenticated integration tests will create real Users, Projects, Runs, Events,
and Snapshots. They will cover:

- `POST /api/agent/runs` persists a queued Run, writes `run.created`, and enqueues
  the expected BullMQ job;
- another user cannot create against or read the first user's Project, Run,
  events, or Snapshot;
- SSE returns stored events in sequence order;
- `Last-Event-ID` excludes already delivered events;
- a live event published after connection is delivered once;
- cancellation persists `cancelled` and emits `run.cancelled`;
- a cancelled queued job is not restarted by the Worker.

Tests will use real signed JWTs through the existing authentication middleware,
not a bypass middleware.

## Deterministic Smoke Runtime

Smoke tests must not call OpenAI or run network-dependent package installation.
They will use a separate `smokeWorker.ts` entry point that imports deterministic
fake collaborators from an explicitly testing-only module.

The fake model will produce a small React/TypeScript/Tailwind file set. The fake
validator will return a passed validation result with the same public shape as
the production validator. This proves service wiring, queue consumption,
persistence, SSE, restoration, and UI state without duplicating validator unit
coverage or depending on package registry availability.

The production Worker will not select fake behavior through an environment
variable. Only the smoke-specific process entry imports the fake modules.

## Docker Compose Smoke Environment

`docker-compose.smoke.yml` will extend or override the normal Compose topology:

- use isolated service and volume names;
- start MongoDB, Redis, API, smoke Worker, and web;
- expose deterministic ports configurable through environment variables;
- add health checks for MongoDB, Redis, API, and web;
- build the same application images used by the normal Compose file;
- replace only the Worker command with the smoke Worker entry.

The smoke runner will:

1. start the Compose project with a unique project name;
2. wait for health checks;
3. run the API smoke;
4. run the Playwright browser smoke;
5. collect service logs on failure;
6. stop containers and remove only resources created under that project name.

It will not delete normal development volumes or unrelated Docker resources.

## API Smoke

The API smoke will use public HTTP endpoints:

1. register a unique user;
2. create a React/Tailwind Project;
3. create an Agent Run;
4. wait for terminal state with a bounded timeout;
5. assert the Run completed;
6. read the result Snapshot;
7. assert the Snapshot contains `src/App.tsx`, passed validation, and is active.

The script will exit non-zero with the latest Run and relevant service endpoint
information when a step fails.

## Browser Smoke

Playwright will open the real web service and exercise the visible product flow:

1. load the v0 home screen;
2. submit a unique prompt;
3. wait for the workspace;
4. observe at least one real Agent lifecycle step;
5. wait for the completed state;
6. open the Code panel;
7. assert `src/App.tsx` is visible;
8. assert the Snapshot history shows an active passed Snapshot;
9. reload and verify the active Snapshot is restored.

Selectors will use roles, labels, and stable test IDs only where semantic
selectors are insufficient. The smoke will not assert pixel layout.

## Error Handling

- SSE protocol parsing errors are terminal for the current connection and enter
  the bounded reconnect path.
- Authentication failures do not retry indefinitely; they reuse the existing
  application authentication behavior.
- A terminal Run event always triggers a final detail fetch before the stream is
  closed.
- Stream exhaustion activates polling without marking the generation failed.
- Container startup failures include the container name and recent logs.
- Smoke timeouts include the last observed Run status and visible workspace state.
- Cleanup errors are reported without hiding the original test failure.

## Commands

The implementation will provide these stable entry points:

```bash
npm run test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run test --workspace @v0/web
npm run test:smoke:api
npm run test:smoke:browser
npm run test:smoke
```

The repository's existing type-check and build commands remain required.

## Verification Criteria

Phase 6 is complete when:

- the workspace uses SSE for normal Run progress;
- disconnect and resume do not duplicate or omit persisted events;
- polling starts only after bounded stream recovery fails;
- integration tests use real MongoDB, Redis, BullMQ, auth middleware, and route
  handlers;
- fake Worker create and repair scenarios pass end to end;
- API smoke passes against the Compose topology;
- Playwright browser smoke passes and survives a page reload;
- smoke execution never requires an OpenAI API key;
- all existing unit tests, type-checks, and builds continue to pass;
- no production code path can enable the fake smoke model or validator.
