import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import mongoose, { Types } from 'mongoose';
import {
  GenericContainer,
  type StartedTestContainer
} from 'testcontainers';
import { ArtifactManifest } from '../models/ArtifactManifest';
import { ValidationCandidate } from '../models/ValidationCandidate';
import { SandboxLease } from '../models/SandboxLease';
import type { ArtifactStore } from './ArtifactStore';
import { ArtifactService } from './artifactService';
import { reconcileArtifacts } from './reconciler';
import { SharedFilesystemArtifactStore } from './SharedFilesystemArtifactStore';
import { ArtifactError, type ProjectArtifactBundleV1 } from './types';

let mongo: StartedTestContainer | undefined;
let root: string;

const now = new Date('2026-07-26T08:00:00.000Z');
const writingTimeoutMs = 5 * 60_000;
const orphanRetentionMs = 24 * 60 * 60_000;
const old = new Date(now.getTime() - orphanRetentionMs - 1);
const stale = new Date(now.getTime() - writingTimeoutMs);
const limits = {
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxCompressedBytes: 20 * 1024 * 1024,
  maxFiles: 5_000
};
const bundle: ProjectArtifactBundleV1 = {
  version: 1,
  files: [{
    path: 'src/index.ts',
    content: 'export const answer = 42;',
    language: 'ts'
  }],
  packageJson: {
    dependencies: {},
    devDependencies: {},
    scripts: { build: 'tsc' }
  }
};

const serviceFor = (store: ArtifactStore) =>
  new ArtifactService(store, {
    driver: 'shared-filesystem',
    root,
    limits,
    writingTimeoutMs,
    orphanRetentionMs
  });

const seedArtifact = async (
  store: ArtifactStore,
  state: 'writing' | 'ready' | 'delete_pending',
  updatedAt: Date
) => {
  const ids = {
    workspaceId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    createdByRunId: new Types.ObjectId()
  };
  const written = await serviceFor(store).writeBundle({
    ...ids,
    kind: 'validation_candidate',
    idempotencyKey: `candidate:${new Types.ObjectId()}`,
    bundle
  });
  await ArtifactManifest.updateOne(
    { artifactId: written.artifactId },
    { $set: { state, updatedAt } },
    { timestamps: false }
  );
  return ArtifactManifest.findOne({ artifactId: written.artifactId }).orFail();
};

const reconcile = (store: ArtifactStore) =>
  reconcileArtifacts({
    service: serviceFor(store),
    store,
    now,
    writingTimeoutMs,
    orphanRetentionMs
  });

before(async () => {
  try {
    mongo = await new GenericContainer('mongo:7')
      .withExposedPorts(27017)
      .start();
    const uri =
      `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/artifact_reconciler`;
    await mongoose.connect(uri);
    await Promise.all([
      ArtifactManifest.syncIndexes(),
      ValidationCandidate.syncIndexes(),
      SandboxLease.syncIndexes()
    ]);
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    await mongo?.stop().catch(() => undefined);
    throw error;
  }
});

beforeEach(async () => {
  await Promise.all([
    ArtifactManifest.deleteMany({}),
    ValidationCandidate.deleteMany({}),
    SandboxLease.deleteMany({})
  ]);
  if (root) await rm(root, { recursive: true, force: true });
  root = await mkdtemp(path.join(tmpdir(), 'artifact-reconciler-'));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  await mongoose.disconnect();
  await mongo?.stop();
});

test('promotes a stale writing manifest only after full integrity verification', async () => {
  const store = new SharedFilesystemArtifactStore(root);
  const manifest = await seedArtifact(store, 'writing', stale);

  assert.deepEqual(await reconcile(store), {
    promoted: 1,
    corrupted: 0,
    deleted: 0,
    preserved: 0
  });
  assert.equal(
    (await ArtifactManifest.findOne({ artifactId: manifest.artifactId }).orFail())
      .state,
    'ready'
  );
});

