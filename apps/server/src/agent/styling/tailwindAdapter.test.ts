import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectFile } from '../types';
import {
  createPostcssConfig,
  createTailwindConfig,
  tailwindAdapter
} from './tailwindAdapter';

const file = (path: string, content: string, language: ProjectFile['language']): ProjectFile =>
  ({ path, content, language });

test('reports missing Tailwind configuration and entry imports', () => {
  const issues = tailwindAdapter.validateSource([
    file('src/index.css', '@tailwind utilities;', 'css'),
    file('src/main.tsx', 'export {};', 'tsx')
  ]);
  assert.deepEqual(issues.map(issue => issue.code), [
    'MISSING_CONFIGURATION',
    'MISSING_ENTRY_IMPORT'
  ]);
});

test('provides deterministic Tailwind Preview compatibility', () => {
  const result = tailwindAdapter.previewCompatibility([
    file('src/index.css', '@tailwind utilities;', 'css')
  ]);
  assert.equal(result.files['tailwind.config.js'], createTailwindConfig());
  assert.equal(result.files['postcss.config.cjs'], createPostcssConfig());
  assert.equal(result.dependencies.tailwindcss, '^3.4.17');
  assert.match(result.files['tailwind.config.js']!, /src\/\*\*/);
});

test('accepts a complete Tailwind source contract', () => {
  assert.deepEqual(tailwindAdapter.validateSource([
    file('tailwind.config.js', createTailwindConfig(), 'js'),
    file('postcss.config.cjs', createPostcssConfig(), 'js'),
    file('src/index.css', '@tailwind utilities;', 'css'),
    file('src/main.tsx', "import './index.css';", 'tsx')
  ]), []);
});
