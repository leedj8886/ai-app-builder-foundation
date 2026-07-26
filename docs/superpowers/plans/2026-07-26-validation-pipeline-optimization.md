# Validation Pipeline Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated-project validation faster and more reliable by adding structural checks, persistent dependency caching, classified failures, infrastructure-only retries, and accurate timeline feedback.

**Architecture:** Keep source validation in disposable workspaces, but move npm downloads and dependency trees into fingerprinted persistent caches. Split validation into structure, dependencies, type-check, and build phases; return structured categorized results so the orchestrator retries infrastructure failures without involving the model and only sends actionable code or dependency failures to repair.

**Tech Stack:** TypeScript, Node.js child processes and filesystem APIs, MongoDB/Mongoose, BullMQ, Express, React, Node test runner, Docker Compose.

---

## File Structure

### Server files to create

- `apps/server/src/agent/validation/structure.ts`: deterministic pre-install project checks.
- `apps/server/src/agent/validation/classify.ts`: command-diagnostic classification and diagnostic fingerprints.
- `apps/server/src/agent/validation/dependencyFingerprint.ts`: stable SHA-256 dependency/cache identity.
- `apps/server/src/agent/validation/dependencyCache.ts`: locked, atomic dependency-tree cache.
- `apps/server/src/agent/validation/retry.ts`: bounded infrastructure retry policy.
- `apps/server/src/models/ValidationCandidate.ts`: generated candidate retained only when infrastructure prevents validation.

### Server files to modify

- `apps/server/src/agent/types.ts`: structured validation phases, categories, and check fields.
- `apps/server/src/agent/config.ts`: phase timeouts, cache roots, retry settings, retention settings.
- `apps/server/src/agent/validator.ts`: layered validation pipeline and progress callback.
- `apps/server/src/agent/orchestrator.ts`: category-aware repair/retry flow and candidate retry processing.
- `apps/server/src/agent/createWorker.ts`: route normal generation and candidate-validation jobs.
- `apps/server/src/agent/queue.ts`: typed retry-validation job payload.
- `apps/server/src/models/ProjectSnapshot.ts`: backward-compatible structured validation schema.
- `apps/server/src/models/AgentRun.ts`: retry relationship and retryable failure metadata.
- `apps/server/src/routes/agent.ts`: retry-validation endpoint.
- `apps/server/src/agent/chatTimeline.ts`: expose structured validation events and retryability.
- `docker-compose.yml`: persistent cache volume and validation configuration.
- `docker-compose.smoke.yml`: isolated smoke cache configuration.

### Web files to modify

- `apps/web/src/services/api.ts`: validation check/category and retry API types.
- `apps/web/src/lib/chatTimeline.ts`: category-aware labels and retry state.
- `apps/web/src/components/ConversationTimeline.tsx`: cache, retry, infrastructure, dependency, and code states.
- `apps/web/src/pages/V0Clone.tsx`: invoke retry validation and refresh the active timeline.

### Tests

- Add focused tests beside each new validation module.
- Extend `validator.test.ts`, `orchestrator.test.ts`, `createWorker.test.ts`,
  `chatTimeline.test.ts`, `agentRoutes.integration.ts`,
  `agentWorker.integration.ts`, and web timeline tests.

## Task 1: Add Structured Validation Types and Configuration

**Files:**
- Modify: `apps/server/src/agent/types.ts`
- Modify: `apps/server/src/agent/config.ts`
- Modify: `apps/server/src/agent/config.test.ts`

- [ ] **Step 1: Write failing configuration and type-shape tests**

Add to `apps/server/src/agent/config.test.ts`:

```ts
test('getAgentConfig exposes phase validation cache and retry defaults', () => {
  const config = getAgentConfig({});

  assert.equal(config.validation.structureTimeoutMs, 5_000);
  assert.equal(config.validation.cacheHitTimeoutMs, 15_000);
  assert.equal(config.validation.installTimeoutMs, 180_000);
  assert.equal(config.validation.typeCheckTimeoutMs, 60_000);
  assert.equal(config.validation.buildTimeoutMs, 120_000);
  assert.equal(config.validation.roundTimeoutMs, 300_000);
  assert.deepEqual(config.validation.infrastructureRetryDelaysMs, [5_000, 15_000]);
  assert.equal(config.validation.npmCacheRoot, '/var/cache/v0-agent/npm');
  assert.equal(config.validation.dependencyCacheRoot, '/var/cache/v0-agent/dependencies');
  assert.equal(config.validation.cacheRetentionMs, 7 * 24 * 60 * 60 * 1_000);
  assert.equal(config.validation.cacheMaxBytes, 10 * 1024 * 1024 * 1024);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  --test-name-pattern='phase validation cache and retry defaults' \
  src/agent/config.test.ts
```

