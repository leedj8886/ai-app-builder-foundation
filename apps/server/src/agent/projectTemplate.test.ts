import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProjectTemplateFiles,
  resolveProjectBaseFiles
} from './projectTemplate';

test('createProjectTemplateFiles returns a complete React Vite entry', () => {
  const files = createProjectTemplateFiles();

  assert.deepEqual(files.map(file => file.path), [
    'index.html',
    'src/App.tsx',
    'src/index.css',
    'src/main.tsx'
  ]);
  assert.equal(
    files.find(file => file.path === 'index.html')?.content.includes('/src/main.tsx'),
    true
  );
  assert.equal(
    files.find(file => file.path === 'src/main.tsx')?.content.includes('./App'),
    true
  );
  assert.equal(
    files.find(file => file.path === 'src/main.tsx')?.content.includes('./index.css'),
    true
  );
});

test('createProjectTemplateFiles returns fresh file objects', () => {
  const first = createProjectTemplateFiles();
  const second = createProjectTemplateFiles();

  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.deepEqual(first, second);
});

test('resolveProjectBaseFiles uses a snapshot even when it has no files', () => {
  const emptySnapshotFiles: ReturnType<typeof createProjectTemplateFiles> = [];

  assert.equal(resolveProjectBaseFiles(emptySnapshotFiles), emptySnapshotFiles);
});

test('resolveProjectBaseFiles creates the template only without a snapshot', () => {
  assert.deepEqual(
    resolveProjectBaseFiles(undefined).map(file => file.path),
    ['index.html', 'src/App.tsx', 'src/index.css', 'src/main.tsx']
  );
});
