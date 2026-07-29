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
import type { ArtifactStore } from './ArtifactStore';
import { ArtifactService } from './artifactService';
import { getArtifactConfig } from './config';
import { createPreviewArtifactBundle } from './previewBundle';
import {
  getArtifactService,
  resetArtifactRuntimeForTests
} from './runtime';
import { SharedFilesystemArtifactStore } from './SharedFilesystemArtifactStore';
import { ArtifactError, type ProjectArtifactBundleV1 } from './types';

let mongo: StartedTestContainer | undefined;
let root: string;

const limits = {
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxCompressedBytes: 20 * 1024 * 1024,
  maxFiles: 5_000
};

const bundle: ProjectArtifactBundleV1 = {
  version: 1,
  files: [
    { path: 'src/z.ts', content: 'export const z = 1;', language: 'ts' },
    { path: 'src/a.ts', content: 'export const a = 1;', language: 'ts' }
  ],
  packageJson: {
    dependencies: { zod: '^3.22.4', express: '^4.18.3' },
    devDependencies: {},
    scripts: { build: 'tsc', test: 'node --test' }
  }
};

const normalizedBundle: ProjectArtifactBundleV1 = {
  ...bundle,
  files: [bundle.files[1], bundle.files[0]],
  packageJson: {
    dependencies: { express: '^4.18.3', zod: '^3.22.4' },
    devDependencies: {},
    scripts: { build: 'tsc', test: 'node --test' }
  }
};

const ids = () => ({
  workspaceId: new Types.ObjectId(),
  projectId: new Types.ObjectId(),
  createdByRunId: new Types.ObjectId()
});

const serviceFor = (
  store: ArtifactStore = new SharedFilesystemArtifactStore(root)
) =>
  new ArtifactService(store, {
    driver: 'shared-filesystem',
    root,
    limits,
    writingTimeoutMs: 300_000,
    orphanRetentionMs: 86_400_000
  });

const expectCode = async (code: string, callback: () => Promise<unknown>) => {
  await assert.rejects(callback, error =>
    error instanceof ArtifactError && error.code === code
  );
};

before(async () => {
  try {
    mongo = await new GenericContainer('mongo:7').withExposedPorts(27017).start();
    const uri = `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/artifact_service`;
    await mongoose.connect(uri);
    await ArtifactManifest.syncIndexes();
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    await mongo?.stop().catch(() => undefined);
    throw error;
  }
});

beforeEach(async () => {
  await ArtifactManifest.deleteMany({});
  if (root) await rm(root, { recursive: true, force: true });
  root = await mkdtemp(path.join(tmpdir(), 'artifact-service-'));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  await mongoose.disconnect();
  await mongo?.stop();
});

test('same idempotency key and bundle returns one verified artifact', async () => {
  const service = serviceFor();
  const references = ids();
  const input = {
    ...references,
    kind: 'project_snapshot' as const,
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  };

  const first = await service.writeBundle(input);
  const second = await service.writeBundle(input);

  assert.match(first.artifactId, /^[a-f0-9]{32}$/);
  assert.equal(second.artifactId, first.artifactId);
  assert.equal(await ArtifactManifest.countDocuments(), 1);
  assert.deepEqual(await service.readBundle(first.artifactId), normalizedBundle);
});

test('owned reads require the complete Workspace Project and kind scope', async () => {
  const service = serviceFor();
  const references = ids();
  const result = await service.writeBundle({
    ...references,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  });

  assert.deepEqual(
    await service.readOwnedBundle({
      artifactId: result.artifactId,
      workspaceId: references.workspaceId,
      projectId: references.projectId,
      kind: 'project_snapshot'
    }),
    normalizedBundle
  );
  for (const ownership of [
    { workspaceId: new Types.ObjectId(), projectId: references.projectId, kind: 'project_snapshot' as const },
    { workspaceId: references.workspaceId, projectId: new Types.ObjectId(), kind: 'project_snapshot' as const },
    { workspaceId: references.workspaceId, projectId: references.projectId, kind: 'validation_candidate' as const }
  ]) {
    await expectCode('ARTIFACT_NOT_FOUND', () =>
      service.readOwnedBundle({
        artifactId: result.artifactId,
        ...ownership
      })
    );
  }
});

test('source bundle reads never decode or corrupt preview build artifacts', async () => {
  const service = serviceFor();
  const references = ids();
  const result = await service.writePreviewBundle({
    ...references,
    kind: 'preview_build',
    idempotencyKey: `preview:${references.createdByRunId}`,
    bundle: createPreviewArtifactBundle([
      {
        path: 'index.html',
        content: new TextEncoder().encode('<main>verified</main>')
      }
    ])
  });

  await expectCode('ARTIFACT_NOT_FOUND', () =>
    service.readBundle(result.artifactId)
  );
  assert.equal(
    (await ArtifactManifest.findOne({
      artifactId: result.artifactId
    }).orFail()).state,
    'ready'
  );
});

