import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  applyFileOperations,
  inferProjectFileLanguage
} from './fileOperations';
import { ProjectFile } from './types';

const baseFiles: ProjectFile[] = [
  {
    path: 'src/App.tsx',
    content: 'export function App() { return null; }',
    language: 'tsx'
  },
  {
    path: 'README.md',
    content: '# Existing',
    language: 'md'
  }
];

test('applyFileOperations creates updates deletes and sorts files', () => {
  const runId = new Types.ObjectId();
  const files = applyFileOperations(
    baseFiles,
    [
      { type: 'update', path: 'src/App.tsx', content: 'export function App() { return <main />; }' },
      { type: 'create', path: 'src/index.css', content: '@tailwind base;' },
      { type: 'delete', path: 'README.md' }
    ],
    runId
  );

  assert.deepEqual(
    files.map(file => file.path),
    ['src/App.tsx', 'src/index.css']
  );
  assert.equal(files[0].content, 'export function App() { return <main />; }');
  assert.equal(files[0].language, 'tsx');
  assert.equal(files[0].generatedByRunId?.toString(), runId.toString());
  assert.equal(files[1].language, 'css');
});

test('inferProjectFileLanguage maps supported extensions', () => {
  assert.equal(inferProjectFileLanguage('src/main.ts'), 'ts');
  assert.equal(inferProjectFileLanguage('src/App.tsx'), 'tsx');
  assert.equal(inferProjectFileLanguage('src/index.css'), 'css');
  assert.equal(inferProjectFileLanguage('package.json'), 'json');
  assert.equal(inferProjectFileLanguage('index.html'), 'html');
  assert.equal(inferProjectFileLanguage('README.md'), 'md');
  assert.equal(inferProjectFileLanguage('prisma/schema.prisma'), 'prisma');
  assert.equal(inferProjectFileLanguage('prisma/migrations/init/migration.sql'), 'sql');
});

test('inferProjectFileLanguage maps JavaScript configuration extensions', () => {
  assert.equal(inferProjectFileLanguage('tailwind.config.js'), 'js');
  assert.equal(inferProjectFileLanguage('postcss.config.cjs'), 'js');
  assert.equal(inferProjectFileLanguage('vite.config.mjs'), 'js');
});

test('applyFileOperations rejects unsafe paths and unsupported files', () => {
  assert.throws(
    () => applyFileOperations([], [{ type: 'create', path: '/tmp/App.tsx', content: '' }]),
    /relative path/
  );
  assert.throws(
    () => applyFileOperations([], [{ type: 'create', path: '../App.tsx', content: '' }]),
    /escape/
  );
  assert.throws(
    () => applyFileOperations([], [{ type: 'create', path: 'src/../App.tsx', content: '' }]),
    /escape/
  );
  assert.throws(
    () => applyFileOperations([], [{ type: 'create', path: 'src/logo.png', content: '' }]),
    /Unsupported file extension/
  );
  assert.throws(
    () => applyFileOperations([], [{ type: 'create', path: 'src/App.tsx', content: 'abc\0def' }]),
    /binary/
  );
});

test('applyFileOperations does not delete required template files', () => {
  assert.throws(
    () =>
      applyFileOperations(
        [
          {
            path: 'package.json',
            content: '{}',
            language: 'json'
          }
        ],
        [{ type: 'delete', path: 'package.json' }]
      ),
    /required file/
  );
  for (const path of ['tailwind.config.js', 'postcss.config.cjs']) {
    assert.throws(
      () => applyFileOperations(
        [{ path, content: '', language: 'js' }],
        [{ type: 'delete', path }]
      ),
      /required file/
    );
  }
});
