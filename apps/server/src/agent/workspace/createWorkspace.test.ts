import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createValidationWorkspace } from './createWorkspace';

test('createValidationWorkspace writes files beneath a unique run directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'v0-workspace-test-'));
  const workspace = await createValidationWorkspace({
    root,
    runId: '64b7f5086f1f8e9f0f000001',
    files: [{
      path: 'src/App.tsx',
      content: 'export default function App() { return null; }',
      language: 'tsx'
    }]
  });

  assert.equal(workspace.path.startsWith(`${root}${path.sep}`), true);
  assert.equal(
    await readFile(path.join(workspace.path, 'src/App.tsx'), 'utf8'),
    'export default function App() { return null; }'
  );

  await workspace.cleanup();
  await assert.rejects(() => stat(workspace.path), { code: 'ENOENT' });
  await workspace.cleanup();
});

test('createValidationWorkspace rejects unsafe run ids and file paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'v0-workspace-test-'));

  await assert.rejects(
    () => createValidationWorkspace({
      root,
      runId: '../outside',
      files: []
    }),
    /Invalid run id/
  );
  await assert.rejects(
    () => createValidationWorkspace({
      root,
      runId: 'safe-run',
      files: [{
        path: '../outside.ts',
        content: '',
        language: 'ts'
      }]
    }),
    /escape/
  );
});