test('concurrent writers with the same key converge on one artifact', async () => {
  const references = ids();
  const input = {
    ...references,
    kind: 'validation_candidate' as const,
    idempotencyKey: `candidate:${references.createdByRunId}`,
    bundle
  };
  const results = await Promise.all([
    serviceFor().writeBundle(input),
    serviceFor().writeBundle(input)
  ]);

  assert.equal(results[0].artifactId, results[1].artifactId);
  assert.equal(await ArtifactManifest.countDocuments(), 1);
});

test('same idempotency key rejects changed content', async () => {
  const service = serviceFor();
  const references = ids();
  const input = {
    ...references,
    kind: 'project_snapshot' as const,
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  };
  await service.writeBundle(input);

  await expectCode('ARTIFACT_IDEMPOTENCY_CONFLICT', () =>
    service.writeBundle({
      ...input,
      bundle: {
        ...bundle,
        files: [{ ...bundle.files[0], content: 'changed' }]
      }
    })
  );
});

test('tampered blob marks a ready manifest corrupt', async () => {
  const service = serviceFor();
  const references = ids();
  const result = await service.writeBundle({
    ...references,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  });
  const manifest = await ArtifactManifest.findOne({ artifactId: result.artifactId }).orFail();
  const blobPath = path.join(root, manifest.storageKey);
  const bytes = await readFile(blobPath);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  await writeFile(blobPath, bytes);

  await expectCode('ARTIFACT_CORRUPT', () => service.readBundle(result.artifactId));
  assert.equal(
    (await ArtifactManifest.findOne({ artifactId: result.artifactId }).orFail()).state,
    'corrupt'
  );
});

test('missing blob returns not found without corrupting a ready manifest', async () => {
  const service = serviceFor();
  const references = ids();
  const result = await service.writeBundle({
    ...references,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  });
  const manifest = await ArtifactManifest.findOne({
    artifactId: result.artifactId
  }).orFail();
  await rm(path.join(root, manifest.storageKey));

  await expectCode('ARTIFACT_NOT_FOUND', () =>
    service.readBundle(result.artifactId)
  );
  assert.equal(
    (await ArtifactManifest.findOne({
      artifactId: result.artifactId
    }).orFail()).state,
    'ready'
  );
});

test('writing manifest recovers when final blob already exists', async () => {
  const service = serviceFor();
  const references = ids();
  const input = {
    ...references,
    kind: 'project_snapshot' as const,
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  };
  const first = await service.writeBundle(input);
  await ArtifactManifest.updateOne(
    { artifactId: first.artifactId },
    { $set: { state: 'writing' } }
  );

  const recovered = await service.writeBundle(input);
  assert.equal(recovered.artifactId, first.artifactId);
  assert.equal(
    (await ArtifactManifest.findOne({ artifactId: first.artifactId }).orFail()).state,
    'ready'
  );
});

test('retryable store unavailability leaves manifest writing', async () => {
  const unavailableStore = {
    put: async () => {
      throw new ArtifactError('ARTIFACT_STORE_UNAVAILABLE', 'offline', true);
    },
    get: async () => {
      throw new ArtifactError('ARTIFACT_STORE_UNAVAILABLE', 'offline', true);
    },
    stat: async () => {
      throw new ArtifactError('ARTIFACT_STORE_UNAVAILABLE', 'offline', true);
    },
    exists: async () => {
      throw new ArtifactError('ARTIFACT_STORE_UNAVAILABLE', 'offline', true);
    },
    delete: async () => undefined
  };
  const service = serviceFor(unavailableStore);
  const references = ids();

  await expectCode('ARTIFACT_STORE_UNAVAILABLE', () =>
    service.writeBundle({
      ...references,
      kind: 'project_snapshot',
      idempotencyKey: `snapshot:${references.createdByRunId}`,
      bundle
    })
  );
  assert.equal((await ArtifactManifest.findOne().orFail()).state, 'writing');
});

test('published bytes do not recover an unrelated nonretryable put failure', async () => {
  let published: Uint8Array | undefined;
  const ioCause = Object.assign(new Error('directory sync failed'), {
    code: 'EIO'
  });
  const store: ArtifactStore = {
    put: async ({ bytes }) => {
      published = bytes;
      throw new ArtifactError(
        'ARTIFACT_WRITE_FAILED',
        'publication durability is unknown',
        false,
        ioCause
      );
    },
    get: async () => published!,
    stat: async () => ({ size: published?.byteLength ?? 0 }),
    exists: async () => published !== undefined,
    delete: async () => undefined
  };
  const service = serviceFor(store);
  const references = ids();

  await assert.rejects(
    service.writeBundle({
      ...references,
      kind: 'project_snapshot',
      idempotencyKey: `snapshot:${references.createdByRunId}`,
      bundle
    }),
    error =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_WRITE_FAILED' &&
      error.cause === ioCause
  );
  assert.equal((await ArtifactManifest.findOne().orFail()).state, 'writing');
});