Expected: FAIL because `config.validation` does not exist.

- [ ] **Step 3: Add structured validation types**

Replace the current validation check types in `apps/server/src/agent/types.ts`
with:

```ts
export const validationPhases = [
  'structure',
  'dependencies',
  'type-check',
  'build'
] as const;
export type ValidationPhase = (typeof validationPhases)[number];

export const validationErrorCategories = [
  'CODE_ERROR',
  'DEPENDENCY_ERROR',
  'INFRA_ERROR'
] as const;
export type ValidationErrorCategory =
  (typeof validationErrorCategories)[number];

export interface ValidationCheckResult {
  name: 'structure' | 'install' | 'type-check' | 'build';
  phase: ValidationPhase;
  status: 'passed' | 'failed' | 'retrying' | 'skipped';
  category?: ValidationErrorCategory;
  command?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  cache: 'hit' | 'miss' | 'not-applicable';
  attempt: number;
}

export interface ValidationResult {
  status: 'passed' | 'failed' | 'skipped';
  checks: ValidationCheckResult[];
  category?: ValidationErrorCategory;
  retryable?: boolean;
}
```

- [ ] **Step 4: Add validation configuration**

In `apps/server/src/agent/config.ts`, add:

```ts
export interface ValidationConfig {
  structureTimeoutMs: number;
  cacheHitTimeoutMs: number;
  installTimeoutMs: number;
  typeCheckTimeoutMs: number;
  buildTimeoutMs: number;
  roundTimeoutMs: number;
  infrastructureRetryDelaysMs: number[];
  npmCacheRoot: string;
  dependencyCacheRoot: string;
  cacheRetentionMs: number;
  cacheMaxBytes: number;
  maxOutputChars: number;
}
```

Build `config.validation` from `AGENT_VALIDATION_*` variables, with the exact
defaults asserted in Step 1. Parse retry delays from a comma-separated positive
integer list:

```ts
const numberListFromEnv = (
  value: string | undefined,
  fallback: number[]
): number[] => {
  if (!value) return fallback;
  const parsed = value.split(',').map(item => Number.parseInt(item.trim(), 10));
  return parsed.length > 0 && parsed.every(item => Number.isFinite(item) && item > 0)
    ? parsed
    : fallback;
};
```

Remove the superseded single `commandTimeoutMs` and
`maxValidationOutputChars` fields after updating their consumers in later
tasks; until then, retain aliases to keep the branch compiling.

- [ ] **Step 5: Run config tests and type-check**

Run:

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/config.test.ts
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node \
  ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: all config tests PASS and TypeScript exits zero.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agent/types.ts \
  apps/server/src/agent/config.ts \
  apps/server/src/agent/config.test.ts
git commit -m "feat: define structured validation configuration"
```

## Task 2: Add Structural Validation and Failure Classification

**Files:**
- Create: `apps/server/src/agent/validation/structure.ts`
- Create: `apps/server/src/agent/validation/structure.test.ts`
- Create: `apps/server/src/agent/validation/classify.ts`
- Create: `apps/server/src/agent/validation/classify.test.ts`

- [ ] **Step 1: Write failing structural validation tests**

Create `structure.test.ts` with cases for a valid template, a missing
`src/main.tsx`, invalid `package.json`, and a missing `type-check` script:

```ts
test('validateProjectStructure rejects a missing React entry before npm', () => {
  const result = validateProjectStructure([
    file('package.json', JSON.stringify(validPackageJson)),
    file('index.html', '<div id="root"></div>'),
    file('src/App.tsx', 'export default function App() { return null }')
  ]);

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'CODE_ERROR');
  assert.match(result.stderr, /src\\/main\\.tsx/);
});
```

- [ ] **Step 2: Write failing classification tests**

Create `classify.test.ts`:

```ts
test('classifyValidationFailure separates infrastructure and package errors', () => {
  assert.equal(classifyValidationFailure({
    phase: 'dependencies',
    exitCode: 124,
    stdout: '',
    stderr: 'Command timed out after 180000ms'
  }), 'INFRA_ERROR');

  assert.equal(classifyValidationFailure({
    phase: 'dependencies',
    exitCode: 1,
    stdout: '',
    stderr: 'npm error code E404 No match found for version 99.0.0'
  }), 'DEPENDENCY_ERROR');

  assert.equal(classifyValidationFailure({
    phase: 'type-check',
    exitCode: 2,
    stdout: '',
    stderr: 'src/App.tsx(3,2): error TS2322'
  }), 'CODE_ERROR');
});
```

Also assert that `diagnosticFingerprint()` normalizes workspace paths and
volatile durations so identical diagnostics produce the same SHA-256.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/validation/structure.test.ts \
  src/agent/validation/classify.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement structural validation**

Implement `validateProjectStructure(files)` as a pure function. It must:

```ts
export interface StructureCheckResult {
  status: 'passed' | 'failed';
  category?: ValidationErrorCategory;
  stdout: string;
  stderr: string;
}

