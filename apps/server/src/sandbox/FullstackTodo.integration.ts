import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getAgentConfig } from '../agent/config';
import { runAgentGeneration } from '../agent/orchestrator';
import {
  FULLSTACK_NEST_PRISMA_PROFILE_REF,
  fullstackNestPrismaProfile
} from '../agent/profiles/fullstackNestPrismaProfile';
import { createFakeModelClient } from '../agent/testing/fakeModelClient';
import { TestcontainersValidationDatabase } from '../agent/validation/testcontainersDatabase';
import { createProjectValidator } from '../agent/validator';

test('full-stack Todo candidate replays migrations and passes CRUD validation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fullstack-todo-validation-'));
  const database = new TestcontainersValidationDatabase({ ttlMs: 5 * 60_000 });
  try {
    const baseFiles = fullstackNestPrismaProfile.createTemplate();
    const candidate = await runAgentGeneration({
      context: {
        prompt: 'Build a Todo app',
        mode: 'create',
        project: {
          name: 'Todos',
          profile: { ...FULLSTACK_NEST_PRISMA_PROFILE_REF },
          capabilities: [
            ...fullstackNestPrismaProfile.generationDescriptor().capabilities
          ],
          editablePaths: [
            ...fullstackNestPrismaProfile.editablePathPolicy().editablePathPatterns
          ],
          platformManagedPaths: [
            ...fullstackNestPrismaProfile
              .editablePathPolicy().platformManagedPathPatterns
          ],
          generationInstructions:
            fullstackNestPrismaProfile.generationDescriptor().instructions
        },
        messages: [],
        files: baseFiles.map(file => ({
          path: file.path,
          content: file.content
        }))
      },
      profile: FULLSTACK_NEST_PRISMA_PROFILE_REF,
      baseFiles,
      modelClient: createFakeModelClient(),
      onEvent: () => undefined
    });
    const workspaceRoot = path.join(root, 'workspaces');
    const validation = getAgentConfig({
      AGENT_VALIDATION_NPM_CACHE_ROOT:
        process.env.npm_config_cache ?? path.join(homedir(), '.npm'),
      AGENT_VALIDATION_DEPENDENCY_CACHE_ROOT:
        path.join(workspaceRoot, '.dependency-cache'),
      AGENT_VALIDATION_INSTALL_TIMEOUT_MS: '300000',
      AGENT_VALIDATION_TYPE_CHECK_TIMEOUT_MS: '180000',
      AGENT_VALIDATION_BUILD_TIMEOUT_MS: '180000'
    }).validation;
    const validator = createProjectValidator({
      workspaceRoot,
      validation,
      env: {
        ...process.env,
        NPM_CONFIG_PREFER_OFFLINE: 'true'
      },
      validationDatabase: database
    });

    const result = await validator.validate({
      runId: 'fullstack-todo',
      profile: FULLSTACK_NEST_PRISMA_PROFILE_REF,
      files: candidate.files
    });

    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.deepEqual(result.checks.map(check => check.name), [
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
    ]);
    assert.equal(JSON.stringify(result).includes('postgresql://'), false);
  } finally {
    await database.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
