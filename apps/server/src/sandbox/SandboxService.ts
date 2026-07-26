import { Types } from 'mongoose';
import type { ArtifactService } from '../artifacts/artifactService';
import type { ProjectArtifactBundleV1 } from '../artifacts/types';
import type { SandboxLeaseDocument } from '../models/SandboxLease';
import {
  SandboxCreateError,
  SandboxError,
  isSandboxError
} from './errors';
import type { SandboxPolicy } from './policy';
import type { SandboxProvider } from './provider/SandboxProvider';
import type {
  ResourceProfile,
  SandboxProviderDescriptor,
  SandboxSpec
} from './types';
import type { QuotaScheduler } from './QuotaScheduler';
import { SandboxRepository } from './SandboxRepository';

interface SandboxServiceOptions {
  artifactService: ArtifactService;
  scheduler: QuotaScheduler;
  repository: SandboxRepository;
  policy: SandboxPolicy;
  providers: Map<string, SandboxProvider>;
  now?: () => Date;
}

export interface CreateBuildSandboxInput {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  branchId: Types.ObjectId;
  requestedByUserId: Types.ObjectId;
  runId: Types.ObjectId;
  sourceArtifact: {
    artifactId: string;
    kind: 'project_snapshot' | 'validation_candidate';
  };
  provider: string;
  image: string;
  attempt: number;
  resources: ResourceProfile;
}

export class SandboxService {
  private readonly now: () => Date;

  constructor(private readonly options: SandboxServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async createBuildSandbox(
    input: CreateBuildSandboxInput
  ): Promise<SandboxLeaseDocument> {
    const provider = this.provider(input.provider);
    this.options.policy.assertProviderAllowed(input.provider, {
      production: process.env.NODE_ENV === 'production'
    });
    const spec = this.buildSpec(input);
    this.options.policy.assertSpecAllowed(spec);

    await this.readOwnedBundle(input).catch((error) => {
      throw new SandboxError(
        'SANDBOX_SOURCE_UNAVAILABLE',
        'Sandbox source Artifact is unavailable',
        false,
        error
      );
    });
    await this.assertCapabilities(provider, spec);

    let lease = await this.options.scheduler.reserve({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      branchId: input.branchId,
      requestedByUserId: input.requestedByUserId,
      runId: input.runId,
      sourceArtifact: input.sourceArtifact,
      purpose: 'build',
      provider: input.provider,
      provisioningKey: spec.provisioningKey,
      spec: {
        image: spec.runtime.image,
        workingDirectory: spec.runtime.workingDirectory,
        networkPolicy: spec.networkPolicy,
        leaseSeconds: spec.lifecycle.leaseSeconds,
        autoStopSeconds: spec.lifecycle.autoStopSeconds,
        autoDeleteSeconds: spec.lifecycle.autoDeleteSeconds
      },
      resourceProfile: spec.resources,
      expiresAt: new Date(
        this.now().getTime() + spec.lifecycle.leaseSeconds * 1_000
      )
    });

    if (lease.state === 'ready' || lease.state === 'running') return lease;
    if (lease.state === 'reserved') {
      lease =
        (await this.options.repository.transition({
          leaseId: lease._id,
          from: ['reserved'],
          to: 'provisioning'
        })) ??
        (await this.requireLease(lease._id));
    }
    if (lease.state !== 'provisioning') {
      throw new SandboxError(
        'SANDBOX_INVALID_STATE',
        'Sandbox Lease cannot be provisioned from its current state'
      );
    }
    if (lease.externalId) return this.resumeProvisioning(lease._id);

    let ref;
    try {
      ref = await provider.create(spec);
    } catch (error) {
      if (
        error instanceof SandboxCreateError &&
        error.outcome === 'not-created'
      ) {
        await this.options.repository.transition({
          leaseId: lease._id,
          from: ['provisioning'],
          to: 'failed',
          set: {
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable
            }
          }
        });
      }
      throw error;
    }

    lease =
      (await this.options.repository.bindExternalId({
        leaseId: lease._id,
        provider: ref.provider,
        externalId: ref.externalId
      })) ??
      (await this.requireLease(lease._id));
    if (
      lease.provider !== ref.provider ||
      lease.externalId !== ref.externalId
    ) {
      throw new SandboxError(
        'SANDBOX_OWNERSHIP_MISMATCH',
        'Sandbox Lease is bound to a different Provider resource'
      );
    }
    return this.resumeProvisioning(lease._id);
  }

