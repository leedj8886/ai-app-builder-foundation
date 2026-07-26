# Sandbox Core Implementation Plan

> **Execution constraint:** Implement this plan inline with `superpowers:executing-plans`. Do not dispatch subagents unless the user explicitly changes that preference. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the provider-neutral Sandbox Core, including Fake and development-only Local providers, durable leases, fail-closed quota scheduling, artifact hydration, controlled build commands, and reconciliation, without switching the existing Agent Worker.

**Architecture:** Add an isolated `apps/server/src/sandbox/` domain whose only application entry is `SandboxService`. MongoDB `SandboxLease` records are the durable resource truth, Redis is used only for short Workspace quota locks, and providers are injected behind `SandboxProvider`; Phase 2 ships Fake and Build-only Local implementations but no Daytona dependency.

**Tech Stack:** TypeScript, Node.js child processes and filesystem APIs, Mongoose/MongoDB, Redis/ioredis, Node test runner, Testcontainers.

---

## Scope and invariants

- Existing Agent Worker validation continues using the current host workspace.
- No Daytona SDK, PreviewDeployment, Preview Gateway, SecretBroker, or Sandbox HTTP API.
- LocalProcessProvider is development/test-only and cannot be selected in production.
- MongoDB never stores Provider SDK objects, tokens, endpoints, Bundle contents, or command logs.
- `reserved`, `provisioning`, `ready`, `running`, and `terminating` consume quota.
- A Build Branch has at most one quota-consuming Build SandboxLease.
- Redis failure rejects new reservations; it never falls back to unlocked Mongo counting.
- Non-terminated SandboxLease source artifacts count as Artifact Reconciler references.
- All implementation and review work remains inline.

## File map

### Sandbox core types and policy

- Create: `apps/server/src/sandbox/types.ts`
- Create: `apps/server/src/sandbox/errors.ts`
- Create: `apps/server/src/sandbox/config.ts`
- Create: `apps/server/src/sandbox/config.test.ts`
- Create: `apps/server/src/sandbox/path.ts`
- Create: `apps/server/src/sandbox/path.test.ts`
- Create: `apps/server/src/sandbox/policy.ts`
- Create: `apps/server/src/sandbox/policy.test.ts`

### Provider protocol and implementations

- Create: `apps/server/src/sandbox/provider/SandboxProvider.ts`
- Create: `apps/server/src/sandbox/provider/contract.ts`
- Create: `apps/server/src/sandbox/providers/FakeSandboxProvider.ts`
- Create: `apps/server/src/sandbox/providers/FakeSandboxProvider.test.ts`
- Create: `apps/server/src/sandbox/providers/LocalProcessProvider.ts`
- Create: `apps/server/src/sandbox/providers/LocalProcessProvider.test.ts`

### Lease, repository, locking, and scheduling

- Create: `apps/server/src/models/SandboxLease.ts`
- Modify: `apps/server/src/models/Project.ts`
- Modify: `apps/server/src/agent/models.test.ts`
- Create: `apps/server/src/sandbox/SandboxRepository.ts`
- Create: `apps/server/src/sandbox/SandboxRepository.integration.ts`
- Create: `apps/server/src/sandbox/WorkspaceQuotaLock.ts`
- Create: `apps/server/src/sandbox/WorkspaceQuotaLock.integration.ts`
- Create: `apps/server/src/sandbox/QuotaScheduler.ts`
- Create: `apps/server/src/sandbox/QuotaScheduler.integration.ts`

### Service and recovery

- Create: `apps/server/src/sandbox/SandboxService.ts`
- Create: `apps/server/src/sandbox/SandboxService.integration.ts`
- Create: `apps/server/src/sandbox/SandboxReconciler.ts`
- Create: `apps/server/src/sandbox/SandboxReconciler.integration.ts`
- Modify: `apps/server/src/artifacts/reconciler.ts`
- Modify: `apps/server/src/artifacts/reconciler.integration.ts`
- Modify: `apps/server/package.json`
- Modify: `README.md`

## Task 1: Define Sandbox types, errors, configuration, paths, and policy

**Files:**

- Create: `apps/server/src/sandbox/types.ts`
- Create: `apps/server/src/sandbox/errors.ts`
- Create: `apps/server/src/sandbox/config.ts`
- Create: `apps/server/src/sandbox/config.test.ts`
- Create: `apps/server/src/sandbox/path.ts`
- Create: `apps/server/src/sandbox/path.test.ts`
- Create: `apps/server/src/sandbox/policy.ts`
- Create: `apps/server/src/sandbox/policy.test.ts`

- [ ] **Step 1: Write failing configuration, path, and policy tests**

`config.test.ts` must assert:

```ts
assert.equal(getSandboxConfig({}).provider, 'fake');
assert.equal(getSandboxConfig({}).localEnabled, false);
assert.throws(
  () => getSandboxConfig({
    NODE_ENV: 'production',
    SANDBOX_PROVIDER: 'local',
    SANDBOX_LOCAL_ENABLED: 'true'
  }),
  /LocalProcessProvider cannot be enabled in production/
);
assert.throws(
  () => getSandboxConfig({ SANDBOX_QUOTA_LOCK_TTL_MS: '0' }),
  /positive safe integer/
);
```

`path.test.ts` must accept `src/App.tsx` and `package-lock.json`, normalize
backslash separators, and reject absolute paths, drive-letter paths, NUL,
empty segments, `.`, `..`, and paths outside the requested root.

`policy.test.ts` must assert:

```ts
const policy = createSandboxPolicy(config);
assert.deepEqual(
  policy.buildCommand('type-check', {
    hasPackageLock: false,
    maxOutputBytes: 1024
  }),
  {
    executable: 'npm',
    args: ['run', 'type-check'],
    cwd: '/workspace',
    env: { CI: 'true' },
    timeoutMs: config.commandTimeouts.typeCheck,
    maxOutputBytes: 1024
  }
);
assert.throws(
  () => policy.assertProviderAllowed('local', { production: true }),
  /SANDBOX_POLICY_DENIED/
);
```

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test \
  apps/server/src/sandbox/config.test.ts \
  apps/server/src/sandbox/path.test.ts \
  apps/server/src/sandbox/policy.test.ts
```

Expected: module-not-found failures for the three production modules.

- [ ] **Step 3: Define the canonical types**

`types.ts` exports the complete provider-neutral DTOs:

```ts
export type SandboxPurpose = 'build' | 'preview';
export type SandboxLeaseState =
  | 'reserved'
  | 'provisioning'
  | 'ready'
  | 'running'
  | 'terminating'
  | 'terminated'
  | 'failed'
  | 'lost';

export interface ResourceProfile {
  cpu: number;
  memoryMiB: number;
  diskMiB: number;
}

export interface SandboxOwnership {
  workspaceId: string;
  projectId: string;
  branchId: string;
  runId?: string;
  snapshotId?: string;
  purpose: SandboxPurpose;
}

export interface NetworkPolicy {
  defaultAction: 'deny' | 'allow';
  allowedDomains: string[];
  allowedCidrs: string[];
}

export interface SandboxSpec {
  provisioningKey: string;
  ownership: SandboxOwnership;
  runtime: { image: string; workingDirectory: string };
  resources: ResourceProfile;
  networkPolicy: NetworkPolicy;
  lifecycle: {
    leaseSeconds: number;
    autoStopSeconds?: number;
    autoDeleteSeconds: number;
  };
  labels: Record<string, string>;
}

export interface SandboxRef {
  provider: string;
  externalId: string;
}

export interface SandboxCommand {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputTruncated: boolean;
}
```

Define the remaining interfaces explicitly:

```ts
export interface SandboxProviderDescriptor {
  protocolVersion: 'sandbox-provider/v1';
  kind: string;
  capabilities: {
    files: true;
    processes: true;
    lifecycle: true;
    preview: boolean;
    networkPolicy: boolean;
    checkpoints: boolean;
    reconnectAcrossProcessRestart: boolean;
  };
}

export interface SandboxInspection {
  ref: SandboxRef;
  status: 'creating' | 'ready' | 'running' | 'stopped' | 'missing' | 'error';
  provisioningKey: string;
  createdAt: Date;
  labels: Record<string, string>;
}

export interface SandboxListFilter {
  provisioningKey?: string;
  labels?: Record<string, string>;
}

export interface SandboxDestroyReceipt {
  accepted: boolean;
  missing: boolean;
  pending: boolean;
}

