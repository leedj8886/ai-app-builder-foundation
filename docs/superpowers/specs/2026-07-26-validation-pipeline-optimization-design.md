# Validation Pipeline Optimization Design

## Context

The current Agent validator creates a fresh temporary workspace for every
validation attempt and runs:

1. `npm install --ignore-scripts --no-audit --no-fund`;
2. `npm run type-check`;
3. `npm run build`.

The workspace-local npm cache is deleted with the workspace. Installation uses
a single 120-second command timeout and receives only `PATH` plus the temporary
cache location. Installation failures stop the remaining checks and are treated
like generated-code failures, so the Agent may ask the model to edit code or
dependencies when the actual cause is registry latency, proxy configuration, or
another infrastructure problem.

The recent failing Run demonstrated the issue: dependency installation timed
out three times, while two model repair attempts could not address the
underlying environment failure.

## Goals

- Make repeated validation substantially faster when dependencies are
  unchanged.
- Distinguish generated-code failures, dependency declaration failures, and
  infrastructure failures.
- Prevent infrastructure failures from consuming model repair attempts.
- Preserve isolated source workspaces and the security property of disabled
  dependency lifecycle scripts.
- Provide enough structured progress and diagnostics for the timeline UI to
  explain what happened.
- Remain compatible with existing Snapshots and validation consumers.

## Non-goals

- Maintaining a permanently running preview or build container per project.
- Adding ESLint, unit tests, browser tests, or accessibility audits in the first
  implementation phase.
- Executing dependency lifecycle scripts.
- Making a lockfile mandatory for generated projects.
- Redesigning unrelated Agent planning or generation behavior.

## Considered Approaches

### Extend timeouts and retain the npm download cache

This is the smallest change, but installation outages would still be reported
as code validation failures and could still trigger ineffective model repairs.

### Layered validation with dependency caching and classified failures

This design separates structural validation, dependency preparation, code
checks, and result classification. It offers most of the speed of a persistent
environment while retaining per-attempt source isolation. This is the selected
approach.

### Persistent project build sandboxes

A long-lived sandbox can avoid nearly all dependency setup, but introduces
project lifecycle management, concurrency consistency, disk reclamation, and
greater cross-run contamination risk. It is deferred until measurements show
that dependency-fingerprint caching is insufficient.

## Validation Architecture

Validation is split into four layers.

### 1. Structural validation

Before invoking npm, the validator checks:

- required Vite and React entry files exist;
- every file path remains inside the project root;
- `package.json` is valid JSON and matches the server-owned package model;
- required scripts and supported source-file types are present.

Structural validation has a five-second budget. A failure is a code or
dependency declaration error, depending on the affected field, and skips
dependency preparation.

### 2. Dependency preparation

The validator computes a SHA-256 dependency fingerprint from:

- normalized `dependencies`;
- normalized `devDependencies`;
- lockfile content when present;
- Node and npm versions;
- operating system and CPU architecture.

Two persistent cache layers are used:

1. a shared npm download cache at `/var/cache/v0-agent/npm`;
2. a `node_modules` cache keyed by dependency fingerprint.

On a cache hit, the cached dependency tree is made available to the temporary
workspace. On a miss, the validator runs:

- `npm ci --ignore-scripts --no-audit --no-fund` when a supported lockfile is
  present;
- otherwise `npm install --ignore-scripts --no-audit --no-fund`.

Successful installation publishes the dependency tree to the cache atomically.
Concurrent validation for the same fingerprint is protected by a lock so only
one installation populates that entry. Other callers wait for the result and
then consume the completed cache entry.

The cache is an optimization, not a correctness dependency. Corrupt or
unavailable entries are discarded or bypassed and validation falls back to a
clean installation.

### 3. Code checks

After dependencies are available, the validator runs:

1. `npm run type-check`;
2. `npm run build`.

Both checks are recorded even when type checking fails, so one validation round
can return all immediately available diagnostics. A successful result requires
both commands to exit with code zero.

### 4. Classification and orchestration

Failures are classified as:

- `CODE_ERROR`: TypeScript, Vite, imports, source syntax, or generated file
  structure that the model can repair.
- `DEPENDENCY_ERROR`: missing packages, invalid versions, lockfile mismatch, or
  invalid dependency declarations that the model can repair.
- `INFRA_ERROR`: DNS, connection timeout, registry 5xx, proxy, certificate,
  disk, permission, worker termination, or cache infrastructure failure that
  the model cannot repair.

`CODE_ERROR` invokes source repair. `DEPENDENCY_ERROR` invokes a
dependency-focused repair. `INFRA_ERROR` never invokes the model and instead
uses infrastructure retry behavior.

## Timeouts and Retries

The default budgets are:

| Phase | Timeout |
| --- | ---: |
| Structural validation | 5 seconds |
| Dependency preparation on cache hit | 15 seconds |
| Fresh dependency installation | 180 seconds |
| TypeScript check | 60 seconds |
| Production build | 120 seconds |
| Entire validation round | 5 minutes |

Transient infrastructure failures are retried at most twice, after delays of
five and fifteen seconds. These retries do not increment or consume the Agent's
model repair counter.

Package-not-found errors, invalid versions, dependency conflicts, and lockfile
mismatches do not receive infrastructure retries. They are classified as
`DEPENDENCY_ERROR`.

If the same normalized diagnostic fingerprint occurs twice after model repairs,
the repair loop stops early. A repair response that produces no effective file
or dependency change also stops immediately.

## Environment Propagation and Security

Commands continue to use direct process spawning without a shell.

Validation explicitly passes:

