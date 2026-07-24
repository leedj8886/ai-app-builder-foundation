import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { errorHandler } from './errorHandler';

test('errorHandler returns 400 for zod validation errors', () => {
  let error: unknown;
  try {
    z.object({ mode: z.enum(['create', 'edit']) }).parse({ mode: 'generate' });
  } catch (err) {
    error = err;
  }

  let statusCode = 0;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    }
  };

  assert.ok(error instanceof Error);

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    errorHandler(error, {} as never, res as never, () => undefined);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(statusCode, 400);
  assert.deepEqual(body, {
    error: 'Validation Error',
    details: [
      {
        code: 'invalid_enum_value',
        message: "Invalid enum value. Expected 'create' | 'edit', received 'generate'",
        options: ['create', 'edit'],
        path: ['mode'],
        received: 'generate'
      }
    ]
  });
});
