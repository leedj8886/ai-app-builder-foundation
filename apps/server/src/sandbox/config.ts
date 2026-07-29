export interface SandboxConfig {
  provider: string;
  localEnabled: boolean;
  localRoot: string;
  allowedBuildImages: string[];
  quotaLockTtlMs: number;
  quotaLockWaitMs: number;
  readinessTimeoutMs: number;
  leaseSeconds: number;
  autoDeleteSeconds: number;
  orphanGraceMs: number;
  reconcileIntervalMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  commandTimeouts: {
    install: number;
    typeCheck: number;
    build: number;
  };
}

const positive = (
  value: string | undefined,
  fallback: number,
  name: string
): number => {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
};

const boolean = (
  value: string | undefined,
  fallback: boolean,
  name: string
): boolean => {
  if (value === undefined) return fallback;
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be "true" or "false"`);
  }
  return value === 'true';
};

const images = (value: string | undefined): string[] => {
  if (value === undefined) return ['node:22'];
  const parsed = value.split(',').map((entry) => entry.trim());
  if (parsed.length === 0 || parsed.some((entry) => entry.length === 0)) {
    throw new Error(
      'SANDBOX_ALLOWED_BUILD_IMAGES must contain non-empty image names'
    );
  }
  return parsed;
};

export const getSandboxConfig = (
  env: Record<string, string | undefined> = process.env
): SandboxConfig => {
  const provider = env.SANDBOX_PROVIDER?.trim() || 'fake';
  const localEnabled = boolean(
    env.SANDBOX_LOCAL_ENABLED,
    false,
    'SANDBOX_LOCAL_ENABLED'
  );

  if (
    env.NODE_ENV === 'production' &&
    (provider === 'local' || localEnabled)
  ) {
    throw new Error(
      'LocalProcessProvider cannot be enabled in production'
    );
  }
  const heartbeatIntervalMs = positive(
    env.SANDBOX_HEARTBEAT_INTERVAL_MS,
    10_000,
    'SANDBOX_HEARTBEAT_INTERVAL_MS'
  );
  const heartbeatTimeoutMs = positive(
    env.SANDBOX_HEARTBEAT_TIMEOUT_MS,
    45_000,
    'SANDBOX_HEARTBEAT_TIMEOUT_MS'
  );
  if (heartbeatTimeoutMs <= heartbeatIntervalMs) {
    throw new Error(
      'SANDBOX_HEARTBEAT_TIMEOUT_MS must be greater than ' +
      'SANDBOX_HEARTBEAT_INTERVAL_MS'
    );
  }

  return {
    provider,
    localEnabled,
    localRoot: env.SANDBOX_LOCAL_ROOT || '/tmp/open-v0-sandboxes',
    allowedBuildImages: images(env.SANDBOX_ALLOWED_BUILD_IMAGES),
    quotaLockTtlMs: positive(
      env.SANDBOX_QUOTA_LOCK_TTL_MS,
      5_000,
      'SANDBOX_QUOTA_LOCK_TTL_MS'
    ),
    quotaLockWaitMs: positive(
      env.SANDBOX_QUOTA_LOCK_WAIT_MS,
      2_000,
      'SANDBOX_QUOTA_LOCK_WAIT_MS'
    ),
    readinessTimeoutMs: positive(
      env.SANDBOX_READINESS_TIMEOUT_MS,
      60_000,
      'SANDBOX_READINESS_TIMEOUT_MS'
    ),
    leaseSeconds: positive(
      env.SANDBOX_LEASE_SECONDS,
      900,
      'SANDBOX_LEASE_SECONDS'
    ),
    autoDeleteSeconds: positive(
      env.SANDBOX_AUTO_DELETE_SECONDS,
      1_800,
      'SANDBOX_AUTO_DELETE_SECONDS'
    ),
    orphanGraceMs: positive(
      env.SANDBOX_ORPHAN_GRACE_MS,
      300_000,
      'SANDBOX_ORPHAN_GRACE_MS'
    ),
    reconcileIntervalMs: positive(
      env.SANDBOX_RECONCILE_INTERVAL_MS,
      30_000,
      'SANDBOX_RECONCILE_INTERVAL_MS'
    ),
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    commandTimeouts: {
      install: positive(
        env.SANDBOX_INSTALL_TIMEOUT_MS,
        180_000,
        'SANDBOX_INSTALL_TIMEOUT_MS'
      ),
      typeCheck: positive(
        env.SANDBOX_TYPE_CHECK_TIMEOUT_MS,
        60_000,
        'SANDBOX_TYPE_CHECK_TIMEOUT_MS'
      ),
      build: positive(
        env.SANDBOX_BUILD_TIMEOUT_MS,
        120_000,
        'SANDBOX_BUILD_TIMEOUT_MS'
      )
    }
  };
};