- `PATH`;
- the persistent npm cache path;
- approved npm registry configuration;
- approved proxy and certificate environment variables needed by npm.

Secrets and environment-variable values are never included in events, logs, or
validation results. Dependency lifecycle scripts remain disabled with
`--ignore-scripts`. Generated commands and generated validation scripts are not
executed.

## Workspace and Cache Lifecycle

Source files are written to a unique temporary workspace for every validation
round. The workspace is always removed after validation.

Persistent caches are outside the temporary workspace:

- npm download cache entries are shared across validation tasks;
- dependency-tree entries are keyed by fingerprint;
- entries track last-used time;
- entries unused for seven days are eligible for removal;
- total dependency-tree cache size is limited to 10 GB;
- cleanup runs independently and never blocks an active Run.

Cache writes use a temporary entry followed by an atomic rename. Cleanup does
not remove locked or actively referenced entries.

## Validation Data Model

The top-level `validation.status` field remains `passed`, `failed`, or
`skipped` for compatibility. Each check gains structured phase information:

```ts
interface ValidationCheck {
  phase: 'structure' | 'dependencies' | 'type-check' | 'build'
  status: 'passed' | 'failed' | 'retrying' | 'skipped'
  category?: 'CODE_ERROR' | 'DEPENDENCY_ERROR' | 'INFRA_ERROR'
  command?: string
  exitCode?: number
  durationMs: number
  stdout: string
  stderr: string
  cache?: 'hit' | 'miss' | 'not-applicable'
  attempt: number
}
```

Existing fields required by current API consumers remain populated for command
checks. New fields are optional while old Snapshot documents and clients are
supported.

Retry events include the phase, classified category, current retry number,
maximum retries, and next delay. They contain sanitized diagnostics rather than
raw environment or credential data.

## Timeline Experience

The conversation timeline presents distinct progress:

- project structure checked;
- dependency cache hit, or dependency installation in progress;
- transient dependency failure and scheduled retry;
- TypeScript check passed;
- production build passed;
- validation passed.

Failure presentation is category-specific:

- infrastructure errors use a warning state and explain that generated code has
  not been identified as faulty;
- dependency errors identify the package or declaration and show dependency
  repair progress;
- code errors show the first concise TypeScript or Vite diagnostic and show
  source repair progress.

An exhausted infrastructure retry exposes a "重新验证" action. The action
starts validation again against the same generated candidate without asking the
model to regenerate it.

## Model Repair Contracts

For `CODE_ERROR`, repair input contains the current project files, original
plan, repair attempt, and concise compiler/build diagnostics.

For `DEPENDENCY_ERROR`, repair input emphasizes `package.json`, lockfile state,
and dependency diagnostics. The model is instructed to limit changes to
dependency declarations unless a source import also needs correction.

`INFRA_ERROR` is never sent to the model.

After every repair:

- dependency and file diffs are calculated;
- no-op repairs are rejected;
- a normalized diagnostic fingerprint is compared with previous attempts;
- dependency fingerprints are recalculated only when dependency inputs change.

## Testing Strategy

### Unit tests

- deterministic dependency fingerprinting;
- cache hit, miss, corruption fallback, and atomic publication;
- infrastructure, dependency, and code error classification;
- timeout and retry policy;
- repeated diagnostic detection;
- no-op repair detection;
- sanitization of proxy, registry, and certificate configuration.

### Validator tests

- structural failure skips installation;
- installation failure skips type checking and build;
- cache hit avoids installation;
- lockfile selects `npm ci`;
- missing lockfile selects `npm install`;
- type checking and build are both recorded;
- temporary workspaces are removed on every outcome;
- shared cache data survives workspace cleanup.

### Concurrency tests

- simultaneous requests for one fingerprint perform one installation;
- failed cache population releases the lock;
- cache cleanup ignores locked and active entries.

### Integration tests

- a network timeout retries without invoking model repair;
- a dependency declaration error invokes dependency repair;
- a TypeScript failure invokes source repair;
- successful repair produces and activates a Snapshot;
- exhausted infrastructure retry produces a retryable Run failure.

### Frontend tests

- cache hit, installing, retrying, and passed states have distinct labels;
- infrastructure warnings differ from code and dependency failures;
- the first concise diagnostic is displayed;
- "重新验证" is available only for retryable infrastructure failures.

## Delivery Phases

### Phase 1

- structural validation;
- persistent npm download cache;
- dependency fingerprint and dependency-tree cache;
- per-phase timeout configuration;
- error classification and infrastructure retry;
- prevent infrastructure failures from invoking model repair;
- structured events and timeline states;
- retry validation against the same generated candidate.

### Phase 2

- cache size and age cleanup worker;
- detailed cache metrics and validation timing;
- dependency-focused model repair contract refinements;
- optional additional checks based on observed needs.

Persistent per-project sandboxes, linting, test execution, browser smoke tests,
and accessibility checks remain separate future designs.

## Success Criteria

- An Edit Run with unchanged dependencies does not perform a network
  installation after its dependency cache has been populated.
- A transient registry timeout is labeled `INFRA_ERROR`, receives at most two
  infrastructure retries, and makes zero model repair calls.
- A TypeScript error is labeled `CODE_ERROR` and can be repaired through the
  existing bounded model repair loop.
- A missing or invalid dependency is labeled `DEPENDENCY_ERROR`.
- Existing Snapshot validation data remains readable.
- Temporary source workspaces are cleaned on every path.
- Cache entries do not cross dependency fingerprints and do not exceed the
  configured retention policy after cleanup runs.
