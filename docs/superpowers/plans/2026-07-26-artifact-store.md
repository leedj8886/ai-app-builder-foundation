# ArtifactStore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every ProjectSnapshot and ValidationCandidate source bundle as an immutable, verified gzip JSON Artifact on shared storage while MongoDB stores only metadata and artifact references.

**Architecture:** Add a narrow byte-oriented `ArtifactStore`, a shared-filesystem implementation, and an `ArtifactService` that owns normalization, compression, hashing, idempotency, and Manifest state. Switch Snapshot/Candidate creation and hydration to that service directly, without legacy MongoDB-field migration or fallback reads.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `crypto`, `zlib`, Mongoose/MongoDB, Node test runner, Testcontainers.

---

## Scope and rollout

This is a final-state change for a new project:

- No data migration for existing ProjectSnapshot or ValidationCandidate documents.
- No dual-write and no MongoDB fallback.
- `files` and `packageJson` are removed from both schemas in the same release.
- The existing Workspace/Branch migration remains unchanged.
- API and Worker must deploy together.
- All API and Worker replicas must mount the same `ARTIFACT_STORE_ROOT`.

This plan does not implement S3, SandboxProvider, Daytona, PreviewDeployment,
incremental artifacts, or a recurring reconciler scheduler.

## File map

### New Artifact core

- `apps/server/src/artifacts/types.ts` — Bundle, Manifest and error types.
- `apps/server/src/artifacts/bundle.ts` — validation, normalization, stable JSON, gzip and SHA-256.
- `apps/server/src/artifacts/config.ts` — environment parsing and limits.
- `apps/server/src/artifacts/ArtifactStore.ts` — byte-store protocol.
- `apps/server/src/artifacts/SharedFilesystemArtifactStore.ts` — shared PVC/NFS implementation.
- `apps/server/src/artifacts/artifactService.ts` — Manifest state machine and verified reads.
- `apps/server/src/artifacts/runtime.ts` — lazy production service construction.
- `apps/server/src/artifacts/reconciler.ts` — one-shot reconciliation.
- `apps/server/src/artifacts/testing.ts` — Artifact-backed test fixture helpers.
- `apps/server/src/models/ArtifactManifest.ts` — MongoDB Manifest.
- `apps/server/src/reconcileArtifacts.ts` — CLI.

### Modified domain and runtime files

- `apps/server/src/models/ProjectSnapshot.ts`
- `apps/server/src/models/ValidationCandidate.ts`
- `apps/server/src/agent/contextBuilder.ts`
- `apps/server/src/agent/orchestrator.ts`
- `apps/server/src/routes/project.ts`
- `apps/server/src/routes/chat.ts`
- `apps/server/src/integration/agentRoutes.integration.ts`
- `apps/server/src/integration/agentWorker.integration.ts`
- `apps/server/src/testing/integrationEnvironment.ts`
- `apps/server/src/agent/models.test.ts`
- `apps/server/package.json`
- `README.md`

## Task 1: Define and verify the canonical Artifact Bundle

**Files:**

- Create: `apps/server/src/artifacts/types.ts`
- Create: `apps/server/src/artifacts/bundle.ts`
- Create: `apps/server/src/artifacts/bundle.test.ts`

- [ ] **Step 1: Write failing normalization and safety tests**

