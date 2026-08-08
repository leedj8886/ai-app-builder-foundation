import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { Types } from 'mongoose';
import {
  decodeProjectArtifact,
  encodeProjectArtifact
} from './bundle';
import {
  ArtifactError,
  ArtifactIntegrity,
  ArtifactLimits,
  ProjectArtifactBundleV1,
  ProjectArtifactBundleV2,
  projectArtifactProfileRef
} from './types';

const limits: ArtifactLimits = {
  maxCompressedBytes: 64 * 1024,
  maxUncompressedBytes: 128 * 1024,
  maxFiles: 20
};

const bundle = (): ProjectArtifactBundleV1 => ({
  version: 1,
  files: [
    { path: 'src/z.ts', content: 'export const z = 1;\n', language: 'ts' },
    { path: 'src/a.ts', content: 'export const a = 1;\n', language: 'ts' }
  ],
  packageJson: {
    dependencies: { zod: '^3.0.0', axios: '^1.0.0' },
    devDependencies: { typescript: '^5.0.0', tsx: '^4.0.0' },
    scripts: { test: 'node --test', build: 'tsc' }
  }
});

const bundleV2 = (): ProjectArtifactBundleV2 => ({
  ...bundle(),
  version: 2,
  profile: { id: 'static-react', version: 1 }
});

const expectCode = async (
  code: string,
  callback: () => unknown | Promise<unknown>
): Promise<void> => {
  await assert.rejects(Promise.resolve().then(callback), error =>
    error instanceof ArtifactError && error.code === code
  );
};

test('ArtifactError exposes the exact prefixed codes and caller-controlled retryability', () => {
  const codes = [
    'ARTIFACT_STORE_UNAVAILABLE',
    'ARTIFACT_WRITE_FAILED',
    'ARTIFACT_NOT_FOUND',
    'ARTIFACT_CORRUPT',
    'ARTIFACT_FORMAT_UNSUPPORTED',
    'ARTIFACT_LIMIT_EXCEEDED',
    'ARTIFACT_INVALID_PATH',
    'ARTIFACT_INVALID_BUNDLE',
    'ARTIFACT_IDEMPOTENCY_CONFLICT'
  ] as const;

  for (const code of codes) {
    assert.equal(new ArtifactError(code, 'test').code, code);
  }
  assert.equal(new ArtifactError('ARTIFACT_WRITE_FAILED', 'test').retryable, false);
  assert.equal(new ArtifactError('ARTIFACT_WRITE_FAILED', 'test', true).retryable, true);
  assert.equal(new ArtifactError('ARTIFACT_STORE_UNAVAILABLE', 'test', false).retryable, false);
});

test('encoding is asynchronous and canonical across input order', async () => {
  const pendingFirst = encodeProjectArtifact(bundle(), limits);
  assert.ok(pendingFirst instanceof Promise);
  const first = await pendingFirst;
  const reordered = bundle();
  reordered.files.reverse();
  reordered.packageJson.dependencies = { axios: '^1.0.0', zod: '^3.0.0' };
  reordered.packageJson.devDependencies = { tsx: '^4.0.0', typescript: '^5.0.0' };
  reordered.packageJson.scripts = { build: 'tsc', test: 'node --test' };
  const second = await encodeProjectArtifact(reordered, limits);

  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.compressedBytes, second.compressedBytes);
  assert.deepEqual(first.manifest, second.manifest);
});

test('Bundle V2 round-trips its canonical Profile reference', async () => {
  const encoded = await encodeProjectArtifact(bundleV2(), limits);
  const decoded = await decodeProjectArtifact(
    encoded.compressedBytes,
    encoded.manifest,
    limits
  );

  assert.deepEqual(decoded, {
    ...bundleV2(),
    files: [...bundleV2().files].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
    packageJson: {
      dependencies: { axios: '^1.0.0', zod: '^3.0.0' },
      devDependencies: { tsx: '^4.0.0', typescript: '^5.0.0' },
      scripts: { build: 'tsc', test: 'node --test' }
    }
  });
  assert.deepEqual(projectArtifactProfileRef(decoded), {
    id: 'static-react',
    version: 1
  });
  assert.deepEqual(projectArtifactProfileRef(bundle()), {
    id: 'static-react',
    version: 1
  });
});