  async resumeProvisioning(
    leaseId: Types.ObjectId
  ): Promise<SandboxLeaseDocument> {
    const lease = await this.requireLease(leaseId);
    if (lease.state === 'ready' || lease.state === 'running') return lease;
    if (lease.state !== 'provisioning' || !lease.externalId) {
      throw new SandboxError(
        'SANDBOX_NOT_READY',
        'Sandbox has no bound Provider resource',
        true
      );
    }
    const provider = this.provider(lease.provider);
    const ref = { provider: lease.provider, externalId: lease.externalId };

    try {
      const bundle = await this.options.artifactService
        .readOwnedBundle({
          artifactId: lease.sourceArtifact.artifactId,
          workspaceId: lease.workspaceId,
          projectId: lease.projectId,
          kind: lease.sourceArtifact.kind
        })
        .catch((error) => {
          throw new SandboxError(
            'SANDBOX_SOURCE_UNAVAILABLE',
            'Sandbox source Artifact is unavailable',
            false,
            error
          );
        });
      const handle = await provider.connect(ref);
      await handle.waitUntilReady({
        timeoutMs: 60_000
      });
      await handle.files.writeFiles(this.uploadFiles(bundle));
      const ready = await this.options.repository.transition({
        leaseId,
        from: ['provisioning'],
        to: 'ready',
        set: { readyAt: this.now(), lastHeartbeatAt: this.now() }
      });
      return ready ?? this.requireLease(leaseId);
    } catch (error) {
      await this.cleanupFailedProvisioning(lease, provider);
      if (isSandboxError(error)) throw error;
      throw new SandboxError(
        'SANDBOX_PROVISION_FAILED',
        'Sandbox provisioning failed',
        true,
        error
      );
    }
  }

  private buildSpec(input: CreateBuildSandboxInput): SandboxSpec {
    return {
      provisioningKey: `build:${input.runId.toString()}:${input.attempt}`,
      ownership: {
        workspaceId: input.workspaceId.toString(),
        projectId: input.projectId.toString(),
        branchId: input.branchId.toString(),
        runId: input.runId.toString(),
        purpose: 'build'
      },
      runtime: { image: input.image, workingDirectory: '/workspace' },
      resources: { ...input.resources },
      networkPolicy: {
        defaultAction: 'allow',
        allowedDomains: [],
        allowedCidrs: []
      },
      lifecycle: {
        leaseSeconds: 900,
        autoDeleteSeconds: 1_800
      },
      labels: {
        'managed-by': 'open-v0',
        workspaceId: input.workspaceId.toString(),
        projectId: input.projectId.toString(),
        branchId: input.branchId.toString(),
        purpose: 'build'
      }
    };
  }

  private readOwnedBundle(
    input: CreateBuildSandboxInput
  ): Promise<ProjectArtifactBundleV1> {
    return this.options.artifactService.readOwnedBundle({
      artifactId: input.sourceArtifact.artifactId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: input.sourceArtifact.kind
    });
  }

  private async assertCapabilities(
    provider: SandboxProvider,
    spec: SandboxSpec
  ): Promise<void> {
    const descriptor = await provider.describe().catch((error) => {
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Sandbox Provider is unavailable',
        true,
        error
      );
    });
    for (const capability of this.options.policy.requiredCapabilities(spec)) {
      if (
        !descriptor.capabilities[
          capability as keyof SandboxProviderDescriptor['capabilities']
        ]
      ) {
        throw new SandboxError(
          'SANDBOX_CAPABILITY_MISSING',
          `Sandbox Provider lacks required capability: ${capability}`
        );
      }
    }
  }

  private uploadFiles(
    bundle: ProjectArtifactBundleV1
  ): Array<{ path: string; content: Uint8Array }> {
    const encoder = new TextEncoder();
    const files = new Map(
      bundle.files.map((file) => [file.path, encoder.encode(file.content)])
    );
    files.set(
      'package.json',
      encoder.encode(`${JSON.stringify(bundle.packageJson, null, 2)}\n`)
    );
    return [...files].map(([path, content]) => ({ path, content }));
  }

  private provider(kind: string): SandboxProvider {
    const provider = this.options.providers.get(kind);
    if (!provider) {
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Sandbox Provider is not configured',
        true
      );
    }
    return provider;
  }

  private async requireLease(
    leaseId: Types.ObjectId
  ): Promise<SandboxLeaseDocument> {
    const lease = await this.options.repository.findById(leaseId);
    if (!lease) {
      throw new SandboxError('SANDBOX_NOT_FOUND', 'Sandbox Lease not found');
    }
    return lease;
  }

  private async cleanupFailedProvisioning(
    lease: SandboxLeaseDocument,
    provider: SandboxProvider
  ): Promise<void> {
    await this.options.repository.transition({
      leaseId: lease._id,
      from: ['provisioning'],
      to: 'terminating',
      set: {
        error: {
          code: 'SANDBOX_PROVISION_FAILED',
          message: 'Sandbox provisioning failed',
          retryable: true
        }
      }
    });
    const receipt = await provider
      .destroy({
        provider: lease.provider,
        externalId: lease.externalId!
      })
      .catch(() => null);
    if (receipt && !receipt.pending) {
      await this.options.repository.transition({
        leaseId: lease._id,
        from: ['terminating'],
        to: 'terminated',
        set: { terminatedAt: this.now() }
      });
    }
  }
}
