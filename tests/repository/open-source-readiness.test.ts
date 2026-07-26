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

test('environment examples document the real runtime configuration', async () => {
  const rootEnv = await readFile(repositoryFile('.env.example'), 'utf8');
  const serverEnv = await readFile(
    repositoryFile('apps/server/.env.example'),
    'utf8'
  );
  const webEnv = await readFile(
    repositoryFile('apps/web/.env.example'),
    'utf8'
  );

  for (const key of [
    'JWT_SECRET',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_BASE_URL',
    'DEEPSEEK_MODEL',
    'AGENT_MODEL',
    'AGENT_MAX_REPAIR_ATTEMPTS',
    'AGENT_VALIDATION_DEPENDENCY_CACHE_ROOT'
  ]) {
    assert.match(rootEnv, new RegExp(`^${key}=`, 'm'));
  }

  assert.match(serverEnv, /^REDIS_URL=/m);
  assert.match(serverEnv, /^DEEPSEEK_API_KEY=/m);
  assert.doesNotMatch(serverEnv, /^OPENAI_API_KEY=/m);
  assert.match(webEnv, /^VITE_API_URL=/m);

  for (const contents of [rootEnv, serverEnv, webEnv]) {
    assert.doesNotMatch(contents, /sk-[A-Za-z0-9_-]{16,}/);
  }
});

test('README presents the platform-builder positioning and valid core docs', async () => {
  const readme = await readFile(repositoryFile('README.md'), 'utf8');

  assert.match(readme, /帮助团队搭建自己的 v0/);
  assert.match(readme, /不只是生成代码，而是生成能够通过真实构建的代码/);
  assert.match(readme, /规划.*生成.*类型检查.*生产构建.*诊断.*修复.*快照/s);
  assert.doesNotMatch(readme, /类似于 v0\.dev/);

  for (const relativePath of [
    'docs/architecture.md',
    'docs/troubleshooting.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'ROADMAP.md'
  ]) {
    await access(repositoryFile(relativePath));
    assert.match(readme, new RegExp(
      relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ));
  }
});

test('repository includes contribution templates and a reproducible example', async () => {
  const requiredFiles = [
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'docs/examples/verified-dashboard.md',
    'docs/release-checklist.md'
  ];

  await Promise.all(
    requiredFiles.map(relativePath => access(repositoryFile(relativePath)))
  );

  const example = await readFile(
    repositoryFile('docs/examples/verified-dashboard.md'),
    'utf8'
  );
  assert.match(example, /生成一个运营 Dashboard/);
  assert.match(example, /Add a compact activity section/);

  const checklist = await readFile(
    repositoryFile('docs/release-checklist.md'),
    'utf8'
  );
  assert.match(checklist, /npm run test:smoke/);
  assert.match(checklist, /四名测试者/);
});
