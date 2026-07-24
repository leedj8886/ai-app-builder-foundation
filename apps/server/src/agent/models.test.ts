import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';

test('AgentRun model exposes required paths and indexes', () => {
  assert.ok(AgentRun.schema.path('userId'));
  assert.ok(AgentRun.schema.path('projectId'));
  assert.ok(AgentRun.schema.path('prompt'));
  assert.ok(AgentRun.schema.path('status'));

  const indexes = AgentRun.schema.indexes().map(([fields]) => fields);
  assert.deepEqual(indexes[0], { userId: 1, updatedAt: -1 });
  assert.deepEqual(indexes[1], { projectId: 1, updatedAt: -1 });
  assert.deepEqual(indexes[2], { status: 1, updatedAt: 1 });
});

test('AgentEvent model stores sequence per run', () => {
  assert.ok(AgentEvent.schema.path('runId'));
  assert.ok(AgentEvent.schema.path('sequence'));
  assert.ok(AgentEvent.schema.path('type'));

  const indexes = AgentEvent.schema.indexes().map(([fields]) => fields);
  assert.deepEqual(indexes[0], { runId: 1, sequence: 1 });
  assert.deepEqual(indexes[1], { userId: 1, createdAt: -1 });
});