test('an explicit EEXIST put result verifies and recovers published bytes', async () => {
  let published: Uint8Array | undefined;
  const existsCause = Object.assign(new Error('already exists'), {
    code: 'EEXIST'
  });
  const store: ArtifactStore = {
    put: async ({ bytes }) => {
      published = bytes;
      throw new ArtifactError(
        'ARTIFACT_WRITE_FAILED',
        'artifact already exists',
        false,
        existsCause
      );
    },
    get: async () => published!,
    stat: async () => ({ size: published?.byteLength ?? 0 }),
    exists: async () => published !== undefined,
    delete: async () => undefined
  };
  const references = ids();
  const result = await serviceFor(store).writeBundle({
    ...references,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  });

  assert.match(result.artifactId, /^[a-f0-9]{32}$/);
  assert.equal((await ArtifactManifest.findOne().orFail()).state, 'ready');
});

test('nonretryable store unavailability leaves a writing manifest unchanged', async () => {
  const unavailable = new ArtifactError(
    'ARTIFACT_STORE_UNAVAILABLE',
    'mount unavailable',
    false
  );
  const store: ArtifactStore = {
    put: async () => { throw unavailable; },
    get: async () => { throw unavailable; },
    stat: async () => { throw unavailable; },
    exists: async () => { throw unavailable; },
    delete: async () => undefined
  };
  const references = ids();

  await assert.rejects(
    serviceFor(store).writeBundle({
      ...references,
      kind: 'project_snapshot',
      idempotencyKey: `snapshot:${references.createdByRunId}`,
      bundle
    }),
    error => error === unavailable
  );
  assert.equal((await ArtifactManifest.findOne().orFail()).state, 'writing');
});

test('nonretryable store unavailability leaves a ready manifest unchanged', async () => {
  const references = ids();
  const written = await serviceFor().writeBundle({
    ...references,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${references.createdByRunId}`,
    bundle
  });
  const unavailable = new ArtifactError(
    'ARTIFACT_STORE_UNAVAILABLE',
    'mount unavailable',
    false
  );
  const store: ArtifactStore = {
    put: async () => { throw unavailable; },
    get: async () => { throw unavailable; },
    stat: async () => { throw unavailable; },
    exists: async () => { throw unavailable; },
    delete: async () => undefined
  };

  await assert.rejects(
    serviceFor(store).readBundle(written.artifactId),
    error => error === unavailable
  );
  assert.equal((await ArtifactManifest.findOne().orFail()).state, 'ready');
});

test('artifact config validates every explicit setting', () => {
  assert.deepEqual(getArtifactConfig({}), {
    driver: 'shared-filesystem',
    root: '/var/lib/open-v0/artifacts',
    limits,
    writingTimeoutMs: 300_000,
    orphanRetentionMs: 86_400_000
  });
  for (const [name, value] of [
    ['ARTIFACT_MAX_BUNDLE_BYTES', '0'],
    ['ARTIFACT_MAX_COMPRESSED_BYTES', '1.5'],
    ['ARTIFACT_MAX_FILES', '-1'],
    ['ARTIFACT_WRITING_TIMEOUT_MS', '9007199254740992'],
    ['ARTIFACT_ORPHAN_RETENTION_MS', 'nope']
  ]) {
    assert.throws(() => getArtifactConfig({ [name]: value }), name);
  }
  assert.throws(
    () => getArtifactConfig({ ARTIFACT_STORE_DRIVER: 's3' }),
    /ARTIFACT_STORE_DRIVER/
  );
  assert.throws(
    () => getArtifactConfig({ ARTIFACT_STORE_ROOT: '   ' }),
    /ARTIFACT_STORE_ROOT/
  );
});

test('artifact runtime reset rereads environment lazily', () => {
  const previousDriver = process.env.ARTIFACT_STORE_DRIVER;
  try {
    delete process.env.ARTIFACT_STORE_DRIVER;
    resetArtifactRuntimeForTests();
    assert.equal(getArtifactService(), getArtifactService());

    process.env.ARTIFACT_STORE_DRIVER = 'unsupported';
    resetArtifactRuntimeForTests();
    assert.throws(() => getArtifactService(), /ARTIFACT_STORE_DRIVER/);
  } finally {
    if (previousDriver === undefined) {
      delete process.env.ARTIFACT_STORE_DRIVER;
    } else {
      process.env.ARTIFACT_STORE_DRIVER = previousDriver;
    }
    resetArtifactRuntimeForTests();
  }
});
