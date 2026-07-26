import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { createIntegrationEnvironment, type IntegrationEnvironment } from '../testing/integrationEnvironment';
import { SandboxLease, type SandboxReservationRecord } from '../models/SandboxLease';
import { SandboxRepository } from './SandboxRepository';

let environment: IntegrationEnvironment;
const repository = new SandboxRepository();

const reservation = (
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

before(async () => {
  environment = await createIntegrationEnvironment();
  await SandboxLease.syncIndexes();
});
beforeEach(async () => environment.reset());
after(async () => environment.close());

test('SandboxRepository creates and finds a reserved lease', async () => {
  const input = reservation();
  const lease = await repository.createReserved(input);

  assert.equal(lease.state, 'reserved');
  assert.equal(
    (await repository.findByProvisioningKey(input.provisioningKey))?.id,
    lease.id
  );
});

test('SandboxRepository performs state transitions with compare-and-set', async () => {
  const lease = await repository.createReserved(reservation());
  const provisioning = await repository.transition({
    leaseId: lease._id,
    from: ['reserved'],
    to: 'provisioning'
  });
  assert.equal(provisioning?.state, 'provisioning');
  assert.equal(
    await repository.transition({
      leaseId: lease._id,
      from: ['reserved'],
      to: 'provisioning'
    }),
    null
  );
  const ready = await repository.transition({
    leaseId: lease._id,
    from: ['provisioning'],
    to: 'ready',
    set: { readyAt: new Date() }
  });
  const running = await repository.transition({
    leaseId: lease._id,
    from: ['ready'],
    to: 'running'
  });
  assert.equal(ready?.state, 'ready');
  assert.equal(running?.state, 'running');
});

test('SandboxRepository rejects invalid programmer transitions', async () => {
  const lease = await repository.createReserved(reservation());
  await assert.rejects(
    repository.transition({
      leaseId: lease._id,
      from: ['reserved'],
      to: 'running'
    }),
    /SANDBOX_INVALID_STATE/
  );
});

test('SandboxRepository binds one external id', async () => {
  const lease = await repository.createReserved(reservation());
  assert.equal(
    (
      await repository.bindExternalId({
        leaseId: lease._id,
        provider: 'fake',
        externalId: 'resource-1'
      })
    )?.externalId,
    'resource-1'
  );
  assert.equal(
    await repository.bindExternalId({
      leaseId: lease._id,
      provider: 'fake',
      externalId: 'resource-2'
    }),
    null
  );
});

test('SandboxRepository reuses an exact provisioning request', async () => {
  const input = reservation();
  const first = await repository.createReserved(input);
  const second = await repository.createReserved({
    ...input,
    reservedAt: new Date(input.reservedAt.getTime() + 1_000),
    expiresAt: new Date(input.expiresAt.getTime() + 1_000)
  });

  assert.equal(second.id, first.id);
  assert.equal(await SandboxLease.countDocuments(), 1);
  await assert.rejects(
    repository.createReserved({
      ...input,
      branchId: new Types.ObjectId()
    }),
    /SANDBOX_OWNERSHIP_MISMATCH/
  );
});

test('SandboxRepository keeps terminal leases terminal', async () => {
  const lease = await repository.createReserved(reservation());
  await repository.transition({
    leaseId: lease._id,
    from: ['reserved'],
    to: 'failed'
  });
  await assert.rejects(
    repository.transition({
      leaseId: lease._id,
      from: ['failed'],
      to: 'ready'
    }),
    /SANDBOX_INVALID_STATE/
  );
});
