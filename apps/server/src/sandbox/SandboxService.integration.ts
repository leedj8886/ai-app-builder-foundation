import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import type { ArtifactService } from '../artifacts/artifactService';
import type { ProjectArtifactBundleV1 } from '../artifacts/types';
import { SandboxLease } from '../models/SandboxLease';
import { Workspace } from '../models/Workspace';
import { createIntegrationEnvironment, type IntegrationEnvironment } from '../testing/integrationEnvironment';
import { getSandboxConfig } from './config';
import { createSandboxPolicy } from './policy';
import type { QuotaScheduler, SandboxReservationRequest } from './QuotaScheduler';
import { SandboxRepository } from './SandboxRepository';
import { SandboxService, type CreateBuildSandboxInput } from './SandboxService';
import {
  FakeSandboxProvider,
  FakeSandboxState
} from './providers/FakeSandboxProvider';

let environment: IntegrationEnvironment;
before(async () => {
  environment = await createIntegrationEnvironment();
  await SandboxLease.syncIndexes();
});
beforeEach(async () => environment.reset());
after(async () => environment.close());

const bundle: ProjectArtifactBundleV1 = {
  version: 1,
  files: [
    { path: 'src/App.tsx', content: 'export default 1;', language: 'tsx' },
    { path: 'package.json', content: '{"unsafe":true}', language: 'json' }
  ],
  packageJson: {
    dependencies: { react: '^18.0.0' },
    devDependencies: {},
    scripts: { build: 'tsc' }
  }
};

const input = (): CreateBuildSandboxInput => ({
  workspaceId: new Types.ObjectId(),
  projectId: new Types.ObjectId(),
  branchId: new Types.ObjectId(),
  requestedByUserId: new Types.ObjectId(),
  runId: new Types.ObjectId(),
  sourceArtifact: {
    artifactId: 'a'.repeat(32),
    kind: 'validation_candidate'
  },
  provider: 'fake',
  image: 'node:22',
  attempt: 0,
  resources: { cpu: 1, memoryMiB: 1_024, diskMiB: 2_048 }
});

const harness = (
  artifact: ProjectArtifactBundleV1 = bundle
) => {
  const repository = new SandboxRepository();
  const state = new FakeSandboxState();
  const provider = new FakeSandboxProvider(state);
  const artifactService = {
    readOwnedBundle: async () => structuredClone(artifact)
  } as unknown as ArtifactService;
  const scheduler = {
    reserve: async (request: SandboxReservationRequest) =>
      repository.createReserved({
        ...request,
        reservedAt: new Date()
      })
  } as QuotaScheduler;
  const service = new SandboxService({
    artifactService,
    scheduler,
    repository,
    policy: createSandboxPolicy(getSandboxConfig({})),
    providers: new Map([['fake', provider]])
  });
  return { service, state, repository };
};

test('SandboxService provisions one ready Lease from an Artifact', async () => {
  const { service, state } = harness();
  const request = input();
  const first = await service.createBuildSandbox(request);
  const second = await service.createBuildSandbox(request);

  assert.equal(first.state, 'ready');
  assert.equal(second.id, first.id);
  assert.equal(state.resources().length, 1);
  const files = state.resources()[0].files;
  assert.equal(
    new TextDecoder().decode(files.get('src/App.tsx')),
    'export default 1;'
  );
  assert.equal(
    new TextDecoder().decode(files.get('package.json')),
    `${JSON.stringify(bundle.packageJson, null, 2)}\n`
  );
});

test('SandboxService marks known-not-created failures failed', async () => {
  const { service, state } = harness();
  state.failNextCreate({
    outcome: 'not-created',
    createResourceBeforeThrow: false
  });
  const request = input();

  await assert.rejects(
    service.createBuildSandbox(request),
    /SANDBOX_PROVISION_FAILED/
  );
  assert.equal(
    (await SandboxLease.findOne({
      provisioningKey: `build:${request.runId.toString()}:0`
    }).orFail()).state,
    'failed'
  );
});

