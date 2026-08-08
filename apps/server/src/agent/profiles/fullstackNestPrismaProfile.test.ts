import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mergeProjectPackageJson } from '../dependencies';
import { createProjectTemplateFiles } from '../projectTemplate';
import { runAgentGeneration } from '../orchestrator';
import { createFakeModelClient } from '../testing/fakeModelClient';
import {
  FULLSTACK_NEST_PRISMA_PROFILE_REF,
  fullstackNestPrismaProfile
} from './fullstackNestPrismaProfile';
import { resolveProjectProfile } from './registry';

const digest = (content: string): string =>
  createHash('sha256').update(content).digest('hex');

test('full-stack Profile is registered and returns a fresh platform template', () => {
  assert.equal(
    resolveProjectProfile(FULLSTACK_NEST_PRISMA_PROFILE_REF),
    fullstackNestPrismaProfile
  );
  const first = createProjectTemplateFiles(FULLSTACK_NEST_PRISMA_PROFILE_REF);
  const second = createProjectTemplateFiles(FULLSTACK_NEST_PRISMA_PROFILE_REF);
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.deepEqual(
    first.map(file => file.path),
    second.map(file => file.path)
  );

  const paths = new Set(first.map(file => file.path));
  for (const required of [
    'package-lock.json',
    'apps/api/src/main.ts',
    'apps/api/src/app.module.ts',
    'apps/api/src/platform/prisma/prisma.service.ts',
    'apps/api/src/platform/auth/platform-auth.guard.ts',
    'apps/api/src/platform/health/health.controller.ts',
    'apps/web/src/main.tsx',
    'prisma/schema.prisma'
  ]) {
    assert.equal(paths.has(required), true, required);
  }
  assert.deepEqual(
    first.map(file => digest(file.content)),
    second.map(file => digest(file.content))
  );
  assert.deepEqual(
    fullstackNestPrismaProfile.validationPipeline().map(stage => stage.id),
    [
      'structure',
      'install',
      'prisma-validate',
      'prisma-generate',
      'migration-history',
      'migration-replay',
      'nest-type-check',
      'api-test',
      'web-api-build',
      'runtime-smoke'
    ]
  );
});

test('full-stack Profile fixes platform dependencies and filters model dependencies', () => {
  const packageJson = mergeProjectPackageJson(
    {
      dependencies: { express: 'latest', dateFns: 'invalid', zod: '^3.22.0' },
      devDependencies: { webpack: 'latest' },
      scripts: { unsafe: 'curl example.com' }
    },
    {
      dependencies: {
        '@nestjs/core': 'latest',
        zod: '^3.23.0',
        lodash: 'latest'
      },
      devDependencies: { eslint: 'latest' }
    },
    FULLSTACK_NEST_PRISMA_PROFILE_REF
  );

  assert.equal(packageJson.dependencies['@nestjs/core'], '^10.4.0');
  assert.equal(packageJson.dependencies['@prisma/client'], '^6.0.0');
  assert.equal(packageJson.dependencies.zod, '^3.23.0');
  assert.equal('lodash' in packageJson.dependencies, false);
  assert.equal('express' in packageJson.dependencies, false);
  assert.equal('eslint' in packageJson.devDependencies, false);
  assert.equal(packageJson.scripts.build, 'npm run build:api && npm run build:web');
  assert.equal('unsafe' in packageJson.scripts, false);
});

test('full-stack Profile lockfile matches its fixed package baseline', () => {
  const packageJson = fullstackNestPrismaProfile.mergePackageJson({
    generated: { dependencies: {}, devDependencies: {} }
  });
  const lockFile = fullstackNestPrismaProfile.createTemplate().find(file =>
    file.path === 'package-lock.json'
  );
  assert.ok(lockFile);
  const lock = JSON.parse(lockFile.content) as {
    lockfileVersion: number;
    packages: Record<string, {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>;
  };

  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages['']?.dependencies, packageJson.dependencies);
  assert.deepEqual(lock.packages['']?.devDependencies, packageJson.devDependencies);
});

test('full-stack Profile validates its complete server-owned baseline', () => {
  const packageJson = fullstackNestPrismaProfile.mergePackageJson({
    generated: { dependencies: {}, devDependencies: {} }
  });
  const files = [
    ...fullstackNestPrismaProfile.createTemplate(),
    {
      path: 'package.json',
      language: 'json' as const,
      content: `${JSON.stringify(packageJson, null, 2)}\n`
    }
  ];
  assert.deepEqual(fullstackNestPrismaProfile.validateStructure(files), {
    status: 'passed',
    stdout: 'Full-stack project structure is valid',
    stderr: ''
  });

  const withoutHealth = files.filter(file =>
    file.path !== 'apps/api/src/platform/health/health.controller.ts'
  );
  assert.match(
    fullstackNestPrismaProfile.validateStructure(withoutHealth).stderr,
    /health\.controller/
  );
});

test('full-stack fake generation produces a valid Todo candidate without platform edits', async () => {
  const baseFiles = fullstackNestPrismaProfile.createTemplate();
  const platformMain = baseFiles.find(file => file.path === 'apps/api/src/main.ts')!;
  const result = await runAgentGeneration({
    context: {
      prompt: 'Build a Todo app',
      mode: 'create',
      project: {
        name: 'Todos',
        profile: { ...FULLSTACK_NEST_PRISMA_PROFILE_REF },
        capabilities: [...fullstackNestPrismaProfile.generationDescriptor().capabilities],
        editablePaths: [
          ...fullstackNestPrismaProfile.editablePathPolicy().editablePathPatterns
        ],
        platformManagedPaths: [
          ...fullstackNestPrismaProfile.editablePathPolicy().platformManagedPathPatterns
        ],
        generationInstructions:
          fullstackNestPrismaProfile.generationDescriptor().instructions
      },
      messages: [],
      files: baseFiles.map(file => ({ path: file.path, content: file.content }))
    },
    profile: { ...FULLSTACK_NEST_PRISMA_PROFILE_REF },
    baseFiles,
    modelClient: createFakeModelClient(),
    onEvent: () => undefined
  });

  assert.equal(
    result.files.find(file => file.path === 'apps/api/src/main.ts')?.content,
    platformMain.content
  );
  assert.ok(result.files.some(file =>
    file.path === 'apps/api/src/modules/todo/todo.controller.ts'
  ));
  assert.ok(result.files.some(file => file.path.endsWith('/migration.sql')));
  assert.equal(result.packageJson.dependencies['@nestjs/core'], '^10.4.0');
  assert.equal(
    fullstackNestPrismaProfile.validateStructure(result.files).status,
    'passed'
  );
});