export interface SandboxFileSystem {
  writeFiles(files: Array<{ path: string; content: Uint8Array }>): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export interface SandboxProcesses {
  run(command: SandboxCommand, signal?: AbortSignal): Promise<SandboxCommandResult>;
  stopAll(): Promise<void>;
}

export interface SandboxLifecycle {
  heartbeat(): Promise<void>;
  stop(): Promise<void>;
}

export interface SandboxPreview {
  start(port: number): Promise<{ internalEndpoint: string }>;
}

export interface SandboxNetworkControl {
  apply(policy: NetworkPolicy): Promise<void>;
}

export interface SandboxCheckpoints {
  create(name: string): Promise<{ checkpointId: string }>;
}

export interface SandboxHandle {
  readonly ref: SandboxRef;
  waitUntilReady(input: { timeoutMs: number }): Promise<void>;
  files: SandboxFileSystem;
  processes: SandboxProcesses;
  lifecycle: SandboxLifecycle;
  preview?: SandboxPreview;
  network?: SandboxNetworkControl;
  checkpoints?: SandboxCheckpoints;
}
```

- [ ] **Step 4: Implement stable errors**

`errors.ts` exports the exact union from the design plus:

```ts
export class SandboxError extends Error {
  constructor(
    public readonly code: SandboxErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown
  ) {
    super(`${code}: ${message}`);
  }
}

export type SandboxCreateOutcome = 'not-created' | 'unknown';

export class SandboxCreateError extends SandboxError {
  constructor(
    code: Extract<
      SandboxErrorCode,
      'SANDBOX_PROVIDER_UNAVAILABLE' | 'SANDBOX_PROVISION_FAILED'
    >,
    message: string,
    retryable: boolean,
    public readonly outcome: SandboxCreateOutcome,
    cause?: unknown
  ) {
    super(code, message, retryable, cause);
  }
}
```

Do not include provider messages in the public message. Add type guards
`isSandboxError()` and `isRetryableSandboxError()`.

- [ ] **Step 5: Implement strict configuration**

`getSandboxConfig(env = process.env)` parses only positive safe integers,
comma-separated non-empty image names, and exact booleans `true|false`.
Defaults:

```ts
{
  provider: 'fake',
  localEnabled: false,
  allowedBuildImages: ['node:22'],
  quotaLockTtlMs: 5_000,
  quotaLockWaitMs: 2_000,
  readinessTimeoutMs: 60_000,
  leaseSeconds: 900,
  autoDeleteSeconds: 1_800,
  orphanGraceMs: 300_000,
  commandTimeouts: {
    install: 180_000,
    typeCheck: 60_000,
    build: 120_000
  }
}
```

Reject Local provider/enabled Local mode when `NODE_ENV=production`.

- [ ] **Step 6: Implement path safety and policy**

`normalizeSandboxRelativePath()` converts `\` to `/`, rejects unsafe segments,
and returns a canonical relative path. `resolveSandboxPath(root, candidate)`
uses `path.resolve` and verifies containment.

`createSandboxPolicy()` provides:

```ts
type BuildCommandName = 'install' | 'type-check' | 'build';

interface SandboxPolicy {
  assertProviderAllowed(
    provider: string,
    context: { production: boolean }
  ): void;
  assertSpecAllowed(spec: SandboxSpec): void;
  requiredCapabilities(spec: SandboxSpec): string[];
  buildCommand(
    name: BuildCommandName,
    input: { hasPackageLock: boolean; maxOutputBytes: number }
  ): SandboxCommand;
}
```

Install maps to `npm ci` with a lockfile and `npm install` otherwise. Clamp
command output to the platform hard limit and the caller's Workspace limit.

- [ ] **Step 7: Verify and commit**

```bash
node --import tsx --test \
  apps/server/src/sandbox/config.test.ts \
  apps/server/src/sandbox/path.test.ts \
  apps/server/src/sandbox/policy.test.ts
npm run type-check --workspace @v0/server
git add apps/server/src/sandbox
git commit -m "feat: define sandbox core policy"
```

## Task 2: Implement the Provider contract and FakeSandboxProvider

**Files:**

- Create: `apps/server/src/sandbox/provider/SandboxProvider.ts`
- Create: `apps/server/src/sandbox/provider/contract.ts`
- Create: `apps/server/src/sandbox/providers/FakeSandboxProvider.ts`
- Create: `apps/server/src/sandbox/providers/FakeSandboxProvider.test.ts`

- [ ] **Step 1: Write the reusable contract**

`contract.ts` exports `runSandboxProviderContract()` and registers tests for:

```ts
export interface SandboxProviderContractFactory {
  name: string;
  createProvider(): SandboxProvider;
  buildSpec(): SandboxSpec;
}
```

The contract verifies:

- descriptor protocol and core capabilities;
- same provisioning key/spec returns one ref;
- same key/changed ownership rejects;
- connect/wait, write/read/exists;
- structured command execution;
- inspect/list labels;
- destroy twice is idempotent.

Fake-specific tests configure deterministic failures for create-after-resource,
readiness timeout, lost inspection, delayed destroy, and duplicate resources.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test \
  apps/server/src/sandbox/providers/FakeSandboxProvider.test.ts
```

Expected: missing Provider and Fake modules.

- [ ] **Step 3: Define the Provider interface**

`SandboxProvider.ts` exports:

```ts
export interface SandboxProvider {
  readonly kind: string;
  describe(): Promise<SandboxProviderDescriptor>;
  create(spec: SandboxSpec): Promise<SandboxRef>;
  connect(ref: SandboxRef): Promise<SandboxHandle>;
  inspect(ref: SandboxRef): Promise<SandboxInspection>;
  list(filter: SandboxListFilter): Promise<SandboxRef[]>;
  destroy(
    ref: SandboxRef,
    options?: { wait?: boolean }
  ): Promise<SandboxDestroyReceipt>;
}
```

- [ ] **Step 4: Implement FakeSandboxProvider**

Store resources in an injected `FakeSandboxState`. Each resource records the
canonical spec fingerprint, labels, files, commands, status, and creation
sequence. Expose test-only state methods through the injected state object, not
through the production Provider interface.

The state exposes these deterministic controls:

```ts
interface FakeSandboxResource {
  ref: SandboxRef;
  spec: SandboxSpec;
  status: SandboxInspection['status'];
  createdAt: Date;
  files: ReadonlyMap<string, Uint8Array>;
  commands: readonly SandboxCommand[];
}

class FakeSandboxState {
  failNextCreate(input: {
    outcome: 'not-created' | 'unknown';
    createResourceBeforeThrow: boolean;
  }): void;
  setReadiness(ref: SandboxRef, value: 'ready' | 'timeout'): void;
  setMissing(ref: SandboxRef): void;
  delayDestroy(ref: SandboxRef, attempts: number): void;
  seedDuplicate(spec: SandboxSpec): SandboxRef;
  advanceDestroy(ref: SandboxRef): void;
  resources(): ReadonlyArray<FakeSandboxResource>;
}
```

Create must first search by provisioning key. Changed spec returns
`SANDBOX_OWNERSHIP_MISMATCH`. Normal destroy transitions the resource to
missing; configured delayed destroy returns `pending: true` until the injected
state advances.

- [ ] **Step 5: Verify and commit**

```bash
node --import tsx --test \
  apps/server/src/sandbox/providers/FakeSandboxProvider.test.ts
npm run type-check --workspace @v0/server
git add apps/server/src/sandbox/provider \
  apps/server/src/sandbox/providers/FakeSandboxProvider.ts \
  apps/server/src/sandbox/providers/FakeSandboxProvider.test.ts
git commit -m "feat: add fake sandbox provider"
```

## Task 3: Implement the development-only LocalProcessProvider

**Files:**

- Create: `apps/server/src/sandbox/providers/LocalProcessProvider.ts`
- Create: `apps/server/src/sandbox/providers/LocalProcessProvider.test.ts`

- [ ] **Step 1: Add Local contract and security tests**

Run the shared Provider contract with a temporary provider root. Add tests that:

- reject preview purpose;
- reject deny-all or non-empty allowlists;
- reject traversal and a symlink component;
- truncate stdout/stderr independently;
- kill a timeout process and its descendant;
- remove the directory and processes on destroy;
- reject `connect()` from a fresh Provider instance because reconnect across
  process restart is unsupported.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test \
  apps/server/src/sandbox/providers/LocalProcessProvider.test.ts
```

- [ ] **Step 3: Implement filesystem lifecycle**

The constructor accepts a pre-created trusted root and `production: boolean`.
Reject construction in production. `create()` uses `mkdtemp` under the root,
writes a private metadata file containing the spec fingerprint, and keeps an
in-memory registry. Use `lstat` for every existing path component and
`O_NOFOLLOW` when opening final files.

`writeFiles()` creates directories inside the Sandbox root and writes with
`wx` temporary files followed by atomic replacement of regular destination
files. Replacement is required so `resumeProvisioning()` can replay a partial
Bundle upload idempotently. It must reject a symlink or non-regular destination
before replacement and must not follow symlinks.

- [ ] **Step 4: Implement controlled process execution**

Use:

```ts
spawn(command.executable, command.args, {
  cwd: resolvedCwd,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: sandboxHome,
    npm_config_cache: sandboxNpmCache,
    ...command.env
  },
  shell: false,
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe']
});
```

Reject env keys outside `CI`. Bound stdout and stderr separately without
unbounded concatenation. On timeout or abort, terminate the process group,
wait a bounded grace period, then force kill. Track active processes per
resource so destroy can stop them all.

- [ ] **Step 5: Verify and commit**

```bash
node --import tsx --test \
  apps/server/src/sandbox/providers/FakeSandboxProvider.test.ts \
  apps/server/src/sandbox/providers/LocalProcessProvider.test.ts
