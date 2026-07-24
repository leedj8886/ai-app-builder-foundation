import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentRunRequestSchema,
  objectIdParamSchema,
  streamTokenRequestSchema
} from './schemas';

test('createAgentRunRequestSchema defaults mode to create', () => {
  const parsed = createAgentRunRequestSchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    prompt: 'Build a dashboard'
  });

  assert.equal(parsed.mode, 'create');
});

test('createAgentRunRequestSchema rejects blank prompts', () => {
  assert.throws(() => {
    createAgentRunRequestSchema.parse({
      projectId: '64b7f5086f1f8e9f0f000001',
      prompt: '   '
    });
  });
});

test('objectIdParamSchema rejects invalid ObjectId strings', () => {
  assert.throws(() => {
    objectIdParamSchema('runId').parse({ runId: 'not-an-id' });
  });
});

test('streamTokenRequestSchema accepts run and event ids', () => {
  const parsed = streamTokenRequestSchema.parse({
    runId: '64b7f5086f1f8e9f0f000001',
    lastEventId: '12'
  });

  assert.equal(parsed.lastEventId, 12);
});
