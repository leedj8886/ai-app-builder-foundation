import assert from 'node:assert/strict';
import test from 'node:test';
import { redactValidationSecrets } from './database';

test('validation database redaction removes exact and normalized PostgreSQL URLs', () => {
  const lease = {
    id: 'database',
    expiresAt: new Date(),
    connection: {
      databaseUrl: 'postgresql://user:secret@db.example/primary?schema=public',
      shadowDatabaseUrl: 'postgresql://user:secret@db.example/shadow?schema=public'
    },
    destroy: async () => {}
  };
  const output = redactValidationSecrets(
    `exact ${lease.connection.databaseUrl}\nnormalized postgres://user:secret@db.example/primary`,
    lease
  );

  assert.equal(output.includes('secret'), false);
  assert.equal(output, 'exact [REDACTED]\nnormalized [REDACTED]');
});