npm run type-check --workspace @v0/server
git add apps/server/src/sandbox/providers
git commit -m "feat: add local sandbox provider"
```

## Task 4: Add SandboxLease, Project limits, and SandboxRepository

**Files:**

- Create: `apps/server/src/models/SandboxLease.ts`
- Modify: `apps/server/src/models/Project.ts`
- Modify: `apps/server/src/agent/models.test.ts`
- Create: `apps/server/src/sandbox/SandboxRepository.ts`
- Create: `apps/server/src/sandbox/SandboxRepository.integration.ts`

- [ ] **Step 1: Write failing schema and transition tests**

Extend `models.test.ts` to assert every Lease path and exact indexes:

```ts
assert.ok(SandboxLease.schema.path('sourceArtifact.artifactId'));
assert.ok(SandboxLease.schema.path('spec.networkPolicy.defaultAction'));
assert.ok(Project.schema.path('sandboxLimits.maxConcurrentBuilds'));
assert.ok(Project.schema.path('sandboxLimits.maxRunningPreviews'));
```

Repository integration tests cover:

- create reserved;
- `reserved → provisioning → ready → running`;
- stale expected-state CAS fails without mutation;
- bind externalId once;
- same provisioning key and exact request reuses Lease;
- same key with changed scope/spec rejects;
- terminal Lease cannot return to an occupying state.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test apps/server/src/agent/models.test.ts
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxRepository.integration.ts
```

