import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalPersistentDatabase, schemaForProject } from './persistentDatabase';

test('persistent database derives an isolated safe schema from a project id', () => {
  assert.equal(schemaForProject('64b7f5086f1f8e9f0f000001'), 'app_64b7f5086f1f8e9f0f000001');
  assert.throws(() => schemaForProject('not-a-project'), /not safe/);
});

test('persistent database requires an explicit local admin URL', async () => {
  const database = new LocalPersistentDatabase();
  await assert.rejects(
    database.ensure('64b7f5086f1f8e9f0f000001'),
    /LOCAL_PERSISTENT_DATABASE_URL/
  );
});
