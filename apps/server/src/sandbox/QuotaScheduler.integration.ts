import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import { SandboxLease } from '../models/SandboxLease';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import { createIntegrationEnvironment, type IntegrationEnvironment } from '../testing/integrationEnvironment';
import { QuotaScheduler, type SandboxReservationRequest } from './QuotaScheduler';
import { SandboxRepository } from './SandboxRepository';
import { WorkspaceQuotaLock } from './WorkspaceQuotaLock';

let environment: IntegrationEnvironment | undefined;
before(async () => {
  environment = await createIntegrationEnvironment();
  await SandboxLease.syncIndexes();
});
beforeEach(async () => environment!.reset());
after(async () => environment?.close());

const setup = async (limits: { maxCpu?: number } = {}) => {
  const userId = new Types.ObjectId();
  const workspace = await Workspace.create({
    slug: `workspace-${crypto.randomUUID()}`,
    name: 'Workspace',
    createdByUserId: userId,
    executionLimits: { maxCpu: limits.maxCpu ?? 32 }
  });
  const project = await Project.create({
    workspaceId: workspace._id,
    userId,
    name: 'Project'
  });
  const branch = await ProjectBranch.create({
    workspaceId: workspace._id,
    projectId: project._id,
    name: 'main'
  });
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId,
    role: 'owner'
  });
  const scheduler = new QuotaScheduler(
    new WorkspaceQuotaLock({
      redis: environment!.redis,
      ttlMs: 1_000,
      waitMs: 200
    }),
    new SandboxRepository()
  );
  const request: SandboxReservationRequest = {
    workspaceId: workspace._id,
    projectId: project._id,
    branchId: branch._id,
    requestedByUserId: userId,
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
    expiresAt: new Date(Date.now() + 900_000)
  };
  return { scheduler, request };
};

test('QuotaScheduler converges same-key reservations and enforces Branch exclusivity', async () => {
  const { scheduler, request } = await setup();
  const [first, second] = await Promise.all([
    scheduler.reserve(request),
    scheduler.reserve(request)
  ]);
  assert.equal(first.id, second.id);
  assert.equal(await SandboxLease.countDocuments(), 1);

  await assert.rejects(
    scheduler.reserve({
      ...request,
      runId: new Types.ObjectId(),
      provisioningKey: `sandbox:${crypto.randomUUID()}`
    }),
    /SANDBOX_BRANCH_BUSY/
  );
});

test('QuotaScheduler enforces Workspace resources and creates no rejected Lease', async () => {
  const { scheduler, request } = await setup({ maxCpu: 1 });
  await assert.rejects(
    scheduler.reserve({
      ...request,
      resourceProfile: { ...request.resourceProfile, cpu: 2 }
    }),
    /SANDBOX_QUOTA_EXCEEDED/
  );
  assert.equal(await SandboxLease.countDocuments(), 0);
});