- [ ] **Step 3: Implement the models**

Create `SandboxLease` exactly from the design. Use a partial unique Build
Branch index:

```ts
SandboxLeaseSchema.index(
  { branchId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: {
      purpose: 'build',
      state: {
        $in: [
          'reserved',
          'provisioning',
          'ready',
          'running',
          'terminating'
        ]
      }
    }
  }
);
```

Add unique provisioning key, partial unique provider/externalId, Workspace,
Project, and expiry indexes. Validate resource numbers as positive finite
values and durations as positive safe integers.

Export concrete repository types from the model:

```ts
export type SandboxLeaseDocument = HydratedDocument<ISandboxLease>;
export type SandboxReservationRecord = Pick<
  ISandboxLease,
  | 'workspaceId'
  | 'projectId'
  | 'branchId'
  | 'requestedByUserId'
  | 'runId'
  | 'snapshotId'
  | 'sourceArtifact'
  | 'purpose'
  | 'provider'
  | 'provisioningKey'
  | 'spec'
  | 'resourceProfile'
  | 'reservedAt'
  | 'expiresAt'
>;
```

Project gains required defaulted:

```ts
sandboxLimits: {
  maxConcurrentBuilds: 2,
  maxRunningPreviews: 3
}
```

- [ ] **Step 4: Implement SandboxRepository**

Expose focused operations:

```ts
createReserved(input: SandboxReservationRecord): Promise<SandboxLeaseDocument>;
findByProvisioningKey(key: string): Promise<SandboxLeaseDocument | null>;
transition(input: {
  leaseId: Types.ObjectId;
  from: SandboxLeaseState[];
  to: SandboxLeaseState;
  set?: Record<string, unknown>;
}): Promise<SandboxLeaseDocument | null>;
bindExternalId(input: {
  leaseId: Types.ObjectId;
  provider: string;
  externalId: string;
}): Promise<SandboxLeaseDocument | null>;
findExpired(
  state: SandboxLeaseState,
  before: Date,
  limit: number
): AsyncIterable<SandboxLeaseDocument>;
```

Keep the allowed transition table in one exported constant and reject invalid
programmer transitions before issuing Mongo queries.

- [ ] **Step 5: Verify and commit**

```bash
node --import tsx --test apps/server/src/agent/models.test.ts
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxRepository.integration.ts
npm run type-check --workspace @v0/server
git add apps/server/src/models apps/server/src/agent/models.test.ts \
  apps/server/src/sandbox/SandboxRepository*
git commit -m "feat: persist sandbox leases"
```

## Task 5: Add the Redis Workspace lock and QuotaScheduler

**Files:**

- Create: `apps/server/src/sandbox/WorkspaceQuotaLock.ts`
- Create: `apps/server/src/sandbox/WorkspaceQuotaLock.integration.ts`
- Create: `apps/server/src/sandbox/QuotaScheduler.ts`
- Create: `apps/server/src/sandbox/QuotaScheduler.integration.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Write lock and quota RED tests**

Using real Redis and MongoDB Testcontainers, cover:

- lock acquisition, token-only release, and compare-PEXPIRE renewal;
- second waiter times out without entering its callback;
- Redis disconnect returns `SANDBOX_SCHEDULER_UNAVAILABLE`;
- two concurrent Build reservations on one Branch converge on one Lease;
- Project rejects a third Build and fourth Preview;
- Workspace rejects count, CPU, memory, and disk excess;
- same provisioning key reuses one Lease;
- changed same-key request returns ownership mismatch;
- Redis failure creates no Lease.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/WorkspaceQuotaLock.integration.ts \
  apps/server/src/sandbox/QuotaScheduler.integration.ts
```

