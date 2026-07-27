import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { AgentRun } from '../models/AgentRun';
import { ArtifactManifest } from '../models/ArtifactManifest';
import { Project } from '../models/Project';
import { SandboxLease } from '../models/SandboxLease';
import { User } from '../models/User';
import { ensureMainBranch } from '../branches/branchService';
import { getArtifactService } from '../artifacts/runtime';
import { createProjectTemplateFiles } from '../agent/projectTemplate';
import { mergeProjectPackageJson } from '../agent/dependencies';
import { createSandboxProjectValidator } from '../agent/sandboxValidator';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';
import { createSandboxRuntime } from './runtime';
import type { SandboxCommandResult } from './types';

let environment: IntegrationEnvironment;

before(async () => {
  environment = await createIntegrationEnvironment();
  await Promise.all([
    ArtifactManifest.syncIndexes(),
    SandboxLease.syncIndexes()
  ]);
});
beforeEach(async () => environment.reset());
after(async () => environment.close());

const commandResult = (
  exitCode: number,
  stderr = ''
): SandboxCommandResult => ({
  exitCode,
  stdout: '',
  stderr,
  durationMs: 5,
  timedOut: false,
  outputTruncated: false
});

const fixture = async () => {
  const user = await User.create({
    email: `sandbox-validator-${crypto.randomUUID()}@example.test`,
    password: 'password',
    name: 'Sandbox validator owner'
  });
  const { workspace } = await ensureDefaultWorkspaceForUser(user._id);
  const project = await Project.create({
    workspaceId: workspace._id,
    userId: user._id,
    name: 'Sandbox validation project'
  });
  const branch = await ensureMainBranch(project);
  const run = await AgentRun.create({
    userId: user._id,
    workspaceId: workspace._id,
    projectId: project._id,
    branchId: branch._id,
    prompt: 'Build an app',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'fake-model'
  });
  const runtime = await createSandboxRuntime({
    redis: environment.redis,
    env: {
      NODE_ENV: 'test',
      SANDBOX_PROVIDER: 'fake'
    },
    artifactService: getArtifactService()
  });
  const validator = createSandboxProjectValidator({
    service: runtime.service,
    artifactService: getArtifactService(),
    provider: runtime.provider,
    image: runtime.image,
    resources: { cpu: 1, memoryMiB: 1_024, diskMiB: 2_048 },
    verification: runtime.verification
  });
  const scope = {
    workspaceId: workspace._id,
    projectId: project._id,
    branchId: branch._id,
    requestedByUserId: user._id,
    runId: run._id,
    attempt: 0
  };
  const packageJson = mergeProjectPackageJson(undefined, {
    dependencies: {},
    devDependencies: {}
  });
  return {
    files: [
      ...createProjectTemplateFiles(),
      {
        path: 'package.json' as const,
        language: 'json' as const,
        content: `${JSON.stringify(packageJson, null, 2)}\n`
      }
    ],
    runtime,
    scope,
    validator
  };
};

test('Sandbox validator hydrates an Artifact and runs the complete command sequence', async () => {
  const { files, runtime, scope, validator } = await fixture();
  const progress: string[] = [];

  const result = await validator.validate({
    runId: `${scope.runId.toString()}-0`,
    files,
    sandboxScope: scope,
    onProgress: (event) => {
      progress.push(`${event.phase}:${event.status}`);
    }
  });

  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.verification, 'simulated');
  assert.deepEqual(
    result.checks.map((check) => check.name),
    ['structure', 'install', 'type-check', 'build']
  );
  assert.deepEqual(progress, [
    'structure:passed',
    'dependencies:passed',
    'type-check:passed',
    'build:passed'
  ]);

  const resources = runtime.fakeState!.resources();
  assert.equal(resources.length, 1);
  assert.equal(resources[0].status, 'missing');
  assert.ok(resources[0].files.has('src/App.tsx'));
  assert.deepEqual(
    resources[0].commands.map((command) => command.args),
    [['install'], ['run', 'type-check'], ['run', 'build']]
  );
  assert.equal(
    (await SandboxLease.findOne({
      runId: scope.runId,
      provisioningKey: `build:${scope.runId.toString()}:0`
    }).orFail()).state,
    'terminated'
  );
  assert.ok(await ArtifactManifest.exists({
    idempotencyKey:
      `sandbox-validation:${scope.runId.toString()}:0`,
    state: 'ready'
  }));
});

test('Sandbox validator terminates a failed Lease and recovers with a new attempt', async () => {
  const { files, runtime, scope, validator } = await fixture();
  runtime.fakeState!.enqueueCommandResult(commandResult(0));
  runtime.fakeState!.enqueueCommandResult(
    commandResult(1, 'src/App.tsx: type error')
  );

  const failed = await validator.validate({
    runId: `${scope.runId.toString()}-0`,
    files,
    sandboxScope: scope
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.verification, 'simulated');
  assert.equal(failed.category, 'CODE_ERROR');
  assert.deepEqual(
    failed.checks.map((check) => check.name),
    ['structure', 'install', 'type-check']
  );

  const recovered = await validator.validate({
    runId: `${scope.runId.toString()}-1`,
    files,
    sandboxScope: { ...scope, attempt: 1 }
  });
  assert.equal(recovered.status, 'passed');
  assert.equal(recovered.verification, 'simulated');

  const resources = runtime.fakeState!.resources();
  assert.equal(resources.length, 2);
  assert.deepEqual(
    resources.map((resource) => resource.status),
    ['missing', 'missing']
  );
  assert.deepEqual(
    resources.map((resource) => resource.commands.length),
    [2, 3]
  );
  assert.deepEqual(
    await SandboxLease.find({ runId: scope.runId })
      .sort({ provisioningKey: 1 })
      .distinct('state'),
    ['terminated']
  );
});