test('Bundle V2 rejects malformed Profile references', async () => {
  await expectCode('ARTIFACT_INVALID_BUNDLE', () =>
    encodeProjectArtifact({
      ...bundleV2(),
      profile: { id: 'static-react/v1', version: 1 }
    }, limits)
  );
  await expectCode('ARTIFACT_INVALID_BUNDLE', () =>
    encodeProjectArtifact({
      ...bundleV2(),
      profile: { id: 'static-react', version: 0 }
    }, limits)
  );
});

test('decoding roundtrips from Uint8Array to the canonical bundle', async () => {
  const encoded = await encodeProjectArtifact(bundle(), limits);
  assert.ok(encoded.compressedBytes instanceof Uint8Array);
  assert.ok(encoded.uncompressedBytes instanceof Uint8Array);
  const pendingDecoded = decodeProjectArtifact(
    new Uint8Array(encoded.compressedBytes),
    encoded.manifest,
    limits
  );
  assert.ok(pendingDecoded instanceof Promise);
  const decoded = await pendingDecoded;

  assert.deepEqual(decoded.files.map(file => file.path), ['src/a.ts', 'src/z.ts']);
  assert.deepEqual(Object.keys(decoded.packageJson.dependencies), ['axios', 'zod']);
  assert.equal(decoded.version, 1);
});

test('accepts JavaScript project configuration files', async () => {
  const value = bundle();
  value.files.push(
    {
      path: 'tailwind.config.js',
      content: 'export default {};\n',
      language: 'js'
    },
    {
      path: 'postcss.config.cjs',
      content: 'module.exports = {};\n',
      language: 'js'
    }
  );

  const encoded = await encodeProjectArtifact(value, limits);
  const decoded = await decodeProjectArtifact(
    encoded.compressedBytes,
    encoded.manifest,
    limits
  );
  assert.deepEqual(
    decoded.files.map(file => file.path),
    [
      'postcss.config.cjs',
      'src/a.ts',
      'src/z.ts',
      'tailwind.config.js'
    ]
  );
});

test('accepts Profile-owned Prisma schema and SQL migration files', async () => {
  const input = bundle();
  input.files = [
    {
      path: 'prisma/schema.prisma',
      content: 'model Todo { id Int @id }',
      language: 'prisma'
    },
    {
      path: 'prisma/migrations/20260808_init/migration.sql',
      content: 'CREATE TABLE "Todo" (id integer PRIMARY KEY);',
      language: 'sql'
    }
  ];

  const encoded = await encodeProjectArtifact(input, limits);
  const decoded = await decodeProjectArtifact(
    encoded.compressedBytes,
    encoded.manifest,
    limits
  );
  assert.deepEqual(decoded.files.map(file => file.language), ['sql', 'prisma']);
});

test('rejects unsafe paths, unsupported extensions, and duplicate normalized paths', async () => {
  for (const path of [
    '../secret.ts',
    '/absolute.ts',
    'C:\\absolute.ts',
    'src\\..\\secret.ts',
    'src/./file.ts',
    'src/\0file.ts',
    'src/file.exe'
  ]) {
    const invalid = bundle();
    invalid.files[0].path = path;
    await expectCode('ARTIFACT_INVALID_PATH', () => encodeProjectArtifact(invalid, limits));
  }

  const duplicate = bundle();
  duplicate.files = [
    { path: 'src\\a.ts', content: 'one', language: 'ts' },
    { path: 'src/a.ts', content: 'two', language: 'ts' }
  ];
  await expectCode('ARTIFACT_INVALID_PATH', () => encodeProjectArtifact(duplicate, limits));
});