const requiredPaths = ['package.json', 'index.html', 'src/App.tsx'];
const acceptedMainPaths = new Set(['src/main.tsx', 'src/index.tsx']);
```

Parse `package.json`, require scripts `type-check` and `build`, require React and
ReactDOM dependencies, reject duplicate/escaping paths, and return the first
concise deterministic diagnostic. Do not access the filesystem or invoke npm.

- [ ] **Step 5: Implement classification and fingerprinting**

In `classify.ts`, classify dependency diagnostics using explicit patterns:

```ts
const infrastructurePatterns = [
  /timed out/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /\b50[0234]\b/
];

const dependencyPatterns = [
  /\bE404\b/i,
  /\bERESOLVE\b/i,
  /No matching version found/i,
  /lock file.*out of sync/i
];
```

Default dependency-command failures to `DEPENDENCY_ERROR`; default type-check,
build, and structural source failures to `CODE_ERROR`. Normalize absolute
workspace paths, timestamps, durations, and repeated whitespace before hashing.

- [ ] **Step 6: Run focused tests**

Run the command from Step 3.

Expected: all structural and classification tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/agent/validation
git commit -m "feat: classify validation failures before repair"
```

## Task 3: Add Dependency Fingerprinting and Persistent Cache

**Files:**
- Create: `apps/server/src/agent/validation/dependencyFingerprint.ts`
- Create: `apps/server/src/agent/validation/dependencyFingerprint.test.ts`
- Create: `apps/server/src/agent/validation/dependencyCache.ts`
- Create: `apps/server/src/agent/validation/dependencyCache.test.ts`

- [ ] **Step 1: Write failing fingerprint tests**

Assert object ordering does not affect the fingerprint, while dependency
version, lockfile, Node version, or architecture changes do:

```ts
test('dependencyFingerprint is stable for reordered dependency maps', () => {
  const left = dependencyFingerprint({
    dependencies: { react: '^18', axios: '^1' },
    devDependencies: { vite: '^5' },
    lockfile: undefined,
    nodeVersion: '20.18.0',
    npmVersion: '10.8.2',
    platform: 'linux',
    arch: 'arm64'
  });
  const right = dependencyFingerprint({
    dependencies: { axios: '^1', react: '^18' },
    devDependencies: { vite: '^5' },
    lockfile: undefined,
    nodeVersion: '20.18.0',
    npmVersion: '10.8.2',
    platform: 'linux',
    arch: 'arm64'
  });
  assert.equal(left, right);
});
```

- [ ] **Step 2: Write failing cache tests**

Use a `mkdtemp` root and an injected installer. Assert:

- the first request installs and publishes;
- the second request returns `hit` without calling the installer;
- two concurrent requests call the installer once;
- a rejected installer releases the lock;
- an entry without the completion marker is treated as corrupt.

The public API should be:

```ts
export interface DependencyCache {
  prepare(input: {
    fingerprint: string;
    workspacePath: string;
    install(stagingPath: string): Promise<void>;
  }): Promise<{ cache: 'hit' | 'miss'; nodeModulesPath: string }>;
}
```

- [ ] **Step 3: Run tests and verify RED**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/validation/dependencyFingerprint.test.ts \
  src/agent/validation/dependencyCache.test.ts
```

Expected: FAIL because the modules are missing.

- [ ] **Step 4: Implement stable fingerprinting**

Sort dependency records, construct a versioned JSON payload, and hash with:

```ts
createHash('sha256').update(JSON.stringify(payload)).digest('hex')
```

Include a `schemaVersion: 1` field so future cache semantics can invalidate old
entries deliberately.

- [ ] **Step 5: Implement locked atomic cache publication**

Use these paths beneath the configured root:

```text
<root>/<fingerprint>/node_modules
<root>/<fingerprint>/complete.json
<root>/.locks/<fingerprint>.lock
<root>/.staging/<fingerprint>-<random>/
```

Acquire the lock with exclusive file creation (`open(..., 'wx')`). Waiting
callers poll the completion marker with an abortable bounded wait. Publish by
renaming the staging directory into the final fingerprint directory. Always
remove the lock in `finally`.

For Phase 1, link the cached tree into the workspace with a directory symlink:

```ts
await symlink(nodeModulesPath, path.join(workspacePath, 'node_modules'), 'dir');
```

Never write generated source into the cache.

- [ ] **Step 6: Run focused tests and full filesystem tests**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/validation/dependencyFingerprint.test.ts \
  src/agent/validation/dependencyCache.test.ts \
  src/agent/workspace/createWorkspace.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/agent/validation/dependencyFingerprint.ts \
  apps/server/src/agent/validation/dependencyFingerprint.test.ts \
  apps/server/src/agent/validation/dependencyCache.ts \
  apps/server/src/agent/validation/dependencyCache.test.ts
git commit -m "feat: cache validation dependencies by fingerprint"
```