Create `apps/server/src/artifacts/bundle.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeProjectArtifact,
  encodeProjectArtifact
} from './bundle';

const bundle = {
  version: 1 as const,
  files: [
    { path: 'src/App.tsx', content: 'export default 1', language: 'tsx' as const },
    { path: 'index.html', content: '<div id="root"></div>', language: 'html' as const }
  ],
  packageJson: {
    dependencies: { react: '^18.3.0', axios: '^1.7.0' },
    devDependencies: { vite: '^5.4.0' },
    scripts: { build: 'vite build', dev: 'vite' }
  }
};

test('canonical encoding is stable across input ordering', async () => {
  const first = await encodeProjectArtifact(bundle, {
    maxBundleBytes: 1_000_000,
    maxCompressedBytes: 1_000_000,
    maxFiles: 100
  });
  const second = await encodeProjectArtifact({
    ...bundle,
    files: [...bundle.files].reverse(),
    packageJson: {
      dependencies: { axios: '^1.7.0', react: '^18.3.0' },
      devDependencies: { vite: '^5.4.0' },
      scripts: { dev: 'vite', build: 'vite build' }
    }
  }, {
    maxBundleBytes: 1_000_000,
    maxCompressedBytes: 1_000_000,
    maxFiles: 100
  });

  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.uncompressedBytes, second.uncompressedBytes);
  assert.deepEqual(
    await decodeProjectArtifact(first.compressedBytes, first.manifest, {
      maxBundleBytes: 1_000_000,
      maxCompressedBytes: 1_000_000,
      maxFiles: 100
    }),
    await decodeProjectArtifact(second.compressedBytes, second.manifest, {
      maxBundleBytes: 1_000_000,
      maxCompressedBytes: 1_000_000,
      maxFiles: 100
    })
  );
});

test('encoding rejects unsafe duplicate and unsupported files', async () => {
  for (const files of [
    [{ path: '../secret.ts', content: '', language: 'ts' }],
    [
      { path: 'src/a.ts', content: 'a', language: 'ts' },
      { path: 'src/a.ts', content: 'b', language: 'ts' }
    ],
    [{ path: 'src/a.exe', content: '', language: 'ts' }]
  ]) {
    await assert.rejects(
      encodeProjectArtifact({
        version: 1,
        files: files as never,
        packageJson: { dependencies: {}, devDependencies: {}, scripts: {} }
      }, {
        maxBundleBytes: 1_000_000,
        maxCompressedBytes: 1_000_000,
        maxFiles: 100
      }),
      /ARTIFACT_INVALID_PATH|ARTIFACT_INVALID_BUNDLE/
    );
  }
});

test('decode rejects size hash and version mismatches', async () => {
  const encoded = await encodeProjectArtifact(bundle, {
    maxBundleBytes: 1_000_000,
    maxCompressedBytes: 1_000_000,
    maxFiles: 100
  });

  await assert.rejects(
    decodeProjectArtifact(encoded.compressedBytes, {
      ...encoded.manifest,
      sha256: '0'.repeat(64)
    }, {
      maxBundleBytes: 1_000_000,
      maxCompressedBytes: 1_000_000,
      maxFiles: 100
    }),
    /ARTIFACT_CORRUPT/
  );
  await assert.rejects(
    decodeProjectArtifact(encoded.compressedBytes, encoded.manifest, {
      maxBundleBytes: 1,
      maxCompressedBytes: 1_000_000,
      maxFiles: 100
    }),
    /ARTIFACT_LIMIT_EXCEEDED/
  );
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --import tsx --test apps/server/src/artifacts/bundle.test.ts
```

Expected: FAIL because `bundle.ts` does not exist.

- [ ] **Step 3: Implement Artifact types and canonical encoding**

Create `apps/server/src/artifacts/types.ts` with:

```ts
import type { ProjectFile, ProjectSnapshotPackageJson } from '../agent/types';

export const artifactKinds = [
  'project_snapshot',
  'validation_candidate'
] as const;
export type ArtifactKind = typeof artifactKinds[number];

export const artifactManifestStates = [
  'writing',
  'ready',
  'corrupt',
  'delete_pending'
] as const;
export type ArtifactManifestState = typeof artifactManifestStates[number];

export interface ProjectArtifactBundleV1 {
  version: 1;
  files: ProjectFile[];
  packageJson: ProjectSnapshotPackageJson;
}

export interface ArtifactLimits {
  maxBundleBytes: number;
  maxCompressedBytes: number;
  maxFiles: number;
}

export interface ArtifactIntegrity {
  format: 'open-v0.bundle+json+gzip';
  formatVersion: 1;
  sha256: string;
  uncompressedBytes: number;
  compressedBytes: number;
  fileCount: number;
}

export class ArtifactError extends Error {
  constructor(
    public readonly code:
      | 'ARTIFACT_STORE_UNAVAILABLE'
      | 'ARTIFACT_WRITE_FAILED'
      | 'ARTIFACT_NOT_FOUND'
      | 'ARTIFACT_CORRUPT'
      | 'ARTIFACT_FORMAT_UNSUPPORTED'
      | 'ARTIFACT_LIMIT_EXCEEDED'
      | 'ARTIFACT_INVALID_PATH'
      | 'ARTIFACT_INVALID_BUNDLE'
      | 'ARTIFACT_IDEMPOTENCY_CONFLICT',
    message: string,
    public readonly retryable = false
  ) {
    super(message);
  }
}
```

