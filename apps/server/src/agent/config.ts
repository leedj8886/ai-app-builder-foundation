export interface AgentConfig {
  redisUrl: string;
  queueName: string;
  model: string;
  maxRepairAttempts: number;
  workspaceRoot: string;
  contextCharLimit: number;
}

type EnvLike = Record<string, string | undefined>;

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getAgentConfig = (env: EnvLike = process.env): AgentConfig => ({
  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  queueName: env.AGENT_QUEUE_NAME || 'v0-agent-runs',
  model: env.AGENT_MODEL || 'gpt-4.1',
  maxRepairAttempts: numberFromEnv(env.AGENT_MAX_REPAIR_ATTEMPTS, 2),
  workspaceRoot: env.AGENT_WORKSPACE_ROOT || '/tmp/v0-agent-runs',
  contextCharLimit: numberFromEnv(env.AGENT_CONTEXT_CHAR_LIMIT, 120000)
});