## Task 4: Refactor the Validator into a Layered Pipeline

**Files:**
- Modify: `apps/server/src/agent/validator.ts`
- Modify: `apps/server/src/agent/validator.test.ts`
- Create: `apps/server/src/agent/validation/retry.ts`
- Create: `apps/server/src/agent/validation/retry.test.ts`
- Modify: `apps/server/src/agent/workspace/runCommand.ts`
- Modify: `apps/server/src/agent/workspace/runCommand.test.ts`

- [ ] **Step 1: Replace validator tests with the layered contract**

Add tests proving:

- structural failure executes zero commands;
- cache hit executes only type-check and build;
- a lockfile selects `npm ci`;
- no lockfile selects `npm install`;
- infrastructure install timeout retries twice and never calls code repair;
- package failure does not infrastructure-retry;
- type-check and build both execute and are recorded;
- approved proxy/registry variables reach npm but are absent from results.

Use a progress collector:

```ts
const progress: ValidationProgressEvent[] = [];
const result = await validator.validate({
  runId: 'run-1',
  files: templateFiles,
  onProgress: event => progress.push(event)
});
assert.deepEqual(progress.map(event => event.status), [
  'passed',
  'retrying',
  'retrying',
  'failed'
]);
```

- [ ] **Step 2: Write retry-policy tests**

In `retry.test.ts`, test that `runWithInfrastructureRetry()` waits 5 and 15
seconds only for `INFRA_ERROR`, using an injected delay function. Assert abort
propagation and no third delay.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/validator.test.ts \
  src/agent/validation/retry.test.ts
```

Expected: FAIL because the validator still has the old one-time command flow.

- [ ] **Step 4: Extend command execution with explicit safe environment**

Add a helper in `runCommand.ts`:

```ts
export const pickValidationEnvironment = (
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const allowed = [
    'PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'NPM_CONFIG_REGISTRY',
    'npm_config_registry'
  ];
  return Object.fromEntries(
    allowed.flatMap(key => env[key] === undefined ? [] : [[key, env[key]]])
  );
};
```

Do not serialize this environment into command results or events.

- [ ] **Step 5: Implement layered validation**

Change `ValidateProjectInput` to include:

```ts
onProgress?: (event: {
  phase: ValidationPhase;
  status: ValidationCheckResult['status'];
  category?: ValidationErrorCategory;
  attempt: number;
  retryDelayMs?: number;
  cache?: ValidationCheckResult['cache'];
  message: string;
}) => void | Promise<void>;
```

The implementation must:

1. run `validateProjectStructure`;
2. compute the dependency fingerprint;
3. call `dependencyCache.prepare`;
4. perform installation inside cache staging only on a miss;
5. retry classified infrastructure failures;
6. run type-check and build with their phase-specific timeouts;
7. return every completed check and the top-level category/retryable flag;
8. clean the source workspace in `finally`.

Use a round-level `AbortController` timer to enforce the five-minute budget and
pass its signal through retry waits and cache waits.

- [ ] **Step 6: Run validator, command, and type tests**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/validator.test.ts \
  src/agent/validation/*.test.ts \
  src/agent/workspace/runCommand.test.ts
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node \
  ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: all tests PASS and TypeScript exits zero.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/agent/validator.ts \
  apps/server/src/agent/validator.test.ts \
  apps/server/src/agent/validation/retry.ts \
  apps/server/src/agent/validation/retry.test.ts \
  apps/server/src/agent/workspace/runCommand.ts \
  apps/server/src/agent/workspace/runCommand.test.ts
git commit -m "feat: layer project validation with classified retries"
```

## Task 5: Make Orchestration Category-aware

**Files:**
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/agent/orchestrator.test.ts`
- Modify: `apps/server/src/agent/modelClient.ts`
- Modify: `apps/server/src/agent/modelClient.test.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Add tests asserting:

```ts
test('infrastructure validation failure never invokes model repair', async () => {
  const model = modelClientWithRepairCounter();
  const validator = validatorReturning({
    status: 'failed',
    category: 'INFRA_ERROR',
    retryable: true,
    checks: [infraInstallCheck]
  });

  await assert.rejects(runAgentGenerationWithValidation(input(model, validator)),
    (error: Error & { code?: string }) => error.code === 'VALIDATION_INFRA_ERROR');
  assert.equal(model.repairCalls, 0);
});
```

Also cover:

- `DEPENDENCY_ERROR` calls dependency-focused repair;
- `CODE_ERROR` calls source repair;
- no-op repair stops with `NO_EFFECTIVE_CHANGES`;
- identical diagnostic fingerprint twice stops before the configured maximum;
- validator progress emits sanitized `validation.step` events.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  --test-name-pattern='infrastructure validation|dependency-focused|diagnostic fingerprint' \
  src/agent/orchestrator.test.ts
```

Expected: FAIL because all validation failures currently enter the same repair
loop.

- [ ] **Step 3: Add a dependency repair contract**

Extend `ModelClient` with:

```ts
repairDependencies(input: RepairInput): Promise<ModelResult<GenerationResult>>;
```

Use a dedicated instruction that limits changes to `package.json`, dependency
maps, and directly related imports. Update fake clients and model-client tests
so code repair and dependency repair remain independently observable.

- [ ] **Step 4: Implement category-aware orchestration**

In the validation loop:

```ts
if (validation.category === 'INFRA_ERROR') {
  throw Object.assign(new Error('Validation environment is temporarily unavailable'), {
    code: 'VALIDATION_INFRA_ERROR',
    details: validation
  });
}

const fingerprint = diagnosticFingerprint(validation);
if (seenDiagnostics.has(fingerprint)) {
  throw Object.assign(new Error('Validation repair repeated the same failure'), {
    code: 'REPEATED_VALIDATION_FAILURE',
    details: validation
  });
}
seenDiagnostics.add(fingerprint);
```

Select `repairDependencies` only for `DEPENDENCY_ERROR`; otherwise use
`repairFiles`. Reuse the existing effective-change check for both files and
dependency maps.

- [ ] **Step 5: Emit phase progress events**

Add `validation.step` to `agentEventTypes` and emit progress payloads containing
only phase, status, category, attempt, retry delay, cache state, and a sanitized
message. Do not include environment data.

- [ ] **Step 6: Run server unit tests**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/orchestrator.test.ts \
  src/agent/modelClient.test.ts \
  src/agent/eventBus.test.ts \
  src/agent/models.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/agent/orchestrator.ts \
  apps/server/src/agent/orchestrator.test.ts \
  apps/server/src/agent/modelClient.ts \
  apps/server/src/agent/modelClient.test.ts \
  apps/server/src/agent/types.ts
git commit -m "feat: repair only actionable validation failures"
```

## Task 6: Persist Retryable Candidates and Add Revalidation Jobs

**Files:**
- Create: `apps/server/src/models/ValidationCandidate.ts`
- Modify: `apps/server/src/models/AgentRun.ts`
- Modify: `apps/server/src/agent/queue.ts`
- Modify: `apps/server/src/agent/createWorker.ts`
- Modify: `apps/server/src/agent/createWorker.test.ts`
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/integration/agentWorker.integration.ts`

- [ ] **Step 1: Write failing model and worker-routing tests**

Test that a validation candidate stores:

```ts
{
  userId,
  projectId,
  sourceRunId,
  files,
  packageJson,
  summary,
  expiresAt
}
```

Test that `createAgentJobProcessor` routes:

```ts
{ name: 'agent-run', data: { kind: 'generate', runId } }
{ name: 'retry-validation', data: { kind: 'retry-validation', runId, candidateId } }
```

to separate injected processors.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/createWorker.test.ts \
  src/agent/models.test.ts
```

Expected: FAIL because candidate persistence and retry job routing do not exist.

- [ ] **Step 3: Add candidate persistence**

Create `ValidationCandidate` with an `expiresAt` TTL index. Keep candidates for
24 hours by default. Store only server-normalized generated files and package
metadata; never store workspace paths, `node_modules`, caches, or environment.

Add to `AgentRun`:

```ts
retryOfRunId?: Types.ObjectId;
validationCandidateId?: Types.ObjectId;
retryable?: boolean;
```

- [ ] **Step 4: Persist candidates only for exhausted infrastructure errors**

When generation succeeds but validation ends with `VALIDATION_INFRA_ERROR`,
persist the candidate before marking the Run failed. Set
`validationCandidateId` and `retryable: true` on the failed Run.

Delete the candidate after successful validation and Snapshot persistence. TTL
is the safety net for abandoned failures.

- [ ] **Step 5: Add retry-validation job processing**