Create `apps/server/src/artifacts/bundle.ts`. Implement:

```ts
export const encodeProjectArtifact = async (
  input: ProjectArtifactBundleV1,
  limits: ArtifactLimits
): Promise<{
  compressedBytes: Uint8Array;
  uncompressedBytes: Uint8Array;
  manifest: ArtifactIntegrity;
  sha256: string;
}>;

export const decodeProjectArtifact = async (
  compressedBytes: Uint8Array,
  integrity: ArtifactIntegrity,
  limits: ArtifactLimits
): Promise<ProjectArtifactBundleV1>;
```

Implement encoding in this order: validate version and package-map value
types; normalize each path with POSIX separators; reject absolute paths,
`.`/`..` segments, unsafe extensions, and duplicate normalized paths; sort
files by path; sort dependency/devDependency/script keys; serialize with
`JSON.stringify`; enforce file-count and uncompressed-byte limits; compute
SHA-256 over uncompressed bytes; gzip at a fixed compression level; then
enforce the compressed-byte limit.

Implement decoding in reverse trust order: validate manifest format/version
and compressed length before decompression; use `promisify(gunzip)` with
`maxOutputLength: limits.maxUncompressedBytes`; compare exact uncompressed
length and SHA-256; parse JSON; pass the value through the same independent
validator/canonicalizer; then compare file count. Map gzip, JSON, and schema
failures to the specific `ArtifactError` codes from `types.ts`.

- [ ] **Step 4: Run focused tests and type-check**

```bash
node --import tsx --test apps/server/src/artifacts/bundle.test.ts
npm run type-check --workspace @v0/server
```

Expected: all Artifact Bundle tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/artifacts/types.ts \
  apps/server/src/artifacts/bundle.ts \
  apps/server/src/artifacts/bundle.test.ts
git commit -m "feat: add canonical artifact bundles"
```

## Task 2: Add the shared-filesystem ArtifactStore

**Files:**

- Create: `apps/server/src/artifacts/ArtifactStore.ts`
- Create: `apps/server/src/artifacts/SharedFilesystemArtifactStore.ts`
- Create: `apps/server/src/artifacts/SharedFilesystemArtifactStore.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Create a contract suite that receives an ArtifactStore and fresh root. Cover:

```ts
test('shared store satisfies the ArtifactStore contract', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  const store = new SharedFilesystemArtifactStore(root);
  const key = 'v1/ab/cd/abcdef.json.gz';
  const bytes = new TextEncoder().encode('artifact');

  assert.equal(await store.exists(key), false);
  await store.put({ storageKey: key, bytes });
  assert.equal(await store.exists(key), true);
  assert.deepEqual(await store.get(key), bytes);
  await assert.rejects(
    store.put({ storageKey: key, bytes }),
    /ARTIFACT_WRITE_FAILED/
  );
  await store.delete(key);
  assert.equal(await store.exists(key), false);
});

test('shared store rejects traversal and symlink targets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  const store = new SharedFilesystemArtifactStore(root);
  await assert.rejects(
    store.get('../secret'),
    /ARTIFACT_INVALID_PATH/
  );
  await symlink(tmpdir(), path.join(root, 'linked'));
  await assert.rejects(
    store.put({
      storageKey: 'linked/value.json.gz',
      bytes: new Uint8Array([1])
    }),
    /ARTIFACT_INVALID_PATH/
  );
});
```