- [ ] **Step 3: Implement WorkspaceQuotaLock**

The constructor accepts IORedis, TTL, wait, injected clock/random token, and
sleep. `withLock()`:

```ts
interface WorkspaceQuotaGuard {
  assertHeld(): Promise<void>;
}

withLock<T>(
  workspaceId: Types.ObjectId,
  callback: (guard: WorkspaceQuotaGuard) => Promise<T>
): Promise<T>;
```

1. retries `SET NX PX` with bounded jitter;
2. starts an unref renewal interval at `ttl/3`;
3. exposes `assertHeld()` to the callback;
4. compare-renews and compare-deletes with Lua;
5. maps Redis failures and lock loss to
   `SANDBOX_SCHEDULER_UNAVAILABLE`;
6. always clears renewal and attempts token-safe release.

- [ ] **Step 4: Implement QuotaScheduler**

Inside `withLock("sandbox-quota:<workspaceId>")`:

```ts
const OCCUPYING_STATES = [
  'reserved',
  'provisioning',
  'ready',
  'running',
  'terminating'
] as const;
```

Load Workspace, Project, Branch, and requester ownership. Validate
purpose-specific run/snapshot/source Artifact rules. Aggregate Project purpose
count and Workspace purpose/resource totals with Mongo aggregation. Call
`assertHeld()` immediately before `createReserved()`.

Catch E11000:

- provisioningKey conflict: reload, deep-compare canonical reservation, reuse
  or reject ownership mismatch;
- active Build Branch conflict: return `SANDBOX_BRANCH_BUSY`;
- all other duplicate errors propagate as internal failures.

- [ ] **Step 5: Register Sandbox integration tests**

Change `test:integration` to append:

```json
"node --import tsx --test --test-concurrency=1 \"src/sandbox/**/*.integration.ts\""
```

- [ ] **Step 6: Verify and commit**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/WorkspaceQuotaLock.integration.ts \
  apps/server/src/sandbox/QuotaScheduler.integration.ts
npm run type-check --workspace @v0/server
git add apps/server/package.json apps/server/src/sandbox
git commit -m "feat: schedule sandbox quotas"
```

## Task 6: Provision Build Sandboxes from owned Artifacts

**Files:**

- Create: `apps/server/src/sandbox/SandboxService.ts`
- Create: `apps/server/src/sandbox/SandboxService.integration.ts`

- [ ] **Step 1: Write provisioning RED tests**

With Fake Provider, real Mongo, Redis, and ArtifactService, cover:

- owned Candidate Artifact creates one ready Build Lease;
- owned Snapshot Artifact is also accepted;
- wrong Workspace/Project/kind fails before reservation;
- missing Capability fails before reservation;
- same provisioning key retry returns the same Lease/ref;
- provider create known-not-created marks failed;
- create unknown outcome leaves provisioning for reconciliation;
- readiness or file upload failure terminates and destroys the resource;
- persisted files contain Bundle files and canonical `package.json`.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxService.integration.ts
```

- [ ] **Step 3: Implement provider registry and Service construction**

`SandboxService` constructor receives:

```ts
{
  artifactService: ArtifactService;
  scheduler: QuotaScheduler;
  repository: SandboxRepository;
  policy: SandboxPolicy;
  providers: Map<string, SandboxProvider>;
  now?: () => Date;
}
```

No module-level runtime is constructed in Phase 2.

- [ ] **Step 4: Implement createBuildSandbox**

```ts
createBuildSandbox(input: {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  branchId: Types.ObjectId;
  requestedByUserId: Types.ObjectId;
  runId: Types.ObjectId;
  sourceArtifact: {
    artifactId: string;
    kind: 'project_snapshot' | 'validation_candidate';
  };
  provider: string;
  image: string;
  attempt: number;
  resources: ResourceProfile;
}): Promise<SandboxLeaseDocument>;
```

Execute the exact design order: policy, owned Artifact read, descriptor
capability check, reserve, CAS provisioning, idempotent create, bind external
ID, connect/readiness, write canonical files/package.json, CAS ready.

Build the upload set with a path-keyed Map. Bundle `packageJson` is serialized
with stable key order and always replaces a `files` entry named
`package.json`; there must be exactly one uploaded `package.json`.

Use a stable spec fingerprint when comparing idempotent requests. Provider
known-not-created errors transition to failed. Unknown create outcome remains
provisioning. Errors after external binding go through terminating/destroy
cleanup.