test('marks stale writing manifests corrupt for missing and damaged blobs', async () => {
  const store = new SharedFilesystemArtifactStore(root);
  const missing = await seedArtifact(store, 'writing', stale);
  await store.delete(missing.storageKey);
  const damaged = await seedArtifact(store, 'writing', stale);
  const damagedPath = path.join(root, damaged.storageKey);
  const bytes = await readFile(damagedPath);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  await writeFile(damagedPath, bytes);

  const result = await reconcile(store);

  assert.deepEqual(result, {
    promoted: 0,
    corrupted: 2,
    deleted: 0,
    preserved: 0
  });
  const manifests = await ArtifactManifest.find({
    artifactId: { $in: [missing.artifactId, damaged.artifactId] }
  }).lean();
  assert.ok(manifests.every(manifest => manifest.state === 'corrupt'));
  assert.ok(manifests.every(manifest => manifest.errorCode));
});

test('store unavailability preserves stale writing without corrupt count', async () => {
  const realStore = new SharedFilesystemArtifactStore(root);
  const manifest = await seedArtifact(realStore, 'writing', stale);
  const unavailable = new ArtifactError(
    'ARTIFACT_STORE_UNAVAILABLE',
    'offline',
    false
  );
  const store: ArtifactStore = {
    put: input => realStore.put(input),
    get: async () => { throw unavailable; },
    stat: async () => { throw unavailable; },
    exists: async () => { throw unavailable; },
    delete: async () => { throw unavailable; }
  };

  assert.deepEqual(await reconcile(store), {
    promoted: 0,
    corrupted: 0,
    deleted: 0,
    preserved: 0
  });
  assert.equal(
    (await ArtifactManifest.findOne({ artifactId: manifest.artifactId }).orFail())
      .state,
    'writing'
  );
});

test('preserves referenced ready artifacts and deletes old unreferenced artifacts', async () => {
  const store = new SharedFilesystemArtifactStore(root);
  const referenced = await seedArtifact(store, 'ready', old);
  const orphan = await seedArtifact(store, 'ready', old);
  await ValidationCandidate.create({
    workspaceId: referenced.workspaceId,
    branchId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    projectId: referenced.projectId,
    sourceRunId: new Types.ObjectId(),
    artifactId: referenced.artifactId,
    summary: 'reference',
    expiresAt: new Date(now.getTime() + 60_000)
  });

  assert.deepEqual(await reconcile(store), {
    promoted: 0,
    corrupted: 0,
    deleted: 1,
    preserved: 1
  });
  assert.ok(await ArtifactManifest.exists({ artifactId: referenced.artifactId }));
  assert.equal(await ArtifactManifest.exists({ artifactId: orphan.artifactId }), null);
  assert.equal(await store.exists(orphan.storageKey), false);
});

test('preserves artifacts referenced by non-terminated Sandbox leases', async () => {
  const store = new SharedFilesystemArtifactStore(root);
  const manifest = await seedArtifact(store, 'ready', old);
  const reservedAt = new Date(now.getTime() - 60_000);
  const lease = await SandboxLease.create({
    workspaceId: manifest.workspaceId,
    projectId: manifest.projectId,
    branchId: new Types.ObjectId(),
    requestedByUserId: new Types.ObjectId(),
    runId: new Types.ObjectId(),
    sourceArtifact: {
      artifactId: manifest.artifactId,
      kind: 'validation_candidate'
    },
    purpose: 'build',
    provider: 'fake',
    provisioningKey: `lease:${crypto.randomUUID()}`,
    state: 'provisioning',
    spec: {
      image: 'node:22',
      workingDirectory: '/workspace',
      networkPolicy: {
        defaultAction: 'allow',
        allowedDomains: [],
        allowedCidrs: []
      },
      leaseSeconds: 900,
      autoDeleteSeconds: 1_800
    },
    resourceProfile: { cpu: 1, memoryMiB: 1_024, diskMiB: 2_048 },
    reservedAt,
    expiresAt: new Date(now.getTime() + 900_000)
  });

  assert.equal((await reconcile(store)).preserved, 1);
  assert.ok(await ArtifactManifest.exists({ artifactId: manifest.artifactId }));

  await SandboxLease.updateOne(
    { _id: lease._id },
    { $set: { state: 'terminated', terminatedAt: now } }
  );
  assert.equal((await reconcile(store)).deleted, 1);
  assert.equal(
    await ArtifactManifest.exists({ artifactId: manifest.artifactId }),
    null
  );
});

