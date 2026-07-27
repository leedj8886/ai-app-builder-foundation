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
  assert.match(contributing, /应用层 Agent 框架.*默认不进入核心包/s);
  assert.match(contributing, /独立、可选的 Adapter/);
  assert.match(
    contributing,
    /默认启动、测试、构建或自托管流程的前置条件/
  );

  const security = await readFile(repositoryFile('SECURITY.md'), 'utf8');
  assert.match(security, /不要在公开 Issue 中披露/);

  const roadmap = await readFile(repositoryFile('ROADMAP.md'), 'utf8');
  assert.match(roadmap, /帮助团队搭建自己的 v0/);
  assert.match(roadmap, /## 长期架构护栏/);
  assert.match(roadmap, /TypeScript Native/);
  assert.match(roadmap, /Framework-Agnostic Core/);
  assert.match(roadmap, /项目自有接口/);
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
    'AGENT_VALIDATION_EXECUTOR',
    'AGENT_VALIDATION_DEPENDENCY_CACHE_ROOT'
  ]) {
    assert.match(rootEnv, new RegExp(`^${key}=`, 'm'));
  }

  assert.match(serverEnv, /^REDIS_URL=/m);
  assert.match(serverEnv, /^DEEPSEEK_API_KEY=/m);
  assert.match(serverEnv, /^AGENT_VALIDATION_EXECUTOR=legacy$/m);
  assert.match(serverEnv, /^SANDBOX_PROVIDER=fake$/m);
  assert.match(serverEnv, /^SANDBOX_LOCAL_ENABLED=false$/m);
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
  assert.match(readme, /TypeScript Native/);
  assert.match(readme, /Framework-Agnostic Core/);
  assert.match(readme, /LangChain、LangGraph、AI SDK/);
  assert.match(readme, /独立、可选的 Adapter/);
  assert.match(readme, /规划.*生成.*类型检查.*生产构建.*诊断.*修复.*快照/s);
  assert.match(readme, /AGENT_VALIDATION_EXECUTOR/);
  assert.match(readme, /simulated.*不能生成.*Snapshot/s);
  assert.doesNotMatch(readme, /尚未把 Agent Worker 校验切换到 Sandbox/);
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

test('architecture keeps the core independent from application agent frameworks', async () => {
  const architecture = await readFile(
    repositoryFile('docs/architecture.md'),
    'utf8'
  );

  assert.match(architecture, /## 核心边界/);
  assert.match(
    architecture,
    /Model Provider.*Agent Runtime.*Tool Registry.*Run.*Event State.*Workspace Snapshot.*Validate.*Repair.*Preview/s
  );
  assert.match(
    architecture,
    /核心不依赖 LangChain、LangGraph、AI SDK 等应用层 Agent 框架/
  );
  assert.match(architecture, /独立、可选的 Adapter/);
});