test('canonicalizes generatedByRunId to a deterministic string', async () => {
  const runId = new Types.ObjectId('66a3f4402f24b17418d55abc');
  const withObjectId = bundle();
  withObjectId.files[0] = {
    ...withObjectId.files[0],
    generatedByRunId: runId
  } as unknown as typeof withObjectId.files[number];
  const withString = bundle();
  withString.files[0] = {
    ...withString.files[0],
    generatedByRunId: runId.toHexString()
  } as typeof withString.files[number];

  const encodedObjectId = await encodeProjectArtifact(withObjectId, limits);
  const encodedString = await encodeProjectArtifact(withString, limits);

  assert.equal(encodedObjectId.sha256, encodedString.sha256);
  assert.deepEqual(encodedObjectId.compressedBytes, encodedString.compressedBytes);
  assert.equal(
    (await decodeProjectArtifact(
      encodedObjectId.compressedBytes,
      encodedObjectId.manifest,
      limits
    )).files[1].generatedByRunId,
    runId.toHexString()
  );
});

test('rejects invalid generatedByRunId values', async () => {
  for (const generatedByRunId of [42, {}, { toString: () => 'unsafe' }]) {
    const invalid = bundle();
    invalid.files[0] = {
      ...invalid.files[0],
      generatedByRunId
    } as unknown as typeof invalid.files[number];
    await expectCode('ARTIFACT_INVALID_BUNDLE', () =>
      encodeProjectArtifact(invalid, limits)
    );
  }
});

test('rejects invalid bundle version and package maps', async () => {
  const invalidVersion = { ...bundle(), version: 2 } as unknown as ProjectArtifactBundleV1;
  await expectCode('ARTIFACT_INVALID_BUNDLE', () => encodeProjectArtifact(invalidVersion, limits));

  const invalidMap = bundle();
  invalidMap.packageJson.dependencies = { broken: '' };
  await expectCode('ARTIFACT_INVALID_BUNDLE', () => encodeProjectArtifact(invalidMap, limits));
});

test('enforces file count, uncompressed, and compressed limits while encoding', async () => {
  await expectCode('ARTIFACT_LIMIT_EXCEEDED', () =>
    encodeProjectArtifact(bundle(), { ...limits, maxFiles: 1 })
  );
  await expectCode('ARTIFACT_LIMIT_EXCEEDED', () =>
    encodeProjectArtifact(bundle(), { ...limits, maxUncompressedBytes: 10 })
  );
  await expectCode('ARTIFACT_LIMIT_EXCEEDED', () =>
    encodeProjectArtifact(bundle(), { ...limits, maxCompressedBytes: 10 })
  );
});

test('rejects zero-valued artifact limits as an invalid bundle contract', async () => {
  for (const name of [
    'maxCompressedBytes',
    'maxUncompressedBytes',
    'maxFiles'
  ] as const) {
    await expectCode('ARTIFACT_INVALID_BUNDLE', () =>
      encodeProjectArtifact(bundle(), { ...limits, [name]: 0 })
    );
  }

  const encoded = await encodeProjectArtifact(bundle(), limits);
  await expectCode('ARTIFACT_INVALID_BUNDLE', () =>
    decodeProjectArtifact(encoded.compressedBytes, encoded.manifest, {
      ...limits,
      maxUncompressedBytes: 0
    })
  );
});

