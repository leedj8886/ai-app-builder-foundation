import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhaseTwoGeneration } from './snapshotGenerator';

test('buildPhaseTwoGeneration returns structured file operations', () => {
  const result = buildPhaseTwoGeneration('创建一个中文任务管理应用');

  assert.equal(result.message, 'Generated a React TypeScript snapshot for: 创建一个中文任务管理应用');
  assert.deepEqual(
    result.operations.map(operation => `${operation.type}:${operation.path}`),
    [
      'create:index.html',
      'create:package.json',
      'create:README.md',
      'create:src/App.tsx',
      'create:src/index.css',
      'create:src/main.tsx'
    ]
  );
  assert.deepEqual(result.dependencies, {
    '@vitejs/plugin-react': '^4.2.1',
    vite: '^5.1.4',
    react: '^18.2.0',
    'react-dom': '^18.2.0',
    'lucide-react': '^0.344.0'
  });
  assert.deepEqual(result.devDependencies, {
    '@types/react': '^18.2.56',
    '@types/react-dom': '^18.2.19',
    typescript: '^5.4.0'
  });
});

test('buildPhaseTwoGeneration embeds the prompt in generated files', () => {
  const result = buildPhaseTwoGeneration('Build a revenue dashboard');
  const appOperation = result.operations.find(
    operation => operation.type === 'create' && operation.path === 'src/App.tsx'
  );

  assert.ok(appOperation);
  assert.equal(appOperation.type, 'create');
  assert.match(appOperation.content, /Build a revenue dashboard/);
});
