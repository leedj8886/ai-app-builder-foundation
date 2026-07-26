import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

const repositoryFile = (relativePath: string): string =>
  path.join(repositoryRoot, relativePath);

test('repository contains the approved open-source governance files', async () => {
  const requiredFiles = [
    'LICENSE',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'ROADMAP.md'
  ];

  await Promise.all(
    requiredFiles.map(relativePath => access(repositoryFile(relativePath)))
  );

  const license = await readFile(repositoryFile('LICENSE'), 'utf8');
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /http:\/\/www\.apache\.org\/licenses\//);

  const contributing = await readFile(
    repositoryFile('CONTRIBUTING.md'),
    'utf8'
  );
  assert.match(contributing, /npm run test:readiness/);
  assert.match(contributing, /npm run test:smoke/);

  const security = await readFile(repositoryFile('SECURITY.md'), 'utf8');
  assert.match(security, /不要在公开 Issue 中披露/);

  const roadmap = await readFile(repositoryFile('ROADMAP.md'), 'utf8');
  assert.match(roadmap, /帮助团队搭建自己的 v0/);
});
