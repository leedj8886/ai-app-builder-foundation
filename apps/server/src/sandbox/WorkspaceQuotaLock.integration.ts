import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import IORedis from 'ioredis';
import { createIntegrationEnvironment, type IntegrationEnvironment } from '../testing/integrationEnvironment';
import { WorkspaceQuotaLock } from './WorkspaceQuotaLock';

let environment: IntegrationEnvironment;
before(async () => {
  environment = await createIntegrationEnvironment();
});
beforeEach(async () => environment.reset());
after(async () => environment.close());

test('WorkspaceQuotaLock acquires, verifies, and token-safely releases', async () => {
  const workspaceId = new Types.ObjectId();
  const lock = new WorkspaceQuotaLock({
    redis: environment.redis,
    ttlMs: 500,
    waitMs: 100
  });
  await lock.withLock(workspaceId, async (guard) => {
    await guard.assertHeld();
    assert.ok(
      await environment.redis.get(`sandbox-quota:${workspaceId.toString()}`)
    );
  });
  assert.equal(
    await environment.redis.get(`sandbox-quota:${workspaceId.toString()}`),
    null
  );
});

test('WorkspaceQuotaLock times out a second waiter', async () => {
  const workspaceId = new Types.ObjectId();
  const first = new WorkspaceQuotaLock({
    redis: environment.redis,
    ttlMs: 1_000,
    waitMs: 100
  });
  const second = new WorkspaceQuotaLock({
    redis: environment.redis,
    ttlMs: 1_000,
    waitMs: 30
  });
  let entered = false;
  await first.withLock(workspaceId, async () => {
    await assert.rejects(
      second.withLock(workspaceId, async () => {
        entered = true;
      }),
      /SANDBOX_SCHEDULER_UNAVAILABLE/
    );
  });
  assert.equal(entered, false);
});

test('WorkspaceQuotaLock fails closed when Redis is disconnected', async () => {
  const redis = new IORedis(environment.redisUrl, {
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false
  });
  await redis.connect().catch(() => undefined);
  redis.disconnect();
  const lock = new WorkspaceQuotaLock({
    redis,
    ttlMs: 100,
    waitMs: 20
  });
  await assert.rejects(
    lock.withLock(new Types.ObjectId(), async () => undefined),
    /SANDBOX_SCHEDULER_UNAVAILABLE/
  );
});
