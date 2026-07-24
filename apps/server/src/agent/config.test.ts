import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentConfig } from './config';

test('getAgentConfig uses stable defaults', () => {
  const config = getAgentConfig({});

  assert.equal(config.redisUrl, 'redis://localhost:6379');
  assert.equal(config.queueName, 'v0-agent-runs');
  assert.equal(config.model, 'gpt-4.1');
  assert.equal(config.maxRepairAttempts, 2);
  assert.equal(config.workspaceRoot, '/tmp/v0-agent-runs');
  assert.equal(config.contextCharLimit, 120000);
  assert.equal(config.commandTimeoutMs, 120000);
  assert.equal(config.maxValidationOutputChars, 12000);
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
