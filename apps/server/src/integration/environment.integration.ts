import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { createIntegrationEnvironment } from '../testing/integrationEnvironment';

test('integration environment provides isolated MongoDB Redis and BullMQ state', async () => {
  const environment = await createIntegrationEnvironment();

  try {
    const probeKey = `${environment.namespace}:probe`;
    await environment.redis.set(probeKey, 'ok');

    assert.equal(await environment.redis.get(probeKey), 'ok');
    assert.equal(mongoose.connection.readyState, 1);

    await environment.reset();

    assert.equal(await environment.redis.get(probeKey), null);
  } finally {
    await environment.close();
  }
});
