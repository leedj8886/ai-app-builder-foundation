import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRunChannel, serializeAgentEvent } from './eventBus';

test('agentRunChannel names channels by run id', () => {
  assert.equal(agentRunChannel('abc123'), 'agent-run:abc123');
});

test('serializeAgentEvent emits public event fields', () => {
  const serialized = serializeAgentEvent({
    _id: 'event-id',
    runId: 'run-id',
    sequence: 3,
    type: 'agent.step',
    message: 'Planning request',
    payload: { phase: 'planning' },
    createdAt: new Date('2026-07-24T00:00:00.000Z')
  });

  assert.deepEqual(serialized, {
    id: 'event-id',
    runId: 'run-id',
    sequence: 3,
    type: 'agent.step',
    message: 'Planning request',
    payload: { phase: 'planning' },
    createdAt: '2026-07-24T00:00:00.000Z'
  });
});
