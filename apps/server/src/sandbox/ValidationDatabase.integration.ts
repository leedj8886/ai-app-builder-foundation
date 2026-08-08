import assert from 'node:assert/strict';
import test from 'node:test';
import { runCancelledError } from '../agent/runCancellation';
import { TestcontainersValidationDatabase } from '../agent/validation/testcontainersDatabase';

test('Testcontainers validation databases isolate parallel rounds and clean up', async () => {
  const database = new TestcontainersValidationDatabase({ ttlMs: 60_000 });
  try {
    const [left, right] = await Promise.all([
      database.create({ runId: 'parallel-left' }),
      database.create({ runId: 'parallel-right' })
    ]);

    assert.notEqual(left.id, right.id);
    assert.notEqual(left.connection.databaseUrl, right.connection.databaseUrl);
    assert.notEqual(
      left.connection.databaseUrl,
      left.connection.shadowDatabaseUrl
    );
    assert.match(left.connection.databaseUrl, /validation_primary/);
    assert.match(left.connection.shadowDatabaseUrl, /validation_shadow/);

    await Promise.all([left.destroy(), right.destroy()]);
    await Promise.all([left.destroy(), right.destroy()]);
  } finally {
    await database.shutdown();
  }
});

test('Testcontainers validation database rejects an already-cancelled round', async () => {
  const database = new TestcontainersValidationDatabase();
  const controller = new AbortController();
  controller.abort(runCancelledError());
  try {
    await assert.rejects(
      database.create({ runId: 'cancelled', signal: controller.signal }),
      (error) => (error as { code?: string }).code === 'RUN_CANCELLED'
    );
  } finally {
    await database.shutdown();
  }
});