Also assert two concurrent puts to one key produce one ready file with exactly
one caller succeeding.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test \
  apps/server/src/artifacts/SharedFilesystemArtifactStore.test.ts
```

- [ ] **Step 3: Implement the protocol and filesystem adapter**

`ArtifactStore.ts`:

```ts
export interface ArtifactStore {
  put(input: {
    storageKey: string;
    bytes: Uint8Array;
  }): Promise<void>;
  get(storageKey: string): Promise<Uint8Array>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
}
```

`SharedFilesystemArtifactStore.ts` must:

- resolve and validate every key under an absolute root;
- allow only `v1/<2 hex>/<2 hex>/<32 hex>.json.gz`;
- create parent directories and reject symlink components using `lstat`;
- write `<final>.<random>.tmp` with `flag: 'wx'`;
- call file handle `sync()`, close, then rename;
- fail if final already exists;
- delete the temp file in `finally`;
- map `ENOENT` on get to `ARTIFACT_NOT_FOUND`;
- map transient IO codes to retryable `ARTIFACT_STORE_UNAVAILABLE`.

- [ ] **Step 4: Run contract and server tests**

```bash
node --import tsx --test \
  apps/server/src/artifacts/SharedFilesystemArtifactStore.test.ts
npm run type-check --workspace @v0/server
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/artifacts/ArtifactStore.ts \
  apps/server/src/artifacts/SharedFilesystemArtifactStore.ts \
  apps/server/src/artifacts/SharedFilesystemArtifactStore.test.ts
git commit -m "feat: add shared filesystem artifact store"
```

## Task 3: Persist Manifests and implement ArtifactService

**Files:**

- Create: `apps/server/src/models/ArtifactManifest.ts`
- Create: `apps/server/src/artifacts/config.ts`
- Create: `apps/server/src/artifacts/artifactService.ts`
- Create: `apps/server/src/artifacts/runtime.ts`
- Create: `apps/server/src/artifacts/artifactService.integration.ts`
- Modify: `apps/server/src/agent/models.test.ts`

- [ ] **Step 1: Write failing Manifest and idempotency tests**

Add model assertions for all Manifest paths and exact indexes. In the integration
test, use Testcontainers Mongo plus a temporary SharedFilesystem store:

```ts
const first = await service.writeBundle({
  workspaceId,
  projectId,
  createdByRunId: runId,
  kind: 'project_snapshot',
  idempotencyKey: `snapshot:${runId}`,
  bundle
});
const second = await service.writeBundle({
  workspaceId,
  projectId,
  createdByRunId: runId,
  kind: 'project_snapshot',
  idempotencyKey: `snapshot:${runId}`,
  bundle
});
assert.equal(first.artifactId, second.artifactId);
assert.equal(await ArtifactManifest.countDocuments(), 1);
assert.deepEqual(await service.readBundle(first.artifactId), normalizedBundle);
```

Add a second test proving the same idempotencyKey with changed content raises
`ARTIFACT_IDEMPOTENCY_CONFLICT`, and a third that mutates the Blob and observes
`ARTIFACT_CORRUPT` plus Manifest state `corrupt`.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/artifacts/artifactService.integration.ts
```

- [ ] **Step 3: Add ArtifactManifest**

Implement the schema from the design. Required indexes:

```ts
ArtifactManifestSchema.index({ artifactId: 1 }, { unique: true });
ArtifactManifestSchema.index({ idempotencyKey: 1 }, { unique: true });
ArtifactManifestSchema.index(
  { workspaceId: 1, projectId: 1, createdAt: -1 }
);
ArtifactManifestSchema.index({ state: 1, updatedAt: 1 });
ArtifactManifestSchema.index({ createdByRunId: 1, kind: 1 });
```

- [ ] **Step 4: Implement config and ArtifactService**

`config.ts` returns:

```ts
export interface ArtifactConfig {
  driver: 'shared-filesystem';
  root: string;
  limits: ArtifactLimits;
  writingTimeoutMs: number;
  orphanRetentionMs: number;
}

export const getArtifactConfig = (
  env: Record<string, string | undefined> = process.env
): ArtifactConfig => ({
  driver: 'shared-filesystem',
  root: env.ARTIFACT_STORE_ROOT || '/var/lib/open-v0/artifacts',
  limits: {
    maxBundleBytes: positive(env.ARTIFACT_MAX_BUNDLE_BYTES, 50 * 1024 * 1024),
    maxCompressedBytes: positive(
      env.ARTIFACT_MAX_COMPRESSED_BYTES,
      20 * 1024 * 1024
    ),
    maxFiles: positive(env.ARTIFACT_MAX_FILES, 5_000)
  },
  writingTimeoutMs: positive(
    env.ARTIFACT_WRITING_TIMEOUT_MS,
    5 * 60 * 1_000
  ),
  orphanRetentionMs: positive(
    env.ARTIFACT_ORPHAN_RETENTION_MS,
    24 * 60 * 60 * 1_000
  )
});
```

`ArtifactService.writeBundle()` must encode before creating the Manifest, create
or load by idempotencyKey, compare SHA-256 on reuse, write/verify the Blob, then
CAS `writing → ready`. `readBundle()` requires ready state and marks the
Manifest corrupt on integrity failures, but leaves it writing for retryable
store-unavailable errors.

`runtime.ts` exports a lazy `getArtifactService()` that reads configuration on
first use and a `resetArtifactRuntimeForTests()` hook. Do not construct it at
module import time.

- [ ] **Step 5: Run integration, unit, and type tests**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/artifacts/artifactService.integration.ts
node --import tsx --test apps/server/src/agent/models.test.ts
npm run type-check --workspace @v0/server
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/models/ArtifactManifest.ts \
  apps/server/src/artifacts/config.ts \
  apps/server/src/artifacts/artifactService.ts \
  apps/server/src/artifacts/runtime.ts \
  apps/server/src/artifacts/artifactService.integration.ts \
  apps/server/src/agent/models.test.ts
git commit -m "feat: persist verified artifact manifests"
```

## Task 4: Move Snapshot and Candidate schemas to artifact references

Tasks 4–6 are one atomic final-state cutover. Do not commit after Task 4 or
Task 5 because the deliberately incomplete runtime conversion will not yet
type-check. Commit the complete schema, persistence, and hydration cutover at
the end of Task 6. This keeps every commit buildable without introducing a
released dual-read or dual-write mode.

**Files:**

- Modify: `apps/server/src/models/ProjectSnapshot.ts`
- Modify: `apps/server/src/models/ValidationCandidate.ts`
- Create: `apps/server/src/artifacts/testing.ts`
- Modify: `apps/server/src/agent/models.test.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`
- Modify: `apps/server/src/integration/agentWorker.integration.ts`

- [ ] **Step 1: Write failing final-state schema tests**

Assert:

```ts
assert.ok(ProjectSnapshot.schema.path('workspaceId'));
assert.ok(ProjectSnapshot.schema.path('branchId'));
assert.ok(ProjectSnapshot.schema.path('artifactId'));
assert.equal(ProjectSnapshot.schema.path('files'), undefined);
assert.equal(ProjectSnapshot.schema.path('packageJson'), undefined);
assert.ok(ValidationCandidate.schema.path('workspaceId'));
assert.ok(ValidationCandidate.schema.path('branchId'));
assert.ok(ValidationCandidate.schema.path('artifactId'));
assert.equal(ValidationCandidate.schema.path('files'), undefined);
assert.equal(ValidationCandidate.schema.path('packageJson'), undefined);
```

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test apps/server/src/agent/models.test.ts
```

- [ ] **Step 3: Replace both schemas**

ProjectSnapshot must require `workspaceId`, `branchId`, and `artifactId`, retain
validation/summary, and add `{ artifactId: 1 }` index. ValidationCandidate must
require the same three fields and retain summary/expiresAt.

- [ ] **Step 4: Add test fixture helpers**

`artifacts/testing.ts` exports:

