export interface ValidationConfig {
  structureTimeoutMs: number;
  cacheHitTimeoutMs: number;
  installTimeoutMs: number;
  typeCheckTimeoutMs: number;
  buildTimeoutMs: number;
  roundTimeoutMs: number;
  infrastructureRetryDelaysMs: number[];
  npmCacheRoot: string;
  dependencyCacheRoot: string;
  cacheRetentionMs: number;
  cacheMaxBytes: number;
  maxOutputChars: number;
}

export interface AgentConfig {
  redisUrl: string;
  queueName: string;
  model: string;
  validationExecutor: 'legacy' | 'sandbox';
  maxRepairAttempts: number;
  workspaceRoot: string;
  contextCharLimit: number;
  commandTimeoutMs: number;
  maxValidationOutputChars: number;
  validation: ValidationConfig;
}

type EnvLike = Record<string, string | undefined>;

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const numberListFromEnv = (
  value: string | undefined,
  fallback: number[]
): number[] => {
  if (!value) return fallback;
  const parsed = value.split(',').map(item => Number.parseInt(item.trim(), 10));
  return parsed.length > 0 && parsed.every(item => Number.isFinite(item) && item > 0)
    ? parsed
    : fallback;
};

const validationExecutorFromEnv = (
  value: string | undefined
): AgentConfig['validationExecutor'] => {
  if (value === undefined || value === '') return 'legacy';
  if (value !== 'legacy' && value !== 'sandbox') {
    throw new Error(
      'AGENT_VALIDATION_EXECUTOR must be "legacy" or "sandbox"'
    );
  }
  return value;
};

export const getAgentConfig = (env: EnvLike = process.env): AgentConfig => {
  const legacyCommandTimeoutMs = numberFromEnv(
    env.AGENT_COMMAND_TIMEOUT_MS,
    120000
  );
  const maxOutputChars = numberFromEnv(
    env.AGENT_MAX_VALIDATION_OUTPUT_CHARS,
    12000
  );

  return {
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
    queueName: env.AGENT_QUEUE_NAME || 'v0-agent-runs',
    model:
      env.AGENT_MODEL ||
      env.DEEPSEEK_MODEL ||
      'deepseek-v4-flash',
    validationExecutor: validationExecutorFromEnv(
      env.AGENT_VALIDATION_EXECUTOR
    ),
    maxRepairAttempts: numberFromEnv(env.AGENT_MAX_REPAIR_ATTEMPTS, 2),
    workspaceRoot: env.AGENT_WORKSPACE_ROOT || '/tmp/v0-agent-runs',
    contextCharLimit: numberFromEnv(env.AGENT_CONTEXT_CHAR_LIMIT, 120000),
    commandTimeoutMs: legacyCommandTimeoutMs,
    maxValidationOutputChars: maxOutputChars,
    validation: {
      structureTimeoutMs: numberFromEnv(
        env.AGENT_VALIDATION_STRUCTURE_TIMEOUT_MS,
        5_000
      ),
      cacheHitTimeoutMs: numberFromEnv(
        env.AGENT_VALIDATION_CACHE_HIT_TIMEOUT_MS,
        15_000
      ),
      installTimeoutMs: numberFromEnv(
        env.AGENT_VALIDATION_INSTALL_TIMEOUT_MS,
        180_000
      ),
      typeCheckTimeoutMs: numberFromEnv(
        env.AGENT_VALIDATION_TYPE_CHECK_TIMEOUT_MS,
        60_000
      ),
      buildTimeoutMs: numberFromEnv(
        env.AGENT_VALIDATION_BUILD_TIMEOUT_MS,
        legacyCommandTimeoutMs
      ),
      roundTimeoutMs: numberFromEnv(
        env.AGENT_VALIDATION_ROUND_TIMEOUT_MS,
        300_000
      ),
      infrastructureRetryDelaysMs: numberListFromEnv(
        env.AGENT_VALIDATION_INFRA_RETRY_DELAYS_MS,
        [5_000, 15_000]
      ),
      npmCacheRoot:
        env.AGENT_VALIDATION_NPM_CACHE_ROOT || '/var/cache/v0-agent/npm',
      dependencyCacheRoot:
        env.AGENT_VALIDATION_DEPENDENCY_CACHE_ROOT ||
        '/var/cache/v0-agent/dependencies',
      cacheRetentionMs: numberFromEnv(
        env.AGENT_VALIDATION_CACHE_RETENTION_MS,
        7 * 24 * 60 * 60 * 1_000
      ),
      cacheMaxBytes: numberFromEnv(
        env.AGENT_VALIDATION_CACHE_MAX_BYTES,
        10 * 1024 * 1024 * 1024
      ),
      maxOutputChars
    }
  };
};