test('SandboxService leaves unknown create outcomes for reconciliation', async () => {
  const { service, state } = harness();
  state.failNextCreate({
    outcome: 'unknown',
    createResourceBeforeThrow: true
  });
  const request = input();

  await assert.rejects(
    service.createBuildSandbox(request),
    /SANDBOX_PROVISION_FAILED/
  );
  assert.equal(
    (await SandboxLease.findOne({
      provisioningKey: `build:${request.runId.toString()}:0`
    }).orFail()).state,
    'provisioning'
  );
  assert.equal(state.resources().length, 1);
});

test('SandboxService rejects unavailable source before reserving capacity', async () => {
  const { service } = harness();
  const artifactService = {
    readOwnedBundle: async () => {
      throw new Error('missing');
    }
  } as unknown as ArtifactService;
  const failing = new SandboxService({
    artifactService,
    scheduler: {
      reserve: async () => {
        throw new Error('must not reserve');
      }
    } as unknown as QuotaScheduler,
    repository: new SandboxRepository(),
    policy: createSandboxPolicy(getSandboxConfig({})),
    providers: new Map([
      ['fake', new FakeSandboxProvider(new FakeSandboxState())]
    ])
  });

  await assert.rejects(
    failing.createBuildSandbox(input()),
    /SANDBOX_SOURCE_UNAVAILABLE/
  );
  assert.equal(await SandboxLease.countDocuments(), 0);
  void service;
});

test('SandboxService executes only policy-built commands and enters running', async () => {
  const withLockfile: ProjectArtifactBundleV1 = {
    ...bundle,
    files: [
      ...bundle.files,
      { path: 'package-lock.json', content: '{}', language: 'json' }
    ]
  };
  const { service, state } = harness(withLockfile);
  const request = input();
  await Workspace.create({
    _id: request.workspaceId,
    slug: `command-${crypto.randomUUID()}`,
    name: 'Command Workspace',
    createdByUserId: request.requestedByUserId
  });
  const lease = await service.createBuildSandbox(request);
  const ownership = {
    workspaceId: request.workspaceId.toString(),
    projectId: request.projectId.toString(),
    branchId: request.branchId.toString(),
    runId: request.runId.toString(),
    purpose: 'build' as const
  };
  const result = await service.runBuildCommand({
    leaseId: lease._id,
    expectedOwnership: ownership,
    command: 'install'
  });

  assert.equal(result.exitCode, 0);
  assert.equal((await SandboxLease.findById(lease._id).orFail()).state, 'running');
  assert.deepEqual(state.resources()[0].commands[0].args, ['ci']);

  state.setNextCommandResult({
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: 100,
    timedOut: true,
    outputTruncated: false
  });
  await assert.rejects(
    service.runBuildCommand({
      leaseId: lease._id,
      expectedOwnership: ownership,
      command: 'build'
    }),
    /SANDBOX_COMMAND_TIMEOUT/
  );
});

test('SandboxService termination is ownership-safe and idempotent', async () => {
  const { service, state } = harness();
  const request = input();
  const lease = await service.createBuildSandbox(request);
  const ownership = {
    workspaceId: request.workspaceId.toString(),
    projectId: request.projectId.toString(),
    branchId: request.branchId.toString(),
    runId: request.runId.toString(),
    purpose: 'build' as const
  };
  await assert.rejects(
    service.terminate({
      leaseId: lease._id,
      expectedOwnership: { ...ownership, branchId: new Types.ObjectId().toString() }
    }),
    /SANDBOX_OWNERSHIP_MISMATCH/
  );

  const ref = state.resources()[0].ref;
  state.delayDestroy(ref, 1);
  assert.equal(
    (await service.terminate({ leaseId: lease._id, expectedOwnership: ownership }))
      .state,
    'terminating'
  );
  state.advanceDestroy(ref);
  const terminated = await service.terminate({
    leaseId: lease._id,
    expectedOwnership: ownership
  });
  assert.equal(terminated.state, 'terminated');
  assert.equal(
    (
      await service.terminate({
        leaseId: lease._id,
        expectedOwnership: ownership
      })
    ).state,
    'terminated'
  );
});
