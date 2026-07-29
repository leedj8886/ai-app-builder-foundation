import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startRunCancellationMonitor,
  throwIfAborted
} from './runCancellation';
import type { AgentRunStatus } from './types';

test('Run cancellation monitor aborts with the stable cancellation code', async () => {
  let status: AgentRunStatus = 'running';
  const monitor = startRunCancellationMonitor({
    loadStatus: async () => status,
    intervalMs: 60_000
  });
  await monitor.checkNow();
  assert.equal(monitor.signal.aborted, false);

  status = 'cancelled';
  await monitor.checkNow();
  assert.equal(monitor.signal.aborted, true);
  assert.throws(
    () => throwIfAborted(monitor.signal),
    (error) => (error as { code?: string }).code === 'RUN_CANCELLED'
  );
  await monitor.close();
});

test('Run cancellation monitor coalesces reads and retries transient failures', async () => {
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const monitor = startRunCancellationMonitor({
    loadStatus: async () => {
      calls += 1;
      if (calls === 1) {
        await pending;
        throw new Error('temporary database error');
      }
      return 'running';
    },
    intervalMs: 60_000
  });

  const first = monitor.checkNow();
  const second = monitor.checkNow();
  assert.equal(calls, 1);
  finish();
  await Promise.all([first, second]);
  await monitor.checkNow();
  assert.equal(calls, 2);
  assert.equal(monitor.signal.aborted, false);
  await monitor.close();
});
