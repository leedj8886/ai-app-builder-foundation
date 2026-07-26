import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SharedFilesystemArtifactStore } from './SharedFilesystemArtifactStore';
import { ArtifactError } from './types';

const key = 'v1/ab/cd/abcdefabcdefabcdefabcdefabcdefab.json.gz';
const finalPathFor = (root: string): string => path.join(root, key);

const assertNoTempFiles = async (root: string): Promise<void> => {
  const parent = path.dirname(finalPathFor(root));
  const entries = await readdir(parent);
  assert.deepEqual(entries.filter(entry => entry.endsWith('.tmp')), []);
};

const expectCode = async (
  code: string,
  callback: () => unknown | Promise<unknown>
): Promise<void> => {
  await assert.rejects(Promise.resolve().then(callback), error =>
    error instanceof ArtifactError && error.code === code
  );
};

test('shared store satisfies the ArtifactStore contract', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SharedFilesystemArtifactStore(root);
  const bytes = new TextEncoder().encode('artifact');

  assert.equal(await store.exists(key), false);
  await store.put({ storageKey: key, bytes });
  assert.equal(await store.exists(key), true);
  assert.deepEqual(await store.get(key), bytes);
  await expectCode('ARTIFACT_WRITE_FAILED', () =>
    store.put({ storageKey: key, bytes })
  );
  await store.delete(key);
  assert.equal(await store.exists(key), false);
  await store.delete(key);
  await assertNoTempFiles(root);
});

test('shared store rejects traversal and symlink targets', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  const target = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-target-'));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(target, { recursive: true, force: true })
  ]));
  const store = new SharedFilesystemArtifactStore(root);

  await expectCode('ARTIFACT_INVALID_PATH', () => store.get('../secret'));
  await symlink(target, path.join(root, 'v1'));
  await expectCode('ARTIFACT_INVALID_PATH', () =>
    store.put({
      storageKey: key,
      bytes: new Uint8Array([1])
    })
  );
  await expectCode('ARTIFACT_INVALID_PATH', () => store.get(key));
  await expectCode('ARTIFACT_INVALID_PATH', () => store.exists(key));
  await expectCode('ARTIFACT_INVALID_PATH', () => store.delete(key));
  await assert.rejects(access(path.join(target, 'ab')), { code: 'ENOENT' });
});

test('concurrent puts publish exactly one complete winner without overwriting', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SharedFilesystemArtifactStore(root);
  const first = new TextEncoder().encode('first artifact');
  const second = new TextEncoder().encode('second artifact');

  const results = await Promise.allSettled([
    store.put({ storageKey: key, bytes: first }),
    store.put({ storageKey: key, bytes: second })
  ]);

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.ok(rejected.reason instanceof ArtifactError);
  assert.equal(rejected.reason.code, 'ARTIFACT_WRITE_FAILED');

  const winner = results[0].status === 'fulfilled' ? first : second;
  assert.deepEqual(await store.get(key), winner);
  await assertNoTempFiles(root);
});

test('shared store rejects symlink and non-regular final targets', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  const target = path.join(root, 'target');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.dirname(finalPathFor(root)), { recursive: true });
  await writeFile(target, 'outside artifact');
  await symlink(target, finalPathFor(root));
  const store = new SharedFilesystemArtifactStore(root);

  await expectCode('ARTIFACT_INVALID_PATH', () => store.get(key));
  await expectCode('ARTIFACT_INVALID_PATH', () => store.exists(key));
  await expectCode('ARTIFACT_INVALID_PATH', () => store.delete(key));

  await rm(finalPathFor(root));
  await mkdir(finalPathFor(root));
  await expectCode('ARTIFACT_INVALID_PATH', () => store.get(key));
  await expectCode('ARTIFACT_INVALID_PATH', () => store.exists(key));
  await expectCode('ARTIFACT_INVALID_PATH', () => store.delete(key));
});

test('shared store reports temp cleanup failures without changing put success', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cleanupError = new Error('cleanup failed');
  const warnings: unknown[] = [];
  const store = new SharedFilesystemArtifactStore(root, {
    removeTemp: async () => {
      throw cleanupError;
    },
    onCleanupError: error => {
      warnings.push(error);
    }
  });

  await store.put({ storageKey: key, bytes: new Uint8Array([1, 2, 3]) });

  assert.deepEqual(await store.get(key), new Uint8Array([1, 2, 3]));
  assert.deepEqual(warnings, [cleanupError]);
});

