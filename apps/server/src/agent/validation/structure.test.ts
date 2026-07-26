import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectTemplateFiles } from '../projectTemplate';
import { validateProjectStructure } from './structure';

const packageJson = {
  dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
  devDependencies: {},
  scripts: { 'type-check': 'tsc --noEmit', build: 'tsc && vite build' }
};

const validFiles = () => [
  ...createProjectTemplateFiles(),
  {
    path: 'package.json' as const,
    language: 'json' as const,
    content: JSON.stringify(packageJson)
  }
];

test('validateProjectStructure accepts the server React template', () => {
  const result = validateProjectStructure(validFiles());

  assert.equal(result.status, 'passed');
  assert.equal(result.stderr, '');
});

test('validateProjectStructure rejects a missing React entry before npm', () => {
  const files = validFiles().filter(
    file => file.path !== 'src/main.tsx'
  );
  const result = validateProjectStructure(files);

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'CODE_ERROR');
  assert.match(result.stderr, /src\/main\.tsx/);
});

test('validateProjectStructure rejects invalid package JSON and missing scripts', () => {
  const files = validFiles();
  const packageFile = files.find(file => file.path === 'package.json')!;

  assert.equal(
    validateProjectStructure([
      ...files.filter(file => file.path !== 'package.json'),
      { ...packageFile, content: '{invalid' }
    ]).category,
    'DEPENDENCY_ERROR'
  );

  const parsed = JSON.parse(packageFile.content);
  delete parsed.scripts.build;
  const result = validateProjectStructure([
    ...files.filter(file => file.path !== 'package.json'),
    { ...packageFile, content: JSON.stringify(parsed) }
  ]);
  assert.equal(result.category, 'DEPENDENCY_ERROR');
  assert.match(result.stderr, /build/);
});
