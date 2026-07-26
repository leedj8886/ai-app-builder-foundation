import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDependencyCache } from './dependencyCache';

const withRoot = async (
  callback: (root: string) => Promise<void>
): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dependency-cache-test-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('dependency cache installs once then returns a cache hit', async () => {
  await withRoot(async root => {
    let now = 100;
    const cache = createDependencyCache({
      root,
      pollIntervalMs: 5,
      now: () => now
    });
    const firstWorkspace = path.join(root, 'workspace-1');
    const secondWorkspace = path.join(root, 'workspace-2');
    await Promise.all([mkdir(firstWorkspace), mkdir(secondWorkspace)]);
    let installs = 0;
    const install = async (stagingPath: string) => {
      installs += 1;
      await mkdir(path.join(stagingPath, 'node_modules'), { recursive: true });
      await writeFile(
        path.join(stagingPath, 'node_modules', 'installed.txt'),
        'ready'
      );
    };

    const first = await cache.prepare({
      fingerprint: 'fingerprint',
      workspacePath: firstWorkspace,
      install
    });
    now = 200;
    const second = await cache.prepare({
      fingerprint: 'fingerprint',
      workspacePath: secondWorkspace,
      install
    });

    assert.equal(first.cache, 'miss');
    assert.equal(second.cache, 'hit');
    assert.equal(installs, 1);
    assert.equal(
      JSON.parse(
        await readFile(path.join(root, 'fingerprint', 'complete.json'), 'utf8')
      ).lastUsedAt,
      200
    );
    assert.equal(
      await readFile(
        path.join(secondWorkspace, 'node_modules', 'installed.txt'),
        'utf8'
      ),
      'ready'
    );
  });
});

test('concurrent dependency cache requests perform one installation', async () => {
  await withRoot(async root => {
    const cache = createDependencyCache({ root, pollIntervalMs: 5 });
    const workspaces = [path.join(root, 'a'), path.join(root, 'b')];
    await Promise.all(workspaces.map(workspace => mkdir(workspace)));
    let installs = 0;
    const install = async (stagingPath: string) => {
      installs += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      await mkdir(path.join(stagingPath, 'node_modules'), { recursive: true });
    };

    const results = await Promise.all(workspaces.map(workspacePath =>
      cache.prepare({ fingerprint: 'same', workspacePath, install })
    ));

    assert.equal(installs, 1);
    assert.deepEqual(
      results.map(result => result.cache).sort(),
      ['hit', 'miss']
    );
  });
});

test('failed or incomplete cache population can be retried', async () => {
  await withRoot(async root => {
    const cache = createDependencyCache({ root, pollIntervalMs: 5 });
    const firstWorkspace = path.join(root, 'first');
    const secondWorkspace = path.join(root, 'second');
    await Promise.all([mkdir(firstWorkspace), mkdir(secondWorkspace)]);

    await assert.rejects(
      cache.prepare({
        fingerprint: 'retry',
        workspacePath: firstWorkspace,
        install: async () => {
          throw new Error('install failed');
        }
      }),
      /install failed/
    );

    const result = await cache.prepare({
      fingerprint: 'retry',
      workspacePath: secondWorkspace,
      install: async stagingPath => {
        await mkdir(path.join(stagingPath, 'node_modules'), { recursive: true });
      }
    });
    assert.equal(result.cache, 'miss');
  });
});
