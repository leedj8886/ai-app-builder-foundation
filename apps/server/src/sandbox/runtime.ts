import { mkdir } from 'node:fs/promises';
import type IORedis from 'ioredis';
import type { ArtifactService } from '../artifacts/artifactService';
import { getArtifactService } from '../artifacts/runtime';
import { getSandboxConfig } from './config';
import { createSandboxPolicy } from './policy';
import type { SandboxProvider } from './provider/SandboxProvider';
import { FakeSandboxProvider, FakeSandboxState } from './providers/FakeSandboxProvider';
import { LocalProcessProvider } from './providers/LocalProcessProvider';
import { QuotaScheduler } from './QuotaScheduler';
import { SandboxRepository } from './SandboxRepository';
import { SandboxReconciler } from './SandboxReconciler';
import { SandboxService } from './SandboxService';
import { WorkspaceQuotaLock } from './WorkspaceQuotaLock';

interface CreateSandboxRuntimeOptions {
  redis: IORedis;
  env?: Record<string, string | undefined>;
  artifactService?: ArtifactService;
  fakeState?: FakeSandboxState;
}

export interface SandboxRuntime {
  service: SandboxService;
  reconciler: SandboxReconciler;
  reconcileIntervalMs: number;
  provider: string;
  image: string;
  verification: 'verified' | 'simulated';
  fakeState?: FakeSandboxState;
}

export const createSandboxRuntime = async (
  options: CreateSandboxRuntimeOptions
): Promise<SandboxRuntime> => {
  const env = options.env ?? process.env;
  const config = getSandboxConfig(env);
  const providers = new Map<string, SandboxProvider>();
  let fakeState: FakeSandboxState | undefined;

  if (config.provider === 'fake') {
    fakeState = options.fakeState ?? new FakeSandboxState();
    providers.set('fake', new FakeSandboxProvider(fakeState));
  } else if (config.provider === 'local') {
    await mkdir(config.localRoot, { recursive: true, mode: 0o700 });
    providers.set('local', new LocalProcessProvider({
      root: config.localRoot,
      production: env.NODE_ENV === 'production'
    }));
  } else {
    throw new Error(
      `Sandbox Provider "${config.provider}" is not implemented`
    );
  }

  const repository = new SandboxRepository();
  const lock = new WorkspaceQuotaLock({
    redis: options.redis,
    ttlMs: config.quotaLockTtlMs,
    waitMs: config.quotaLockWaitMs
  });
  const scheduler = new QuotaScheduler(lock, repository);
  const service = new SandboxService({
    artifactService: options.artifactService ?? getArtifactService(),
    config,
    scheduler,
    repository,
    policy: createSandboxPolicy(config),
    providers
  });
  const reconciler = new SandboxReconciler({
    repository,
    service,
    providers,
    orphanGraceMs: config.orphanGraceMs,
    heartbeatTimeoutMs: config.heartbeatTimeoutMs
  });

  return {
    service,
    reconciler,
    reconcileIntervalMs: config.reconcileIntervalMs,
    provider: config.provider,
    image: config.allowedBuildImages[0],
    verification: config.provider === 'fake' ? 'simulated' : 'verified',
    ...(fakeState && { fakeState })
  };
};
