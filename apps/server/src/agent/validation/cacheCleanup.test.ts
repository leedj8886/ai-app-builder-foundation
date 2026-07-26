import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupDependencyCache } from './cacheCleanup';

const createEntry = async (
  root: string,
  name: string,
  lastUsedAt: number,
  bytes: number
): Promise<void> => {
  const entry = path.join(root, name);
  await mkdir(path.join(entry, 'node_modules'), { recursive: true });
  await writeFile(
    path.join(entry, 'complete.json'),
    JSON.stringify({ fingerprint: name, lastUsedAt })
  );
  await writeFile(path.join(entry, 'node_modules', 'payload'), 'x'.repeat(bytes));
};

test('removes expired entries while preserving recent and locked entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'validation-cache-cleanup-'));
  try {
    await createEntry(root, 'expired', 100, 20);
    await createEntry(root, 'locked-expired', 100, 20);
    await createEntry(root, 'recent', 900, 20);
    await mkdir(path.join(root, '.locks'), { recursive: true });
    await writeFile(path.join(root, '.locks', 'locked-expired.lock'), '');

    const result = await cleanupDependencyCache({
      root,
      retentionMs: 500,
      maxBytes: 10_000,
      now: 1_000
    });

    assert.equal(result.removedEntries, 1);
    await assert.rejects(
      import('node:fs/promises').then(fs => fs.access(path.join(root, 'expired')))
    );
    await import('node:fs/promises').then(fs =>
      fs.access(path.join(root, 'locked-expired'))
    );
    await import('node:fs/promises').then(fs => fs.access(path.join(root, 'recent')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('evicts unlocked entries oldest first when the cache exceeds its size bound', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'validation-cache-cleanup-'));
  try {
    await createEntry(root, 'oldest', 700, 100);
    await createEntry(root, 'middle', 800, 100);
    await createEntry(root, 'newest', 900, 100);

    const result = await cleanupDependencyCache({
      root,
      retentionMs: 10_000,
      maxBytes: 400,
      now: 1_000
    });

    assert.ok(result.removedEntries >= 1);
    await assert.rejects(
      import('node:fs/promises').then(fs => fs.access(path.join(root, 'oldest')))
    );
    await import('node:fs/promises').then(fs => fs.access(path.join(root, 'newest')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