Implement `processValidationCandidate(jobData, validator)` to:

1. load the new queued Run and owned candidate;
2. transition it to validating;
3. validate the stored files without planning or generation;
4. persist and activate a Snapshot on success;
5. retain retryability on another infrastructure failure;
6. reject code/dependency failure without silently invoking generation.

- [ ] **Step 6: Add integration coverage**

In `agentWorker.integration.ts`, assert an infrastructure-failed candidate can
be retried to completion with zero `generatePlan`, `generateFiles`, and repair
calls.

- [ ] **Step 7: Run worker and integration tests**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/createWorker.test.ts \
  src/agent/models.test.ts
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  --test-concurrency=1 src/integration/agentWorker.integration.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/models/ValidationCandidate.ts \
  apps/server/src/models/AgentRun.ts \
  apps/server/src/agent/queue.ts \
  apps/server/src/agent/createWorker.ts \
  apps/server/src/agent/createWorker.test.ts \
  apps/server/src/agent/orchestrator.ts \
  apps/server/src/integration/agentWorker.integration.ts
git commit -m "feat: retry validation without regenerating code"
```

## Task 7: Add the Authenticated Retry-validation API

**Files:**
- Modify: `apps/server/src/routes/agent.ts`
- Modify: `apps/server/src/agent/schemas.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`

- [ ] **Step 1: Write failing route tests**

Cover:

- owned retryable failed Run returns `201` with a new queued Run;
- the new Run references `retryOfRunId` and the candidate;
- cross-user retry returns `404`;
- completed, non-retryable, or expired candidates return `409`;
- repeated requests create only one non-terminal retry Run.

Use:

```ts
await request(app)
  .post(`/api/agent/runs/${failedRun._id}/retry-validation`)
  .set('Authorization', `Bearer ${token}`)
  .expect(201);
```

- [ ] **Step 2: Run focused integration test and verify RED**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  --test-concurrency=1 \
  --test-name-pattern='retry validation' \
  src/integration/agentRoutes.integration.ts
```

Expected: FAIL with 404 because the route does not exist.

- [ ] **Step 3: Implement the route**

Add:

```text
POST /api/agent/runs/:runId/retry-validation
```

Resolve the failed source Run by `_id` and `userId`, require `retryable: true`
and a live owned candidate, atomically prevent another non-terminal retry, then
create a queued Run:

```ts
{
  userId,
  projectId: source.projectId,
  chatId: source.chatId,
  prompt: source.prompt,
  mode: source.mode,
  baseSnapshotId: source.baseSnapshotId,
  baseSnapshotRevision: source.baseSnapshotRevision,
  retryOfRunId: source._id,
  validationCandidateId: candidate._id,
  status: 'queued',
  model: source.model,
  maxRepairAttempts: source.maxRepairAttempts
}
```

Enqueue the typed retry-validation job and emit `run.created`.

- [ ] **Step 4: Run route integration tests**

Run the command from Step 2 without the name filter.

Expected: all route integration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/agent.ts \
  apps/server/src/agent/schemas.ts \
  apps/server/src/integration/agentRoutes.integration.ts
git commit -m "feat: expose retryable validation runs"
```

## Task 8: Persist Structured Checks Backward-compatibly

**Files:**
- Modify: `apps/server/src/models/ProjectSnapshot.ts`
- Modify: `apps/server/src/agent/models.test.ts`
- Modify: `apps/server/src/agent/chatTimeline.ts`
- Modify: `apps/server/src/agent/chatTimeline.test.ts`

- [ ] **Step 1: Write failing compatibility tests**

Test that:

- an old check with only `name`, `command`, `exitCode`, output, and duration
  still hydrates;
- a new structured check persists phase, status, category, cache, and attempt;
- a retryable infrastructure failure projects `retryable: true` into the
  timeline turn.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/models.test.ts \
  src/agent/chatTimeline.test.ts
```

Expected: FAIL because the Mongoose schema drops the new fields.

- [ ] **Step 3: Extend the Mongoose schema**

Add optional structured fields and defaults:

```ts
phase: {
  type: String,
  enum: ['structure', 'dependencies', 'type-check', 'build']
},
status: {
  type: String,
  enum: ['passed', 'failed', 'retrying', 'skipped']
},
category: {
  type: String,
  enum: ['CODE_ERROR', 'DEPENDENCY_ERROR', 'INFRA_ERROR']
},
cache: {
  type: String,
  enum: ['hit', 'miss', 'not-applicable'],
  default: 'not-applicable'
},
attempt: { type: Number, default: 0 }
```