```ts
export const createArtifactBackedSnapshot = async (input: {
  workspaceId: Types.ObjectId;
  branchId: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  sourceRunId: Types.ObjectId;
  parentSnapshotId?: Types.ObjectId;
  files: ProjectFile[];
  packageJson: ProjectSnapshotPackageJson;
  validation: ValidationResult;
  summary: string;
}) => {
  const {
    files,
    packageJson,
    workspaceId,
    branchId,
    userId,
    projectId,
    sourceRunId,
    parentSnapshotId,
    validation,
    summary
  } = input;
  const artifact = await getArtifactService().writeBundle({
    workspaceId,
    projectId,
    createdByRunId: sourceRunId,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${sourceRunId.toString()}`,
    bundle: {
      version: 1,
      files,
      packageJson
    }
  });
  return ProjectSnapshot.create({
    workspaceId,
    branchId,
    userId,
    projectId,
    sourceRunId,
    parentSnapshotId,
    validation,
    summary,
    artifactId: artifact.artifactId
  });
};
```

Add the equivalent Candidate helper. Configure each integration environment
with a unique temporary Artifact root and reset Artifact runtime before tests.

- [ ] **Step 5: Mechanically convert all direct integration fixtures**

Replace every direct `ProjectSnapshot.create({...files, packageJson...})` and
`ValidationCandidate.create()` in both integration files with the helpers.
Do not leave mixed-format fixtures.

- [ ] **Step 6: Run the focused model test**

```bash
node --import tsx --test apps/server/src/agent/models.test.ts
```

Expected: schema assertions pass. Do not run a full type-check or commit the
incomplete cutover yet; proceed directly to Task 5.

- [ ] **Step 7: Continue without committing**

Keep these changes in the working tree and proceed directly to Task 5.

## Task 5: Switch Agent Worker persistence to ArtifactService

**Files:**

- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/integration/agentWorker.integration.ts`

- [ ] **Step 1: Add failing Worker Artifact assertions**

Extend Worker integration tests to assert:

```ts
const snapshot = await ProjectSnapshot.findOne({ sourceRunId: run._id });
assert.ok(snapshot?.artifactId);
assert.equal('files' in snapshot!.toObject(), false);
assert.equal('packageJson' in snapshot!.toObject(), false);
const bundle = await getArtifactService().readBundle(snapshot!.artifactId);
assert.ok(bundle.files.some(file => file.path === 'src/App.tsx'));
```

Add equivalent coverage for:

