import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startSandboxReconcilerLoop
} from './reconcilerLoop';
import type { SandboxReconcileResult } from './SandboxReconciler';

const emptyResult = (): SandboxReconcileResult => ({
  failedReservations: 0,
  resumedProvisioning: 0,
  lost: 0,
  terminated: 0,
  destroyedDuplicates: 0,
  destroyedOrphans: 0,
  errors: 0
});

test('Sandbox Reconciler loop coalesces overlapping runs', async () => {
  let calls = 0;
  let finish!: (value: SandboxReconcileResult) => void;
  const pending = new Promise<SandboxReconcileResult>((resolve) => {
    finish = resolve;
  });
  const loop = startSandboxReconcilerLoop({
    reconciler: {
      reconcile: async () => {
        calls += 1;
        return pending;
      }
    },
    intervalMs: 60_000
  });

  const first = loop.reconcileNow();
  const second = loop.reconcileNow();
  assert.equal(calls, 1);
  finish(emptyResult());
  await Promise.all([first, second]);
  await loop.close();
});

test('Sandbox Reconciler loop reports failures and remains retryable', async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const loop = startSandboxReconcilerLoop({
    reconciler: {
      reconcile: async () => {
        calls += 1;
        if (calls === 1) throw new Error('provider unavailable');
        return emptyResult();
      }
    },
    intervalMs: 60_000,
    onError: (error) => errors.push(error)
  });

  await loop.reconcileNow();
  await loop.reconcileNow();
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  await loop.close();
  await loop.reconcileNow();
  assert.equal(calls, 2);
});