test('shared store syncs each new namespace entry, publication, and deletion', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const synced: string[] = [];
  const store = new SharedFilesystemArtifactStore(root, {
    directorySync: async directory => {
      synced.push(directory);
    }
  });

  await store.put({ storageKey: key, bytes: new Uint8Array([1]) });
  assert.deepEqual(synced, [
    root,
    path.join(root, 'v1'),
    path.join(root, 'v1/ab'),
    path.join(root, 'v1/ab/cd')
  ]);

  synced.length = 0;
  await store.delete(key);
  assert.deepEqual(synced, [path.join(root, 'v1/ab/cd')]);
});

test('shared store maps directory sync failures to retryable unavailability', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ioError = Object.assign(new Error('sync failed'), { code: 'EIO' });
  const store = new SharedFilesystemArtifactStore(root, {
    directorySync: async () => {
      throw ioError;
    }
  });

  await assert.rejects(
    store.put({ storageKey: key, bytes: new Uint8Array([1]) }),
    error =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_STORE_UNAVAILABLE' &&
      error.retryable
  );
});

test('async cleanup reporter rejection does not escape a successful put', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SharedFilesystemArtifactStore(root, {
    removeTemp: async () => {
      throw new Error('cleanup failed');
    },
    onCleanupError: async () => {
      throw new Error('reporting failed');
    }
  });

  await store.put({ storageKey: key, bytes: new Uint8Array([4, 5, 6]) });
  assert.deepEqual(await store.get(key), new Uint8Array([4, 5, 6]));
});

test('put retries fsync the complete existing namespace chain', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const synced: string[] = [];
  let failOnce = true;
  const store = new SharedFilesystemArtifactStore(root, {
    directorySync: async directory => {
      synced.push(directory);
      if (failOnce) {
        failOnce = false;
        throw Object.assign(new Error('sync failed'), { code: 'EIO' });
      }
    }
  });

  await assert.rejects(
    store.put({ storageKey: key, bytes: new Uint8Array([7]) }),
    error =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_STORE_UNAVAILABLE' &&
      error.retryable
  );

  synced.length = 0;
  await store.put({ storageKey: key, bytes: new Uint8Array([7]) });
  assert.deepEqual(synced, [
    root,
    path.join(root, 'v1'),
    path.join(root, 'v1/ab'),
    path.join(root, 'v1/ab/cd')
  ]);
});

test('delete retry fsyncs the parent after unlink already succeeded', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let failDeleteSync = false;
  const synced: string[] = [];
  const store = new SharedFilesystemArtifactStore(root, {
    directorySync: async directory => {
      synced.push(directory);
      if (failDeleteSync) {
        failDeleteSync = false;
        throw Object.assign(new Error('sync failed'), { code: 'EIO' });
      }
    }
  });
  await store.put({ storageKey: key, bytes: new Uint8Array([8]) });
  synced.length = 0;
  failDeleteSync = true;

  await assert.rejects(
    store.delete(key),
    error =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_STORE_UNAVAILABLE' &&
      error.retryable
  );
  await store.delete(key);

  assert.deepEqual(synced, [
    path.join(root, 'v1/ab/cd'),
    path.join(root, 'v1/ab/cd')
  ]);
});

test('put retry repairs final publication durability before rejecting overwrite', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const finalParent = path.join(root, 'v1/ab/cd');
  let failPublicationSync = true;
  const synced: string[] = [];
  const bytes = new Uint8Array([9, 10, 11]);
  const store = new SharedFilesystemArtifactStore(root, {
    directorySync: async directory => {
      synced.push(directory);
      if (directory === finalParent && failPublicationSync) {
        failPublicationSync = false;
        throw Object.assign(new Error('sync failed'), { code: 'EIO' });
      }
    }
  });

  await assert.rejects(
    store.put({ storageKey: key, bytes }),
    error =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_STORE_UNAVAILABLE' &&
      error.retryable
  );
  await expectCode('ARTIFACT_WRITE_FAILED', () =>
    store.put({ storageKey: key, bytes: new Uint8Array([99]) })
  );

  assert.deepEqual(await store.get(key), bytes);
  assert.equal(synced.filter(directory => directory === finalParent).length, 2);
});
