import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectFile } from '../types';
import { compilePreviewCss } from './compilePreviewCss';

const file = (
  path: string,
  content: string,
  language: ProjectFile['language']
): ProjectFile => ({ path, content, language });

test('compiles Preview CSS only for legacy Tailwind snapshots', async () => {
  const legacy = [
    file('src/App.tsx', '<main className="bg-blue-100" />', 'tsx'),
    file('src/index.css', '@tailwind utilities;', 'css')
  ];
  const css = await compilePreviewCss(legacy);
  assert.match(css ?? '', /\.bg-blue-100/);
  assert.match(css ?? '', /219 234 254/);

  assert.equal(await compilePreviewCss([
    ...legacy,
    file('tailwind.config.js', 'module.exports = {}', 'js'),
    file('postcss.config.cjs', 'module.exports = {}', 'js')
  ]), undefined);
  assert.equal(await compilePreviewCss([
    file('src/App.tsx', '<main className="custom-card" />', 'tsx')
  ]), undefined);
});