test('rejects corrupt gzip, sha, lengths, and unsupported format version', async () => {
  const encoded = await encodeProjectArtifact(bundle(), limits);
  const corrupt = Buffer.from(encoded.compressedBytes);
  corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
  await expectCode('ARTIFACT_CORRUPT', () =>
    decodeProjectArtifact(corrupt, encoded.manifest, limits)
  );
  await expectCode('ARTIFACT_CORRUPT', () =>
    decodeProjectArtifact(encoded.compressedBytes, {
      ...encoded.manifest,
      sha256: '0'.repeat(64)
    }, limits)
  );
  await expectCode('ARTIFACT_CORRUPT', () =>
    decodeProjectArtifact(encoded.compressedBytes, {
      ...encoded.manifest,
      uncompressedBytes: encoded.manifest.uncompressedBytes + 1
    }, limits)
  );
  await expectCode('ARTIFACT_CORRUPT', () =>
    decodeProjectArtifact(encoded.compressedBytes, {
      ...encoded.manifest,
      compressedBytes: encoded.manifest.compressedBytes + 1
    }, limits)
  );
  await expectCode('ARTIFACT_FORMAT_UNSUPPORTED', () =>
    decodeProjectArtifact(encoded.compressedBytes, {
      ...encoded.manifest,
      formatVersion: 2
    } as unknown as ArtifactIntegrity, limits)
  );
});

test('rejects manifest file-count mismatch', async () => {
  const encoded = await encodeProjectArtifact(bundle(), limits);
  await expectCode('ARTIFACT_CORRUPT', () =>
    decodeProjectArtifact(encoded.compressedBytes, {
      ...encoded.manifest,
      fileCount: encoded.manifest.fileCount + 1
    }, limits)
  );
});

test('gzip bombs hit maxOutputLength before JSON parsing', async () => {
  const bomb = gzipSync(Buffer.alloc(32 * 1024, 0x61));
  const manifest: ArtifactIntegrity = {
    format: 'open-v0.bundle+json+gzip',
    formatVersion: 1,
    sha256: '0'.repeat(64),
    uncompressedBytes: 32 * 1024,
    compressedBytes: bomb.byteLength,
    fileCount: 0
  };

  await expectCode('ARTIFACT_LIMIT_EXCEEDED', () =>
    decodeProjectArtifact(bomb, manifest, {
      maxCompressedBytes: bomb.byteLength,
      maxUncompressedBytes: 1024,
      maxFiles: 1
    })
  );
});

const integrityFor = (
  uncompressedBytes: Uint8Array,
  compressedBytes: Uint8Array,
  fileCount: number
): ArtifactIntegrity => ({
  format: 'open-v0.bundle+json+gzip',
  formatVersion: 1,
  sha256: createHash('sha256').update(uncompressedBytes).digest('hex'),
  uncompressedBytes: uncompressedBytes.byteLength,
  compressedBytes: compressedBytes.byteLength,
  fileCount
});

test('rejects invalid UTF-8 even when length and sha256 are correct', async () => {
  const prefix = Buffer.from(
    '{"version":1,"files":[{"path":"src/a.ts","content":"'
  );
  const suffix = Buffer.from(
    '","language":"ts"}],"packageJson":{"dependencies":{},"devDependencies":{},"scripts":{}}}'
  );
  const invalidUtf8 = Buffer.concat([prefix, Buffer.from([0xff]), suffix]);
  const compressed = gzipSync(invalidUtf8);

  await expectCode('ARTIFACT_CORRUPT', () =>
    decodeProjectArtifact(
      new Uint8Array(compressed),
      integrityFor(invalidUtf8, compressed, 1),
      limits
    )
  );
});

test('maps decoded schema and path failures to ARTIFACT_CORRUPT with cause', async () => {
  const invalidBundle = Buffer.from(JSON.stringify({
    version: 1,
    files: [{ path: '../escape.ts', content: '', language: 'ts' }],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} }
  }));
  const compressed = gzipSync(invalidBundle);

  await assert.rejects(
    decodeProjectArtifact(
      new Uint8Array(compressed),
      integrityFor(invalidBundle, compressed, 1),
      limits
    ),
    error =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_CORRUPT' &&
      error.cause instanceof ArtifactError &&
      error.cause.code === 'ARTIFACT_INVALID_PATH'
  );
});