test('resumes delete_pending and retains it when store deletion is unavailable', async () => {
  const realStore = new SharedFilesystemArtifactStore(root);
  const manifest = await seedArtifact(realStore, 'delete_pending', old);
  let unavailable = true;
  const store: ArtifactStore = {
    put: input => realStore.put(input),
    get: key => realStore.get(key),
    stat: key => realStore.stat(key),
    exists: key => realStore.exists(key),
    delete: async key => {
      if (unavailable) {
        throw new ArtifactError('ARTIFACT_STORE_UNAVAILABLE', 'offline', true);
      }
      await realStore.delete(key);
    }
  };

  assert.equal((await reconcile(store)).deleted, 0);
  assert.equal(
    (await ArtifactManifest.findOne({ artifactId: manifest.artifactId }).orFail())
      .state,
    'delete_pending'
  );
  unavailable = false;
  assert.equal((await reconcile(store)).deleted, 1);
  assert.equal(await ArtifactManifest.exists({ artifactId: manifest.artifactId }), null);
});

test('restores a delete_pending manifest when a domain reference appears', async () => {
  const store = new SharedFilesystemArtifactStore(root);
  const manifest = await seedArtifact(store, 'delete_pending', old);
  await ValidationCandidate.create({
    workspaceId: manifest.workspaceId,
    branchId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    projectId: manifest.projectId,
    sourceRunId: new Types.ObjectId(),
    artifactId: manifest.artifactId,
    summary: 'late reference',
    expiresAt: new Date(now.getTime() + 60_000)
  });

  assert.deepEqual(await reconcile(store), {
    promoted: 0,
    corrupted: 0,
    deleted: 0,
    preserved: 1
  });
  assert.equal(
    (await ArtifactManifest.findOne({ artifactId: manifest.artifactId }).orFail())
      .state,
    'ready'
  );
  assert.equal(await store.exists(manifest.storageKey), true);
});

test('bounds each manifest-state scan to one batch', async () => {
  const manifests = Array.from({ length: 101 }, (_, index) => {
    const artifactId = index.toString(16).padStart(32, '0');
    return {
      artifactId,
      workspaceId: new Types.ObjectId(),
      projectId: new Types.ObjectId(),
      createdByRunId: new Types.ObjectId(),
      kind: 'validation_candidate',
      idempotencyKey: `bounded:${index}`,
      format: 'open-v0.bundle+json+gzip',
      formatVersion: 1,
      storageKey: `v1/${artifactId.slice(0, 2)}/${artifactId.slice(2, 4)}/${artifactId}.json.gz`,
      sha256: '0'.repeat(64),
      uncompressedBytes: 1,
      compressedBytes: 1,
      fileCount: 1,
      state: 'writing',
      createdAt: stale,
      updatedAt: stale
    };
  });
  await ArtifactManifest.insertMany(manifests);
  const store = new SharedFilesystemArtifactStore(root);

  const result = await reconcile(store);

  assert.equal(result.corrupted, 100);
  assert.equal(
    await ArtifactManifest.countDocuments({ state: 'writing' }),
    1
  );
});

test('concurrent reconcilers count each terminal transition once', async () => {
  const store = new SharedFilesystemArtifactStore(root);
  const writing = await seedArtifact(store, 'writing', stale);
  const orphan = await seedArtifact(store, 'ready', old);

  const [first, second] = await Promise.all([reconcile(store), reconcile(store)]);

  assert.equal(first.promoted + second.promoted, 1);
  assert.equal(first.deleted + second.deleted, 1);
  assert.equal(
    (await ArtifactManifest.findOne({ artifactId: writing.artifactId }).orFail())
      .state,
    'ready'
  );
  assert.equal(await ArtifactManifest.exists({ artifactId: orphan.artifactId }), null);
});
