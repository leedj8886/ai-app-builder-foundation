import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readCssBuildEvidence } from './buildEvidence';

test('reads sorted bounded CSS assets without following unrelated files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'css-evidence-'));
  try {
    await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'assets', 'z.css'), 'z'.repeat(20));
    await writeFile(path.join(root, 'dist', 'assets', 'a.css'), '.bg-blue-100{}');
    await writeFile(path.join(root, 'dist', 'assets', 'app.js'), 'ignored');
    const assets = await readCssBuildEvidence({ workspacePath: root, maxChars: 25 });
    assert.deepEqual(assets.map(asset => asset.path), [
      'dist/assets/a.css',
      'dist/assets/z.css'
    ]);
    assert.equal(assets.reduce((sum, asset) => sum + asset.content.length, 0), 25);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