Keep legacy `name`, command, exit code, output, and duration readable.
Make `command` and `exitCode` optional in both the TypeScript interface and
Mongoose schema because structural checks do not execute a command. Existing
documents retain their stored values, while new command-backed checks continue
to populate them.

- [ ] **Step 4: Extend timeline projection**

Expose validation progress payloads and `retryable` without exposing raw
candidate contents or IDs not needed by the client.

- [ ] **Step 5: Run focused tests**

Run the command from Step 2.

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/models/ProjectSnapshot.ts \
  apps/server/src/agent/models.test.ts \
  apps/server/src/agent/chatTimeline.ts \
  apps/server/src/agent/chatTimeline.test.ts
git commit -m "feat: persist structured validation diagnostics"
```

## Task 9: Render Validation Phases and Retry Action

**Files:**
- Modify: `apps/web/src/services/api.ts`
- Modify: `apps/web/src/lib/chatTimeline.ts`
- Modify: `apps/web/src/lib/chatTimeline.test.ts`
- Modify: `apps/web/src/components/ConversationTimeline.tsx`
- Modify: `apps/web/src/pages/V0Clone.tsx`

- [ ] **Step 1: Write failing timeline-state tests**

Add tests for labels and actions:

```ts
assert.equal(validationEventLabel({
  phase: 'dependencies',
  status: 'retrying',
  category: 'INFRA_ERROR',
  attempt: 1,
  retryDelayMs: 5_000,
  cache: 'miss'
}), '依赖服务暂时不可用，5 秒后重试（1/2）');

assert.equal(canRetryValidation(infraFailedTurn), true);
assert.equal(canRetryValidation(codeFailedTurn), false);
```

- [ ] **Step 2: Run web test and verify RED**

```bash
cd apps/web
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/lib/chatTimeline.test.ts
```

Expected: FAIL because validation-specific formatting and retry state are
missing.

- [ ] **Step 3: Add API types and retry method**

In `api.ts`, add structured validation progress fields and:

```ts
retryValidation: (runId: string) =>
  api.post<{ run: AgentRun }>(
    `/api/agent/runs/${runId}/retry-validation`
  )
```

- [ ] **Step 4: Add category-aware timeline helpers**

Export pure helpers for:

- structure, dependency cache, installation, type-check, and build labels;
- success, active, warning, and danger tones;
- `canRetryValidation(turn)`.

Infrastructure failures use warning tone; dependency and code failures use
danger tone.

- [ ] **Step 5: Render progress and retry**

Update `ConversationTimeline` so infrastructure warnings use an amber icon and
copy explaining that generated code has not been identified as faulty. Render:

```tsx
{canRetryValidation(turn) ? (
  <button
    className="mt-3 inline-flex h-8 items-center rounded-md bg-neutral-950 px-3 text-xs font-medium text-white"
    disabled={retryingRunId === turn.runId}
    onClick={() => onRetryValidation(turn.runId)}
  >
    {retryingRunId === turn.runId ? '正在重新验证…' : '重新验证'}
  </button>
) : null}
```

In `V0Clone.tsx`, call the API, insert the returned Run into the timeline, and
monitor it using the existing run monitor. Do not resend the user prompt or
create another Chat message.

- [ ] **Step 6: Run web tests, type-check, and build**

```bash
cd apps/web
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  "src/**/*.test.ts"
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node \
  ../../node_modules/typescript/bin/tsc --noEmit
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH npm run build
```

Expected: all tests PASS, type-check exits zero, and Vite build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/services/api.ts \
  apps/web/src/lib/chatTimeline.ts \
  apps/web/src/lib/chatTimeline.test.ts \
  apps/web/src/components/ConversationTimeline.tsx \
  apps/web/src/pages/V0Clone.tsx
git commit -m "feat: explain and retry validation failures"
```

## Task 10: Configure Persistent Cache Volumes and Cleanup

**Files:**
- Create: `apps/server/src/agent/validation/cacheCleanup.ts`
- Create: `apps/server/src/agent/validation/cacheCleanup.test.ts`
- Modify: `apps/server/src/worker.ts`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.smoke.yml`

- [ ] **Step 1: Write failing cleanup tests**

Test removal of entries older than seven days, oldest-first eviction above
10 GB, and preservation of locked or recently used entries. Inject filesystem
metadata and current time so the tests do not depend on wall-clock time.

- [ ] **Step 2: Run cleanup test and verify RED**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/validation/cacheCleanup.test.ts
```

Expected: FAIL because the cleanup module is missing.

- [ ] **Step 3: Implement bounded cleanup**

Export:

```ts
export const cleanupDependencyCache = async (input: {
  root: string;
  retentionMs: number;
  maxBytes: number;
  now?: number;
}): Promise<{ removedEntries: number; removedBytes: number }> => {
  // enumerate completed unlocked entries, remove expired, then evict LRU
};
```

