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
    'postcss.config.cjs',
    'src/App.tsx',
    'src/index.css',
    'src/main.tsx',
    'tailwind.config.js',
    'tsconfig.json'
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
  assert.deepEqual(
    JSON.parse(files.find(file => file.path === 'tsconfig.json')?.content ?? ''),
    {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        allowJs: false,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        module: 'ESNext',
        moduleResolution: 'Node',
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx'
      },
      include: ['src']
    }
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
    [
      'index.html',
      'postcss.config.cjs',
      'src/App.tsx',
      'src/index.css',
      'src/main.tsx',
      'tailwind.config.js',
      'tsconfig.json'
    ]
  );
});
