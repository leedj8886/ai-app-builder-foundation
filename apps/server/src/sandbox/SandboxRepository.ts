import { Types } from 'mongoose';
import {
  SandboxLease,
  type SandboxLeaseDocument,
  type SandboxReservationRecord
} from '../models/SandboxLease';
import { SandboxError } from './errors';
import type { SandboxLeaseState } from './types';

export const SANDBOX_ALLOWED_TRANSITIONS: Readonly<
  Record<SandboxLeaseState, readonly SandboxLeaseState[]>
> = {
  reserved: ['provisioning', 'failed', 'terminating'],
  provisioning: ['ready', 'failed', 'terminating'],
  ready: ['running', 'lost', 'terminating'],
  running: ['lost', 'terminating'],
  terminating: ['terminated'],
  terminated: [],
  failed: ['terminating', 'terminated'],
  lost: ['terminating', 'terminated']
};

const canonicalReservation = (
  value: SandboxReservationRecord | SandboxLeaseDocument
) => ({
  workspaceId: value.workspaceId.toString(),
  projectId: value.projectId.toString(),
  branchId: value.branchId.toString(),
  requestedByUserId: value.requestedByUserId.toString(),
  runId: value.runId?.toString(),
  snapshotId: value.snapshotId?.toString(),
  sourceArtifact: {
    artifactId: value.sourceArtifact.artifactId,
    kind: value.sourceArtifact.kind
  },
  purpose: value.purpose,
  provider: value.provider,
  provisioningKey: value.provisioningKey,
  spec: {
    image: value.spec.image,
    workingDirectory: value.spec.workingDirectory,
    networkPolicy: {
      defaultAction: value.spec.networkPolicy.defaultAction,
      allowedDomains: [...value.spec.networkPolicy.allowedDomains],
      allowedCidrs: [...value.spec.networkPolicy.allowedCidrs]
    },
    leaseSeconds: value.spec.leaseSeconds,
    autoStopSeconds: value.spec.autoStopSeconds,
    autoDeleteSeconds: value.spec.autoDeleteSeconds
  },
  resourceProfile: {
    cpu: value.resourceProfile.cpu,
    memoryMiB: value.resourceProfile.memoryMiB,
    diskMiB: value.resourceProfile.diskMiB
  }
});

const sameReservation = (
  existing: SandboxLeaseDocument,
  input: SandboxReservationRecord
): boolean =>
  JSON.stringify(canonicalReservation(existing)) ===
  JSON.stringify(canonicalReservation(input));

const duplicateKey = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 11000
  );

export class SandboxRepository {
  findById(leaseId: Types.ObjectId): Promise<SandboxLeaseDocument | null> {
    return SandboxLease.findById(leaseId).exec();
  }

  async createReserved(
    input: SandboxReservationRecord
  ): Promise<SandboxLeaseDocument> {
    const existing = await this.findByProvisioningKey(input.provisioningKey);
    if (existing) return this.reuseOrReject(existing, input);

    try {
      return await SandboxLease.create({ ...input, state: 'reserved' });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const concurrent = await this.findByProvisioningKey(
        input.provisioningKey
      );
      if (!concurrent) throw error;
      return this.reuseOrReject(concurrent, input);
    }
  }

  findByProvisioningKey(
    key: string
  ): Promise<SandboxLeaseDocument | null> {
    return SandboxLease.findOne({ provisioningKey: key }).exec();
  }

  findByProviderRef(
    provider: string,
    externalId: string
  ): Promise<SandboxLeaseDocument | null> {
    return SandboxLease.findOne({ provider, externalId }).exec();
  }

  claimProvisioning(
    leaseId: Types.ObjectId,
    expectedUpdatedAt: Date,
    claimedAt: Date
  ): Promise<SandboxLeaseDocument | null> {
    return SandboxLease.findOneAndUpdate(
      {
        _id: leaseId,
        state: 'provisioning',
        updatedAt: expectedUpdatedAt
      },
      { $set: { lastHeartbeatAt: claimedAt } },
      { new: true, runValidators: true }
    ).exec();
  }

  async transition(input: {
    leaseId: Types.ObjectId;
    from: SandboxLeaseState[];
    to: SandboxLeaseState;
    set?: Record<string, unknown>;
  }): Promise<SandboxLeaseDocument | null> {
    if (
      input.from.length === 0 ||
      input.from.some(
        (state) => !SANDBOX_ALLOWED_TRANSITIONS[state].includes(input.to)
      )
    ) {
      throw new SandboxError(
        'SANDBOX_INVALID_STATE',
        `Invalid Sandbox transition to ${input.to}`
      );
    }
    return SandboxLease.findOneAndUpdate(
      { _id: input.leaseId, state: { $in: input.from } },
      { $set: { ...(input.set ?? {}), state: input.to } },
      { new: true, runValidators: true }
    ).exec();
  }

  bindExternalId(input: {
    leaseId: Types.ObjectId;
    provider: string;
    externalId: string;
  }): Promise<SandboxLeaseDocument | null> {
    return SandboxLease.findOneAndUpdate(
      {
        _id: input.leaseId,
        state: 'provisioning',
        provider: input.provider,
        externalId: { $exists: false }
      },
      { $set: { externalId: input.externalId } },
      { new: true, runValidators: true }
    ).exec();
  }

  clearExternalId(input: {
    leaseId: Types.ObjectId;
    provider: string;
    externalId: string;
  }): Promise<SandboxLeaseDocument | null> {
    return SandboxLease.findOneAndUpdate(
      {
        _id: input.leaseId,
        state: 'provisioning',
        provider: input.provider,
        externalId: input.externalId
      },
      { $unset: { externalId: 1 } },
      { new: true, runValidators: true }
    ).exec();
  }

  async *findExpired(
    state: SandboxLeaseState,
    before: Date,
    limit: number
  ): AsyncIterable<SandboxLeaseDocument> {
    const cursor = SandboxLease.find({
      state,
      expiresAt: { $lte: before }
    })
      .sort({ expiresAt: 1, _id: 1 })
      .limit(limit)
      .cursor();
    for await (const lease of cursor) yield lease;
  }

  private reuseOrReject(
    existing: SandboxLeaseDocument,
    input: SandboxReservationRecord
  ): SandboxLeaseDocument {
    if (!sameReservation(existing, input)) {
      throw new SandboxError(
        'SANDBOX_OWNERSHIP_MISMATCH',
        'Provisioning key belongs to a different Sandbox reservation'
      );
    }
    return existing;
  }
}
