import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { SandboxLease, type SandboxReservationRecord } from '../models/SandboxLease';
import { createIntegrationEnvironment, type IntegrationEnvironment } from '../testing/integrationEnvironment';
import { SandboxReconciler } from './SandboxReconciler';
import { SandboxRepository } from './SandboxRepository';
import type { SandboxService } from './SandboxService';
import {
  FakeSandboxProvider,
  FakeSandboxState
} from './providers/FakeSandboxProvider';
import type { SandboxSpec } from './types';

let environment: IntegrationEnvironment;
before(async () => {
  environment = await createIntegrationEnvironment();
  await SandboxLease.syncIndexes();
});
beforeEach(async () => environment.reset());
after(async () => environment.close());

const record = (
  overrides: Partial<SandboxReservationRecord> = {}
): SandboxReservationRecord => {
  const now = new Date();
  return {
    workspaceId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    requestedByUserId: new Types.ObjectId(),
    runId: new Types.ObjectId(),
    sourceArtifact: {
      artifactId: 'a'.repeat(32),
      kind: 'validation_candidate'
    },
    purpose: 'build',
    provider: 'fake',
    provisioningKey: `sandbox:${crypto.randomUUID()}`,
    spec: {
      image: 'node:22',
      workingDirectory: '/workspace',
      networkPolicy: {
        defaultAction: 'allow',
        allowedDomains: [],
        allowedCidrs: []
      },
      leaseSeconds: 900,
      autoDeleteSeconds: 1_800
    },
    resourceProfile: { cpu: 1, memoryMiB: 1_024, diskMiB: 2_048 },
    reservedAt: now,
    expiresAt: new Date(now.getTime() + 900_000),
    ...overrides
  };
};

const specFor = (value: SandboxReservationRecord): SandboxSpec => ({
  provisioningKey: value.provisioningKey,
  ownership: {
    workspaceId: value.workspaceId.toString(),
    projectId: value.projectId.toString(),
    branchId: value.branchId.toString(),
    runId: value.runId?.toString(),
    purpose: value.purpose
  },
  runtime: {
    image: value.spec.image,
    workingDirectory: value.spec.workingDirectory
  },
  resources: value.resourceProfile,
  networkPolicy: value.spec.networkPolicy,
  lifecycle: {
    leaseSeconds: value.spec.leaseSeconds,
    autoDeleteSeconds: value.spec.autoDeleteSeconds
  },
  labels: {
    'managed-by': 'open-v0',
    workspaceId: value.workspaceId.toString(),
    projectId: value.projectId.toString(),
    branchId: value.branchId.toString(),
    purpose: value.purpose
  }
});

const harness = () => {
  const repository = new SandboxRepository();
  const state = new FakeSandboxState();
  const provider = new FakeSandboxProvider(state);
  const service = {
    resumeProvisioning: async (leaseId: Types.ObjectId) =>
      (await repository.transition({
        leaseId,
        from: ['provisioning'],
        to: 'ready',
        set: { readyAt: new Date() }
      })) ?? repository.findById(leaseId),
    terminate: async ({ leaseId }: { leaseId: Types.ObjectId }) => {
      let lease = await repository.findById(leaseId);
      if (!lease) throw new Error('missing');
      if (lease.state !== 'terminating') {
        lease =
          (await repository.transition({
            leaseId,
            from: [lease.state],
            to: 'terminating'
          })) ?? lease;
      }
      if (lease.externalId) {
        const receipt = await provider.destroy({
          provider: lease.provider,
          externalId: lease.externalId
        });
        if (receipt.pending) return lease;
      }
      return (
        (await repository.transition({
          leaseId,
          from: ['terminating'],
          to: 'terminated',
          set: { terminatedAt: new Date() }
        })) ?? lease
      );
    }
  } as unknown as SandboxService;
  return {
    repository,
    state,
    provider,
    reconciler: new SandboxReconciler({
      repository,
      service,
      providers: new Map([['fake', provider]]),
      orphanGraceMs: 1_000,
      now: () => new Date()
    })
  };
};

test('SandboxReconciler fails expired reservations once', async () => {
  const { repository, reconciler } = harness();
  const lease = await repository.createReserved(
    record({ expiresAt: new Date(Date.now() - 1) })
  );
  const first = await reconciler.reconcile();
  const second = await reconciler.reconcile();

  assert.equal(first.failedReservations, 1);
  assert.equal(second.failedReservations, 0);
  assert.equal(second.terminated, 1);
  assert.equal((await repository.findById(lease._id))?.state, 'terminated');
});

test('SandboxReconciler creates, binds, and resumes provisioning', async () => {
  const { repository, state, reconciler } = harness();
  const input = record();
  const lease = await repository.createReserved(input);
  await repository.transition({
    leaseId: lease._id,
    from: ['reserved'],
    to: 'provisioning'
  });

  const result = await reconciler.reconcile();
  const current = await repository.findById(lease._id);
  assert.equal(result.resumedProvisioning, 1);
  assert.equal(current?.state, 'ready');
  assert.equal(current?.externalId, state.resources()[0].ref.externalId);
});

test('SandboxReconciler marks missing running resources lost', async () => {
  const { repository, state, provider, reconciler } = harness();
  const input = record();
  const lease = await repository.createReserved(input);
  const ref = await provider.create(specFor(input));
  await repository.transition({
    leaseId: lease._id,
    from: ['reserved'],
    to: 'provisioning'
  });
  await repository.bindExternalId({
    leaseId: lease._id,
    provider: ref.provider,
    externalId: ref.externalId
  });
  await repository.transition({
    leaseId: lease._id,
    from: ['provisioning'],
    to: 'ready'
  });
  await repository.transition({
    leaseId: lease._id,
    from: ['ready'],
    to: 'running'
  });
  state.setMissing(ref);

  assert.equal((await reconciler.reconcile()).lost, 1);
  assert.equal((await repository.findById(lease._id))?.state, 'lost');
});

test('SandboxReconciler destroys old managed orphans with valid labels', async () => {
  const { state, reconciler } = harness();
  state.seedDuplicate(specFor(record()));

  assert.equal((await reconciler.reconcile()).destroyedOrphans, 1);
  assert.equal(state.resources()[0].status, 'missing');
});
