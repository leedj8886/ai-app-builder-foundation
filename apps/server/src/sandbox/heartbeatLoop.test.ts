import assert from 'node:assert/strict';
import test from 'node:test';
import { startSandboxHeartbeatLoop } from './heartbeatLoop';

test('Sandbox heartbeat loop coalesces overlapping heartbeats', async () => {
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const loop = startSandboxHeartbeatLoop({
    heartbeat: async () => {
      calls += 1;
      await pending;
    },
    intervalMs: 60_000,
    onError: () => undefined
  });

  const first = loop.heartbeatNow();
  const second = loop.heartbeatNow();
  assert.equal(calls, 1);
  finish();
  await Promise.all([first, second]);
  await loop.close();
});

test('Sandbox heartbeat loop forwards scheduled failures', async () => {
  const errors: unknown[] = [];
  const loop = startSandboxHeartbeatLoop({
    heartbeat: async () => {
      throw new Error('heartbeat failed');
    },
    intervalMs: 1,
    onError: (error) => errors.push(error)
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await loop.close();
  assert.ok(errors.length > 0);
});
