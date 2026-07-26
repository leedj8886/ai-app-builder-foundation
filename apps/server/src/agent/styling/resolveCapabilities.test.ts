import assert from 'node:assert/strict';
import test from 'node:test';
import { inferProjectFileLanguage } from '../fileOperations';
import type { ProjectFile } from '../types';
import { resolveStylingCapabilities } from './resolveCapabilities';

const files = (contents: Record<string, string>): ProjectFile[] =>
  Object.entries(contents).map(([path, content]) => ({
    path,
    content,
    language: inferProjectFileLanguage(path)
  }));

test('detects Tailwind from directives and dependencies', () => {
  const result = resolveStylingCapabilities(files({
    'package.json': JSON.stringify({
      devDependencies: { tailwindcss: '^3.4.17' }
    }),
    'src/index.css': '@tailwind base;\n@tailwind utilities;'
  }));

  assert.deepEqual(result.capabilities, ['plain-css', 'tailwind']);
  assert.match(result.evidence.tailwind!.join(' '), /@tailwind/);
});

test('supports mixed Tailwind and CSS Modules capabilities', () => {
  const result = resolveStylingCapabilities(files({
    'package.json': JSON.stringify({
      devDependencies: { tailwindcss: '^3.4.17' }
    }),
    'src/index.css': '@tailwind utilities;',
    'src/Card.module.css': '.card { display: grid; }'
  }));

  assert.deepEqual(result.capabilities, [
    'plain-css',
    'tailwind',
    'css-modules'
  ]);
});

test('detects styled-components from package and import evidence', () => {
  const result = resolveStylingCapabilities(files({
    'package.json': JSON.stringify({
      dependencies: { 'styled-components': '^6.1.0' }
    }),
    'src/App.tsx': "import styled from 'styled-components';\nconst Card = styled.div``;"
  }));

  assert.deepEqual(result.capabilities, ['styled-components']);
  assert.equal(result.evidence['styled-components']?.length, 2);
});

test('does not infer Tailwind from className alone', () => {
  const result = resolveStylingCapabilities(files({
    'src/App.tsx': '<div className="card primary" />'
  }));

  assert.deepEqual(result.capabilities, ['plain-css']);
  assert.equal(result.evidence.tailwind, undefined);
});

test('source evidence takes precedence over a conflicting metadata hint', () => {
  const result = resolveStylingCapabilities(files({
    'src/Card.module.css': '.card {}'
  }), 'tailwind');

  assert.deepEqual(result.capabilities, ['plain-css', 'css-modules']);
  assert.match(result.evidence['css-modules']!.join(' '), /Card\.module\.css/);
  assert.match(result.issues[0]?.message ?? '', /tailwind/);
});
