import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentConfig } from './config';

test('getAgentConfig uses stable defaults', () => {
  const config = getAgentConfig({});

  assert.equal(config.redisUrl, 'redis://localhost:6379');
  assert.equal(config.queueName, 'v0-agent-runs');
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.maxRepairAttempts, 2);
  assert.equal(config.workspaceRoot, '/tmp/v0-agent-runs');
  assert.equal(config.contextCharLimit, 120000);
  assert.equal(config.commandTimeoutMs, 120000);
  assert.equal(config.maxValidationOutputChars, 12000);
});

test('getAgentConfig exposes phase validation cache and retry defaults', () => {
  const config = getAgentConfig({});

  assert.equal(config.validation.structureTimeoutMs, 5_000);
  assert.equal(config.validation.cacheHitTimeoutMs, 15_000);
  assert.equal(config.validation.installTimeoutMs, 180_000);
  assert.equal(config.validation.typeCheckTimeoutMs, 60_000);
  assert.equal(config.validation.buildTimeoutMs, 120_000);
  assert.equal(config.validation.roundTimeoutMs, 300_000);
  assert.deepEqual(config.validation.infrastructureRetryDelaysMs, [5_000, 15_000]);
  assert.equal(config.validation.npmCacheRoot, '/var/cache/v0-agent/npm');
  assert.equal(
    config.validation.dependencyCacheRoot,
    '/var/cache/v0-agent/dependencies'
  );
  assert.equal(config.validation.cacheRetentionMs, 7 * 24 * 60 * 60 * 1_000);
  assert.equal(config.validation.cacheMaxBytes, 10 * 1024 * 1024 * 1024);
  assert.equal(config.validation.maxOutputChars, 12_000);
});

test('getAgentConfig gives AGENT_MODEL precedence over DEEPSEEK_MODEL', () => {
  assert.equal(
    getAgentConfig({
      AGENT_MODEL: 'agent-model',
      DEEPSEEK_MODEL: 'shared-model'
    }).model,
    'agent-model'
  );
  assert.equal(
    getAgentConfig({ DEEPSEEK_MODEL: 'shared-model' }).model,
    'shared-model'
  );
});

test('getAgentConfig parses numeric env values', () => {
  const config = getAgentConfig({
    AGENT_MAX_REPAIR_ATTEMPTS: '4',
    AGENT_CONTEXT_CHAR_LIMIT: '9000',
    AGENT_COMMAND_TIMEOUT_MS: '30000',
    AGENT_MAX_VALIDATION_OUTPUT_CHARS: '4000'
  });

  assert.equal(config.maxRepairAttempts, 4);
  assert.equal(config.contextCharLimit, 9000);
  assert.equal(config.commandTimeoutMs, 30000);
  assert.equal(config.maxValidationOutputChars, 4000);
});

test('getAgentConfig parses validation overrides and bounded retry delays', () => {
  const config = getAgentConfig({
    AGENT_VALIDATION_INSTALL_TIMEOUT_MS: '90000',
    AGENT_VALIDATION_INFRA_RETRY_DELAYS_MS: '100,250',
    AGENT_VALIDATION_CACHE_MAX_BYTES: '2048'
  });

  assert.equal(config.validation.installTimeoutMs, 90_000);
  assert.deepEqual(config.validation.infrastructureRetryDelaysMs, [100, 250]);
  assert.equal(config.validation.cacheMaxBytes, 2_048);
  assert.deepEqual(
    getAgentConfig({
      AGENT_VALIDATION_INFRA_RETRY_DELAYS_MS: '100,invalid'
    }).validation.infrastructureRetryDelaysMs,
    [5_000, 15_000]
  );
});