- persisting recovery;
- Branch conflict Snapshot;
- failed validation Candidate;
- validation Candidate retry.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentWorker.integration.ts
```

- [ ] **Step 3: Add focused persistence helpers in orchestrator**

Add:

```ts
const createRunSnapshot = async (
  run: InstanceType<typeof AgentRun>,
  input: {
    parentSnapshotId?: Types.ObjectId;
    files: ProjectFile[];
    packageJson: ProjectSnapshotPackageJson;
    validation: ValidationResult;
    summary: string;
  }
) => {
  const artifact = await getArtifactService().writeBundle({
    workspaceId: run.workspaceId!,
    projectId: run.projectId,
    createdByRunId: run._id,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${run._id.toString()}`,
    bundle: {
      version: 1,
      files: input.files,
      packageJson: input.packageJson
    }
  });
  return ProjectSnapshot.findOneAndUpdate(
    { sourceRunId: run._id },
    {
      $setOnInsert: {
        workspaceId: run.workspaceId,
        branchId: run.branchId,
        userId: run.userId,
        projectId: run.projectId,
        sourceRunId: run._id,
        parentSnapshotId: input.parentSnapshotId,
        artifactId: artifact.artifactId,
        validation: input.validation,
        summary: input.summary
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};
```

Add a Candidate helper using `candidate:<runId>`. Replace normal generation,
persisting recovery, failed candidate, and validation retry persistence with
these helpers. Hydrate Candidate before validation.

Use Manifest `fileCount` or loaded Bundle length for events; never read
`snapshot.files`.

- [ ] **Step 4: Map Artifact errors**

Add all Artifact error codes to `publicAgentError()`. Only
`ARTIFACT_STORE_UNAVAILABLE` and retryable `ARTIFACT_WRITE_FAILED` may set a
retryable infrastructure outcome. Integrity and path errors fail permanently.

- [ ] **Step 5: Run the focused Worker integration**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentWorker.integration.ts
```

- [ ] **Step 6: Continue without committing**

Keep these changes with Task 4 and proceed directly to Task 6.

## Task 6: Hydrate Agent context and Snapshot APIs

**Files:**

- Modify: `apps/server/src/agent/contextBuilder.ts`
- Modify: `apps/server/src/routes/project.ts`
- Modify: `apps/server/src/routes/agent.ts`
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/agent/contextBuilder.test.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`

- [ ] **Step 1: Add failing hydration tests**

Add tests proving:

- Edit context loads files through `artifactId`.
- Snapshot detail returns files/packageJson.
- Snapshot list returns `fileCount` from ArtifactManifest and performs no Blob
  read (inject a store whose `get` throws).
- Run detail returns hydrated resultSnapshot.
- Chat timeline summary does not hydrate Blob.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test apps/server/src/agent/contextBuilder.test.ts
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentRoutes.integration.ts
```

- [ ] **Step 3: Hydrate context**

After loading `baseSnapshot`, call:

```ts
const baseBundle = baseSnapshot
  ? await getArtifactService().readBundle(baseSnapshot.artifactId)
  : null;
```

Pass `baseBundle?.files` to `resolveProjectBaseFiles()` and
`baseBundle?.packageJson` to generation. Remove all remaining accesses to
`baseSnapshot.files` and `baseSnapshot.packageJson`.

- [ ] **Step 4: Hydrate API detail only**

Create a response helper:

```ts
const snapshotDetail = async (
  snapshot: InstanceType<typeof ProjectSnapshot>
) => {
  const bundle = await getArtifactService().readBundle(snapshot.artifactId);
  return {
    ...snapshot.toObject(),
    files: bundle.files,
    packageJson: bundle.packageJson
  };
};
```

Use it in Project Snapshot detail and AgentRun detail. Snapshot list joins
ArtifactManifest by artifactId and returns `fileCount` without Blob reads.
Timeline continues using summary only.

- [ ] **Step 5: Run route and context regression**

```bash
node --import tsx --test apps/server/src/agent/contextBuilder.test.ts
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentRoutes.integration.ts
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

- [ ] **Step 6: Commit the complete atomic cutover**

```bash
git add apps/server/src/models/ProjectSnapshot.ts \
  apps/server/src/models/ValidationCandidate.ts \
  apps/server/src/artifacts/testing.ts \
  apps/server/src/agent/models.test.ts \
  apps/server/src/agent/orchestrator.ts \
  apps/server/src/agent/contextBuilder.ts \
  apps/server/src/routes/project.ts \
  apps/server/src/routes/agent.ts \
  apps/server/src/routes/chat.ts \
  apps/server/src/testing/integrationEnvironment.ts \
  apps/server/src/agent/contextBuilder.test.ts \
  apps/server/src/integration/agentRoutes.integration.ts \
  apps/server/src/integration/agentWorker.integration.ts
git commit -m "feat: move snapshot content to artifact store"
```

## Task 7: Add Artifact reconciliation and operations

**Files:**

- Create: `apps/server/src/artifacts/reconciler.ts`
- Create: `apps/server/src/artifacts/reconciler.integration.ts`
- Create: `apps/server/src/reconcileArtifacts.ts`
- Modify: `apps/server/package.json`
- Modify: `README.md`

- [ ] **Step 1: Write failing reconciliation tests**

Cover four exact cases:

1. stale writing + valid final Blob → ready;
2. stale writing + missing Blob → corrupt;
3. unreferenced ready beyond retention → delete_pending then removed;
4. referenced ready Artifact → preserved.

Use injected `now`, `writingTimeoutMs`, and `orphanRetentionMs` so tests do not
sleep.

- [ ] **Step 2: Confirm RED**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/artifacts/reconciler.integration.ts
```

- [ ] **Step 3: Implement one-shot reconciler**

Export:

```ts
export const reconcileArtifacts = async (input: {
  service: ArtifactService;
  store: ArtifactStore;
  now?: Date;
  writingTimeoutMs: number;
  orphanRetentionMs: number;
}): Promise<{
  promoted: number;
  corrupted: number;
  deleted: number;
  preserved: number;
}>;
```

Implement a sequential bounded scan with explicit Mongo cursors and a batch
limit constant. For each stale `writing` manifest, call `store.stat(finalKey)`.
If the final Blob exists with the expected compressed size, read and verify it
through ArtifactService, then atomically promote `writing → ready`; otherwise
atomically mark it `corrupt`. For each `ready` manifest older than retention,
query both ProjectSnapshot and ValidationCandidate by `artifactId`; increment
`preserved` when referenced. For an unreferenced manifest, atomically transition
`ready → delete_pending`, delete the Blob, then delete the Manifest. If either
delete fails, leave `delete_pending` for the next one-shot run. Count only
successful terminal transitions.

- [ ] **Step 4: Add CLI and documentation**

Add:

```json
"reconcile:artifacts": "tsx src/reconcileArtifacts.ts",
"start:reconcile:artifacts": "node dist/reconcileArtifacts.js"
```

Document the shared mount, required environment, startup permission check, and
recommended external schedule. Explicitly state that this command is not a
legacy data migration.

- [ ] **Step 5: Run reconciliation and build tests**

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/artifacts/reconciler.integration.ts
npm run build --workspace @v0/server
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/artifacts/reconciler.ts \
  apps/server/src/artifacts/reconciler.integration.ts \
  apps/server/src/reconcileArtifacts.ts \
  apps/server/package.json README.md
git commit -m "feat: reconcile shared artifacts"
```

## Task 8: Full Artifact phase verification

**Files:**

- Modify only files already listed when verification exposes a defect.

- [ ] **Step 1: Verify no MongoDB source fields remain**

```bash
rg -n "snapshot\\.files|snapshot\\.packageJson|candidate\\.files|candidate\\.packageJson" \
  apps/server/src
```

Expected: no runtime persistence reads; only hydrated Bundle variables and
explicit negative schema tests.

- [ ] **Step 2: Run formatting checks**

```bash
git diff --check
```

- [ ] **Step 3: Run all Server unit tests**

```bash
npm test --workspace @v0/server
```

- [ ] **Step 4: Run all Server integration tests**

Ensure `ARTIFACT_STORE_ROOT` is isolated per integration environment:

```bash
npm run test:integration --workspace @v0/server
node --import tsx --test --test-concurrency=1 \
  apps/server/src/artifacts/*.integration.ts
```

- [ ] **Step 5: Run Web regression**

```bash
npm test --workspace @v0/web
```

- [ ] **Step 6: Run production builds**

```bash
npm run build --workspace @v0/server
npm run build --workspace @v0/web
```

- [ ] **Step 7: Inspect scope and preservation**

```bash
git status --short
git diff --stat HEAD~5..HEAD
```

Expected: only Artifact phase files are committed. Preserve the pre-existing
root `package.json` and `tests/repository/` changes.

## Final acceptance checklist

- [ ] ProjectSnapshot and ValidationCandidate schemas contain artifactId but no files/packageJson.
- [ ] SharedFilesystemArtifactStore passes traversal, symlink, overwrite and concurrency contract tests.
- [ ] Canonical Bundle encoding is stable and bounded.
- [ ] Every Artifact read verifies ready state, size, format and SHA-256.
- [ ] AgentRun retry reuses one Artifact through idempotencyKey.
- [ ] Normal, recovery, Candidate retry and Branch conflict flows preserve readable Artifacts.
- [ ] Snapshot list does not read Blob content.
- [ ] Snapshot and Run detail responses remain frontend-compatible.
- [ ] Artifact errors are stable and do not expose paths or source.
- [ ] One-shot Reconciler handles writing, corrupt and delete_pending states.
- [ ] Server unit/integration tests, Web tests and both production builds pass.
