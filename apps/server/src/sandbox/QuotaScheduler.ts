import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import {
  SandboxLease,
  type SandboxLeaseDocument,
  type SandboxReservationRecord
} from '../models/SandboxLease';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import { SandboxError } from './errors';
import { SandboxRepository } from './SandboxRepository';
import type { ResourceProfile, SandboxPurpose } from './types';
import { WorkspaceQuotaLock } from './WorkspaceQuotaLock';

export const OCCUPYING_SANDBOX_STATES = [
  'reserved',
  'provisioning',
  'ready',
  'running',
  'terminating'
] as const;

export interface SandboxReservationRequest {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  branchId: Types.ObjectId;
  requestedByUserId: Types.ObjectId;
  runId?: Types.ObjectId;
  snapshotId?: Types.ObjectId;
  sourceArtifact: {
    artifactId: string;
    kind: 'project_snapshot' | 'validation_candidate';
  };
  purpose: SandboxPurpose;
  provider: string;
  provisioningKey: string;
  spec: SandboxReservationRecord['spec'];
  resourceProfile: ResourceProfile;
  expiresAt: Date;
}

export class QuotaScheduler {
  constructor(
    private readonly lock: WorkspaceQuotaLock,
    private readonly repository: SandboxRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  reserve(
    request: SandboxReservationRequest
  ): Promise<SandboxLeaseDocument> {
    return this.lock.withLock(request.workspaceId, async (guard) => {
      this.assertRequestShape(request);
      const record = this.record(request);

      const [workspace, project, branch, membership] = await Promise.all([
        Workspace.findById(request.workspaceId).lean(),
        Project.findById(request.projectId).lean(),
        ProjectBranch.findById(request.branchId).lean(),
        WorkspaceMember.findOne({
          workspaceId: request.workspaceId,
          userId: request.requestedByUserId
        }).lean()
      ]);
      if (
        !workspace ||
        workspace.status !== 'active' ||
        !project ||
        project.workspaceId?.toString() !== request.workspaceId.toString() ||
        !branch ||
        branch.status !== 'active' ||
        branch.workspaceId.toString() !== request.workspaceId.toString() ||
        branch.projectId.toString() !== request.projectId.toString() ||
        (!membership &&
          project.userId.toString() !== request.requestedByUserId.toString())
      ) {
        throw new SandboxError(
          'SANDBOX_POLICY_DENIED',
          'Sandbox reservation scope is not accessible'
        );
      }

      const existing = await this.repository.findByProvisioningKey(
        request.provisioningKey
      );
      if (existing) return this.repository.createReserved(record);

      if (request.purpose === 'build') {
        const busy = await SandboxLease.exists({
          branchId: request.branchId,
          purpose: 'build',
          state: { $in: OCCUPYING_SANDBOX_STATES }
        });
        if (busy) {
          throw new SandboxError(
            'SANDBOX_BRANCH_BUSY',
            'Branch already has an active Build Sandbox'
          );
        }
      }

      const [projectCount, workspaceUsage] = await Promise.all([
        SandboxLease.countDocuments({
          projectId: request.projectId,
          purpose: request.purpose,
          state: { $in: OCCUPYING_SANDBOX_STATES }
        }),
        SandboxLease.aggregate<{
          builds: number;
          previews: number;
          cpu: number;
          memoryMiB: number;
          diskMiB: number;
        }>([
          {
            $match: {
              workspaceId: request.workspaceId,
              state: { $in: OCCUPYING_SANDBOX_STATES }
            }
          },
          {
            $group: {
              _id: null,
              builds: {
                $sum: { $cond: [{ $eq: ['$purpose', 'build'] }, 1, 0] }
              },
              previews: {
                $sum: { $cond: [{ $eq: ['$purpose', 'preview'] }, 1, 0] }
              },
              cpu: { $sum: '$resourceProfile.cpu' },
              memoryMiB: { $sum: '$resourceProfile.memoryMiB' },
              diskMiB: { $sum: '$resourceProfile.diskMiB' }
            }
          }
        ]).then((rows) => rows[0] ?? {
          builds: 0,
          previews: 0,
          cpu: 0,
          memoryMiB: 0,
          diskMiB: 0
        })
      ]);

      const projectLimit =
        request.purpose === 'build'
          ? project.sandboxLimits.maxConcurrentBuilds
          : project.sandboxLimits.maxRunningPreviews;
      const workspaceCount =
        request.purpose === 'build'
          ? workspaceUsage.builds
          : workspaceUsage.previews;
      const workspaceLimit =
        request.purpose === 'build'
          ? workspace.executionLimits.maxConcurrentBuilds
          : workspace.executionLimits.maxRunningPreviews;
      if (
        projectCount + 1 > projectLimit ||
        workspaceCount + 1 > workspaceLimit ||
        workspaceUsage.cpu + request.resourceProfile.cpu >
          workspace.executionLimits.maxCpu ||
        workspaceUsage.memoryMiB + request.resourceProfile.memoryMiB >
          workspace.executionLimits.maxMemoryMiB ||
        workspaceUsage.diskMiB + request.resourceProfile.diskMiB >
          workspace.executionLimits.maxDiskMiB
      ) {
        throw new SandboxError(
          'SANDBOX_QUOTA_EXCEEDED',
          'Sandbox reservation exceeds configured quota'
        );
      }

      await guard.assertHeld();
      try {
        return await this.repository.createReserved(record);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 11000
        ) {
          throw new SandboxError(
            'SANDBOX_BRANCH_BUSY',
            'Branch already has an active Build Sandbox'
          );
        }
        throw error;
      }
    });
  }

  private record(
    request: SandboxReservationRequest
  ): SandboxReservationRecord {
    return {
      ...request,
      reservedAt: this.now()
    };
  }

  private assertRequestShape(request: SandboxReservationRequest): void {
    if (
      (request.purpose === 'build' && !request.runId) ||
      (request.purpose === 'preview' &&
        (!request.snapshotId ||
          request.sourceArtifact.kind !== 'project_snapshot'))
    ) {
      throw new SandboxError(
        'SANDBOX_POLICY_DENIED',
        'Sandbox reservation does not match its purpose'
      );
    }
  }
}