When `reserve()` returns an existing Lease:

- ready/running: return it after full ownership/spec comparison;
- provisioning with externalId: call `resumeProvisioning()`;
- reserved: attempt the normal reserved→provisioning CAS;
- terminating/terminated/failed/lost: return `SANDBOX_INVALID_STATE`.

- [ ] **Step 5: Extract resumable provisioning**

Implement:

```ts
resumeProvisioning(leaseId: Types.ObjectId): Promise<SandboxLeaseDocument>;
```

It reconstructs `SandboxSpec` from Lease, uses `sourceArtifact` for an owned
read, connects/waits, rewrites the complete Bundle, and CASes to ready. Both
normal creation and Reconciler use this method. A provisioning Lease without
externalId returns `SANDBOX_NOT_READY`; only creation or Reconciler resource
binding may supply that ID.

- [ ] **Step 6: Verify and commit**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxService.integration.ts
npm run type-check --workspace @v0/server
git add apps/server/src/sandbox/SandboxService*
git commit -m "feat: provision artifact sandboxes"
```

## Task 7: Add controlled commands and termination

**Files:**

- Modify: `apps/server/src/sandbox/SandboxService.ts`
- Modify: `apps/server/src/sandbox/SandboxService.integration.ts`

- [ ] **Step 1: Add command and termination RED tests**

Cover:

- install selects `ci` only when package-lock exists;
- caller cannot pass executable/args/cwd/env;
- first command transitions ready to running;
- non-zero exit returns bounded structured result;
- timeout maps to `SANDBOX_COMMAND_TIMEOUT`;
- lost Provider marks Lease lost;
- wrong ownership cannot execute or terminate;
- terminate is idempotent;
- pending destroy keeps terminating and quota occupied;
- confirmed missing transitions terminated and releases quota.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxService.integration.ts
```

- [ ] **Step 3: Implement controlled command execution**

Expose only:

```ts
runBuildCommand(input: {
  leaseId: Types.ObjectId;
  expectedOwnership: SandboxOwnership;
  command: 'install' | 'type-check' | 'build';
}): Promise<SandboxCommandResult>;
```

Read Workspace log limit, ask Policy for the full command, connect using the
Lease ref, and execute. Never accept command overrides. Timeout throws a stable
SandboxError; non-zero exit remains a result for future Agent repair logic.

- [ ] **Step 4: Implement termination**

```ts
terminate(input: {
  leaseId: Types.ObjectId;
  expectedOwnership: SandboxOwnership;
}): Promise<SandboxLeaseDocument>;
```

CAS to terminating, destroy, inspect, and transition only after missing.
Provider unavailable leaves terminating. Repeated calls resume the same flow.

- [ ] **Step 5: Verify and commit**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxService.integration.ts
npm run type-check --workspace @v0/server
git add apps/server/src/sandbox/SandboxService*
git commit -m "feat: run controlled sandbox builds"
```

## Task 8: Implement SandboxReconciler

**Files:**

- Create: `apps/server/src/sandbox/SandboxReconciler.ts`
- Create: `apps/server/src/sandbox/SandboxReconciler.integration.ts`

- [ ] **Step 1: Write failure-window RED tests**

Inject time and Fake Provider state. Cover:

1. expired reserved → failed;
2. expired provisioning/ready/running/lost/failed → terminating/terminated;
3. provisioning with externalId resumes files/readiness;
4. provisioning without externalId finds one resource and binds it;
5. no resource invokes idempotent create;
6. duplicate resources retain the oldest and destroy extras;
7. ready/running missing → lost;
8. failed/lost with a remaining resource is destroyed;
9. terminating repeats destroy until missing → terminated;
10. Provider unavailable preserves state;
11. managed orphan past grace is destroyed;
12. concurrent Reconcilers count one CAS transition.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxReconciler.integration.ts
```

- [ ] **Step 3: Implement bounded scans**

Export:

```ts
export const SANDBOX_RECONCILER_BATCH_SIZE = 100;

export interface SandboxReconcileResult {
  failedReservations: number;
  resumedProvisioning: number;
  lost: number;
  terminated: number;
  destroyedDuplicates: number;
  destroyedOrphans: number;
}
```

Use sorted Mongo cursors with `.limit(100)`. Process leases sequentially per
Provider to avoid uncontrolled API bursts. All counters increment only after a
successful CAS or confirmed destroy.

- [ ] **Step 4: Implement provisioning recovery and orphan rules**

Match resources by both provisioning key and all ownership labels. A label
mismatch is never adopted. For duplicates, inspect each and select the oldest
`createdAt`, breaking ties by externalId. Orphan deletion requires:

- `managed-by=open-v0`;
- no Lease by provider/externalId;
- age beyond orphan grace;
- ownership labels parse as valid IDs.

- [ ] **Step 5: Verify and commit**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/sandbox/SandboxReconciler.integration.ts
npm run type-check --workspace @v0/server
git add apps/server/src/sandbox/SandboxReconciler*
git commit -m "feat: reconcile sandbox leases"
```

## Task 9: Protect Lease source Artifacts and document Phase 2

**Files:**

- Modify: `apps/server/src/artifacts/reconciler.ts`
- Modify: `apps/server/src/artifacts/reconciler.integration.ts`
- Modify: `README.md`

- [ ] **Step 1: Add failing Artifact reference tests**

Create a ready Artifact older than retention, remove its Candidate/Snapshot
reference, and create:

```ts
await SandboxLease.create({
  // valid ownership/spec fields
  sourceArtifact: {
    artifactId: manifest.artifactId,
    kind: 'validation_candidate'
  },
  state: 'provisioning'
});
```

Assert Artifact Reconciler preserves it. Transition Lease to terminated and
assert the next Reconciler run deletes the Artifact.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/artifacts/reconciler.integration.ts
```

- [ ] **Step 3: Extend reference checking**

Add:

```ts
SandboxLease.exists({
  'sourceArtifact.artifactId': artifactId,
  state: { $ne: 'terminated' }
});
```

to both ready and delete_pending reference checks. Query Snapshot, Candidate,
and Lease in parallel.

- [ ] **Step 4: Document operation and non-integration**

README must state:

- Phase 2 Core is provider-neutral and does not change Worker validation.
- Fake is the default test Provider.
- Local is development-only and has no network isolation.
- Redis failure blocks new reservations.
- Mongo Lease states that consume quota.
- Daytona and Preview remain later phases.

- [ ] **Step 5: Verify and commit**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/artifacts/reconciler.integration.ts
npm run build --workspace @v0/server
git add apps/server/src/artifacts README.md
git commit -m "feat: retain sandbox source artifacts"
```

## Task 10: Full Sandbox Core verification and inline review

**Files:**

- Modify only files already listed if verification exposes a defect.

- [ ] **Step 1: Check forbidden dependencies and integration**

```bash
rg -n \"daytona|express|bullmq\" apps/server/src/sandbox
rg -n \"SandboxService|LocalProcessProvider\" \
  apps/server/src/agent apps/server/src/worker.ts
```

Expected: no Daytona/Express/BullMQ imports in Sandbox Core and no Worker
integration. Test descriptions may mention the words but production imports
must not.

- [ ] **Step 2: Run all Sandbox unit tests**

```bash
node --import tsx --test \"apps/server/src/sandbox/**/*.test.ts\"
```

- [ ] **Step 3: Run all Server unit tests**

```bash
npm test --workspace @v0/server
```

- [ ] **Step 4: Run all integration suites**

```bash
npm run test:integration --workspace @v0/server
```

Expected: existing Agent, Artifact, and new Sandbox integration suites pass.

- [ ] **Step 5: Run Server type-check and build**

```bash
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

- [ ] **Step 6: Run Web regression**

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

- [ ] **Step 7: Inspect invariants and user changes**

```bash
git diff --check
git status --short
git log --oneline --max-count=12
```

Expected: preserve the pre-existing root `package.json` and
`tests/repository/` changes. Do not stage or modify them.

- [ ] **Step 8: Perform inline specification and quality review**

Review the implementation against every acceptance criterion in
`docs/superpowers/specs/2026-07-26-sandbox-core-design.md`. Check Mongo
partial-index behavior, lock-loss paths, Provider idempotency, process-tree
cleanup, ownership scope, Artifact retention, and Reconciler CAS counters.
Fix any Critical, Important, or Minor correctness issue inline and rerun the
affected tests.

## Final acceptance checklist

- [ ] Fake and Local providers pass one shared contract.
- [ ] Local uses no shell string and cannot run in production.
- [ ] SandboxLease has exact durable state, source Artifact, Spec, and quota indexes.
- [ ] Build Branch/Project/Workspace quotas do not oversell in concurrent tests.
- [ ] Redis outage creates no Lease.
- [ ] SandboxService restores owned Artifact content without Worker integration.
- [ ] Only fixed Build commands are executable.
- [ ] Terminating resources continue consuming quota until confirmed missing.
- [ ] Reconciler restores create/bind crash windows and removes managed orphans.
- [ ] Non-terminated Lease source Artifacts survive Artifact reconciliation.
- [ ] No Daytona, PreviewDeployment, Express, or BullMQ dependency enters Sandbox Core.
- [ ] Server/Web full tests, type-checks, and builds pass.
