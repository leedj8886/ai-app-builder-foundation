import { Types } from 'mongoose';
import { SandboxLease, type SandboxLeaseDocument } from '../models/SandboxLease';
import type { SandboxProvider } from './provider/SandboxProvider';
import { isSandboxError } from './errors';
import { SandboxRepository } from './SandboxRepository';
import type { SandboxService } from './SandboxService';
import type {
  SandboxInspection,
  SandboxOwnership,
  SandboxSpec
} from './types';

export const SANDBOX_RECONCILER_BATCH_SIZE = 100;

export interface SandboxReconcileResult {
  failedReservations: number;
  resumedProvisioning: number;
  lost: number;
  terminated: number;
  destroyedDuplicates: number;
  destroyedOrphans: number;
  errors: number;
}

interface SandboxReconcilerOptions {
  repository: SandboxRepository;
  service: SandboxService;
  providers: Map<string, SandboxProvider>;
  orphanGraceMs: number;
  now?: () => Date;
}

export class SandboxReconciler {
  private readonly now: () => Date;

  constructor(private readonly options: SandboxReconcilerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async reconcile(): Promise<SandboxReconcileResult> {
    const result: SandboxReconcileResult = {
      failedReservations: 0,
      resumedProvisioning: 0,
      lost: 0,
      terminated: 0,
      destroyedDuplicates: 0,
      destroyedOrphans: 0,
      errors: 0
    };
    const leases = await SandboxLease.find({
      state: { $ne: 'terminated' }
    })
      .sort({ _id: 1 })
      .limit(SANDBOX_RECONCILER_BATCH_SIZE)
      .exec();

    for (const lease of leases) {
      try {
        await this.reconcileLease(lease, result);
      } catch {
        // Provider and Artifact failures preserve durable state for a later run.
        result.errors += 1;
      }
    }
    for (const provider of this.options.providers.values()) {
      await this.reconcileOrphans(provider, result).catch(() => {
        result.errors += 1;
      });
    }
    return result;
  }

  private async reconcileLease(
    lease: SandboxLeaseDocument,
    result: SandboxReconcileResult
  ): Promise<void> {
    const now = this.now();
    const expired = lease.expiresAt.getTime() <= now.getTime();
    if (lease.state === 'reserved' && expired) {
      const changed = await this.options.repository.transition({
        leaseId: lease._id,
        from: ['reserved'],
        to: 'failed',
        set: {
          error: {
            code: 'SANDBOX_PROVISION_FAILED',
            message: 'Sandbox reservation expired',
            retryable: true
          }
        }
      });
      if (changed) result.failedReservations += 1;
      return;
    }

    if (
      expired &&
      ['provisioning', 'ready', 'running', 'lost', 'failed'].includes(
        lease.state
      )
    ) {
      const terminated = await this.options.service.terminate({
        leaseId: lease._id,
        expectedOwnership: this.ownership(lease)
      });
      if (terminated.state === 'terminated') result.terminated += 1;
      return;
    }

    if (lease.state === 'provisioning') {
      await this.reconcileProvisioning(lease, result);
      return;
    }
    if (lease.state === 'ready' || lease.state === 'running') {
      if (!lease.externalId) return;
      const provider = this.options.providers.get(lease.provider);
      if (!provider) return;
      const ref = {
        provider: lease.provider,
        externalId: lease.externalId
      };
      const inspection = await this.inspect(provider, ref);
      if (!inspection || inspection.status === 'missing') {
        const changed = await this.options.repository.transition({
          leaseId: lease._id,
          from: [lease.state],
          to: 'lost'
        });
        if (changed) result.lost += 1;
      }
      return;
    }
    if (
      lease.state === 'failed' ||
      lease.state === 'lost' ||
      lease.state === 'terminating'
    ) {
      const terminated = await this.options.service.terminate({
        leaseId: lease._id,
        expectedOwnership: this.ownership(lease)
      });
      if (terminated.state === 'terminated') result.terminated += 1;
    }
  }

  private async reconcileProvisioning(
    lease: SandboxLeaseDocument,
    result: SandboxReconcileResult
  ): Promise<void> {
    const provider = this.options.providers.get(lease.provider);
    if (!provider) return;
    let externalId = lease.externalId;
    if (externalId) {
      const ref = {
        provider: lease.provider,
        externalId
      };
      const inspection = await this.inspect(provider, ref);
      if (!inspection || inspection.status === 'missing') {
        const cleared = await this.options.repository.clearExternalId({
          leaseId: lease._id,
          provider: lease.provider,
          externalId
        });
        if (!cleared) return;
        externalId = undefined;
      }
    }

    if (!externalId) {
      const spec = this.spec(lease);
      const refs = await provider.list({
        provisioningKey: lease.provisioningKey,
        labels: spec.labels
      });
      const inspections = (await Promise.all(
        refs.map(async (ref) => {
          const value = await this.inspect(provider, ref);
          return value && value.status !== 'missing'
            ? { ref, value }
            : undefined;
        })
      )).filter(
        (entry): entry is NonNullable<typeof entry> => entry !== undefined
      );
      inspections.sort(
        (left, right) =>
          left.value.createdAt.getTime() - right.value.createdAt.getTime() ||
          left.ref.externalId.localeCompare(right.ref.externalId)
      );
      let retained = inspections[0]?.ref;
      if (!retained) retained = await provider.create(spec);
      for (const duplicate of inspections.slice(1)) {
        const receipt = await provider.destroy(duplicate.ref);
        if (!receipt.pending) result.destroyedDuplicates += 1;
      }
      const bound = await this.options.repository.bindExternalId({
        leaseId: lease._id,
        provider: retained.provider,
        externalId: retained.externalId
      });
      externalId = bound?.externalId ?? (await this.options.repository.findById(lease._id))?.externalId;
      if (!externalId) return;
    }

    const before = await this.options.repository.findById(lease._id);
    if (!before || before.state !== 'provisioning') return;
    const claimed = await this.options.repository.claimProvisioning(
      lease._id,
      before.updatedAt,
      this.now()
    );
    if (!claimed) return;
    const resumed = await this.options.service.resumeProvisioning(lease._id);
    if (resumed.state === 'ready') {
      result.resumedProvisioning += 1;
    }
  }

  private async reconcileOrphans(
    provider: SandboxProvider,
    result: SandboxReconcileResult
  ): Promise<void> {
    const refs = await provider.list({
      labels: { 'managed-by': 'open-v0' }
    });
    const cutoff = this.now().getTime() - this.options.orphanGraceMs;
    for (const ref of refs.slice(0, SANDBOX_RECONCILER_BATCH_SIZE)) {
      const inspection = await this.inspect(provider, ref);
      if (
        !inspection ||
        inspection.status === 'missing' ||
        inspection.createdAt.getTime() > cutoff ||
        !this.validOwnershipLabels(inspection.labels) ||
        (await this.options.repository.findByProviderRef(
          ref.provider,
          ref.externalId
        ))
      ) {
        continue;
      }
      const receipt = await provider.destroy(ref);
      if (!receipt.pending) result.destroyedOrphans += 1;
    }
  }

  private spec(lease: SandboxLeaseDocument): SandboxSpec {
    return {
      provisioningKey: lease.provisioningKey,
      ownership: this.ownership(lease),
      runtime: {
        image: lease.spec.image,
        workingDirectory: lease.spec.workingDirectory
      },
      resources: { ...lease.resourceProfile },
      networkPolicy: {
        defaultAction: lease.spec.networkPolicy.defaultAction,
        allowedDomains: [...lease.spec.networkPolicy.allowedDomains],
        allowedCidrs: [...lease.spec.networkPolicy.allowedCidrs]
      },
      lifecycle: {
        leaseSeconds: lease.spec.leaseSeconds,
        autoStopSeconds: lease.spec.autoStopSeconds,
        autoDeleteSeconds: lease.spec.autoDeleteSeconds
      },
      labels: {
        'managed-by': 'open-v0',
        workspaceId: lease.workspaceId.toString(),
        projectId: lease.projectId.toString(),
        branchId: lease.branchId.toString(),
        purpose: lease.purpose
      }
    };
  }

  private ownership(lease: SandboxLeaseDocument): SandboxOwnership {
    return {
      workspaceId: lease.workspaceId.toString(),
      projectId: lease.projectId.toString(),
      branchId: lease.branchId.toString(),
      runId: lease.runId?.toString(),
      snapshotId: lease.snapshotId?.toString(),
      purpose: lease.purpose
    };
  }

  private validOwnershipLabels(labels: Record<string, string>): boolean {
    return (
      labels['managed-by'] === 'open-v0' &&
      Types.ObjectId.isValid(labels.workspaceId ?? '') &&
      Types.ObjectId.isValid(labels.projectId ?? '') &&
      Types.ObjectId.isValid(labels.branchId ?? '') &&
      (labels.purpose === 'build' || labels.purpose === 'preview')
    );
  }

  private async inspect(
    provider: SandboxProvider,
    ref: { provider: string; externalId: string }
  ): Promise<SandboxInspection | undefined> {
    try {
      return await provider.inspect(ref);
    } catch (error) {
      if (
        isSandboxError(error) &&
        error.code === 'SANDBOX_NOT_FOUND'
      ) {
        return undefined;
      }
      throw error;
    }
  }
}