Use completion metadata for `lastUsedAt` and size. Re-check the lock immediately
before deletion.

- [ ] **Step 4: Schedule cleanup without blocking worker startup**

Run cleanup once at worker startup and then every six hours. Catch and log only
the sanitized error message; cleanup failure must not stop the Worker.

- [ ] **Step 5: Add Compose volumes**

Add:

```yaml
services:
  worker:
    environment:
      - AGENT_VALIDATION_NPM_CACHE_ROOT=/var/cache/v0-agent/npm
      - AGENT_VALIDATION_DEPENDENCY_CACHE_ROOT=/var/cache/v0-agent/dependencies
    volumes:
      - agent_validation_cache:/var/cache/v0-agent

volumes:
  agent_validation_cache:
```

In smoke Compose, override with a smoke-specific named volume so tests cannot
consume production cache entries.

- [ ] **Step 6: Run cleanup tests and validate Compose**

```bash
cd apps/server
/Users/a015265/.nvm/versions/node/v24.16.0/bin/node --import tsx --test \
  src/agent/validation/cacheCleanup.test.ts
cd ../../
docker compose -f docker-compose.yml config >/tmp/v0-compose-config.yml
docker compose -f docker-compose.yml -f docker-compose.smoke.yml \
  config >/tmp/v0-smoke-compose-config.yml
```

Expected: test PASS and both Compose config commands exit zero.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/agent/validation/cacheCleanup.ts \
  apps/server/src/agent/validation/cacheCleanup.test.ts \
  apps/server/src/worker.ts \
  docker-compose.yml \
  docker-compose.smoke.yml
git commit -m "feat: retain and clean validation dependency caches"
```

## Task 11: End-to-end Verification

**Files:**
- Modify: `tests/smoke/api-smoke.ts`
- Modify: `tests/smoke/workspace.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Add smoke assertions**

Extend the API smoke test to run two edits with unchanged dependencies and
assert the second Run emits a dependency cache hit. Extend the browser test to
assert the timeline shows `依赖缓存命中`.

Add a deterministic smoke-validator mode that injects one transient
infrastructure failure, then succeeds, and assert no model repair event is
emitted.

- [ ] **Step 2: Document operator configuration**

Document:

- cache volume paths;
- timeout and retry environment variables;
- allowed proxy/registry variables;
- cache retention and maximum size;
- meanings of `CODE_ERROR`, `DEPENDENCY_ERROR`, and `INFRA_ERROR`;
- how the retry-validation action differs from regeneration.

- [ ] **Step 3: Run the complete unit and integration suites**

```bash
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH \
  npm test --workspace @v0/server
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH \
  npm test --workspace @v0/web
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH \
  npm run test:integration --workspace @v0/server
```

Expected: all suites PASS with zero failures.

- [ ] **Step 4: Run type-check and production builds**

```bash
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH npm run type-check
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH npm run build
```

Expected: both commands exit zero.

- [ ] **Step 5: Run Docker smoke tests**

```bash
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH npm run test:smoke
PATH=/Users/a015265/.nvm/versions/node/v24.16.0/bin:$PATH npm run test:smoke:browser
```

Expected: create, edit, infrastructure retry, cache hit, Snapshot persistence,
and timeline assertions PASS.

- [ ] **Step 6: Inspect security and cleanup evidence**

Verify test output and container state show:

- no proxy, registry credential, token, or certificate content in events/logs;
- temporary source workspaces removed;
- dependency cache retained;
- no lifecycle scripts executed;
- infrastructure failure made zero model repair calls.

- [ ] **Step 7: Commit**

```bash
git add tests/smoke/api-smoke.ts \
  tests/smoke/workspace.spec.ts \
  README.md
git commit -m "test: verify optimized validation pipeline"
```

## Final Acceptance Checklist

- [ ] Unchanged dependencies produce a cache hit and no network installation.
- [ ] Registry timeout is `INFRA_ERROR`, retries twice, and invokes no model.
- [ ] Invalid package/version is `DEPENDENCY_ERROR` and uses dependency repair.
- [ ] TypeScript/Vite failure is `CODE_ERROR` and uses source repair.
- [ ] Identical diagnostics and no-op repairs stop early.
- [ ] Old Snapshot validation documents remain readable.
- [ ] Retry validation reuses the stored candidate without creating a Chat turn.
- [ ] Temporary workspaces are always removed.
- [ ] Shared caches are isolated by fingerprint, bounded, and cleaned safely.
- [ ] Timeline distinguishes cache, environment, dependency, code, and success states.
