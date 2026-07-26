import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithInfrastructureRetry } from './retry';

test('runWithInfrastructureRetry waits only for infrastructure failures', async () => {
  const delays: number[] = [];
  let attempts = 0;
  const result = await runWithInfrastructureRetry({
    retryDelaysMs: [5, 15],
    delay: async durationMs => {
      delays.push(durationMs);
    },
    operation: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error('temporary'), {
          category: 'INFRA_ERROR'
        });
      }
      return 'ready';
    }
  });

  assert.equal(result, 'ready');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 15]);
});

test('runWithInfrastructureRetry does not retry dependency errors', async () => {
  let attempts = 0;

  await assert.rejects(runWithInfrastructureRetry({
    retryDelaysMs: [5, 15],
    operation: async () => {
      attempts += 1;
      throw Object.assign(new Error('bad dependency'), {
        category: 'DEPENDENCY_ERROR'
      });
    }
  }), /bad dependency/);

  assert.equal(attempts, 1);
});
