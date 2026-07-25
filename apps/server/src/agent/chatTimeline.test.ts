import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatTimelineTurn,
  decodeTimelineCursor,
  encodeTimelineCursor
} from './chatTimeline';

test('timeline cursor round-trips createdAt and id', () => {
  const boundary = {
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    id: '66a3f4402f24b17418d55abc'
  };

  assert.deepEqual(
    decodeTimelineCursor(encodeTimelineCursor(boundary)),
    boundary
  );
});

test('timeline cursor rejects malformed input', () => {
  assert.throws(
    () => decodeTimelineCursor('not-a-valid-cursor'),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'INVALID_TIMELINE_CURSOR');
      return true;
    }
  );
});

test('projects a completed Run into an auditable timeline turn', () => {
  const turn = buildChatTimelineTurn({
    run: {
      _id: '66a3f4402f24b17418d55abc',
      prompt: 'Add an activity list',
      status: 'completed',
      model: 'deepseek-chat',
      createdAt: new Date('2026-07-25T10:00:00.000Z'),
      startedAt: new Date('2026-07-25T10:00:01.000Z'),
      completedAt: new Date('2026-07-25T10:00:09.000Z')
    },
    events: [
      {
        type: 'run.started',
        sequence: 1,
        message: 'Worker started',
        createdAt: new Date('2026-07-25T10:00:01.000Z')
      },
      {
        type: 'agent.plan',
        sequence: 2,
        message: 'Add activity UI',
        payload: {
          summary: 'Add activity UI',
          steps: [{
            title: 'Update App',
            intent: 'Render recent activity',
            filesLikelyTouched: ['src/App.tsx']
          }],
          assumptions: []
        },
        createdAt: new Date('2026-07-25T10:00:03.000Z')
      },
      {
        type: 'file.changed',
        sequence: 3,
        message: 'update src/App.tsx',
        payload: { operation: 'update', path: 'src/App.tsx' },
        createdAt: new Date('2026-07-25T10:00:05.000Z')
      },
      {
        type: 'file.changed',
        sequence: 4,
        message: 'update src/App.tsx',
        payload: { operation: 'update', path: 'src/App.tsx' },
        createdAt: new Date('2026-07-25T10:00:06.000Z')
      }
    ],
    snapshot: {
      _id: '66a3f4402f24b17418d55abd',
      summary: 'Added a compact activity list'
    }
  });

  assert.equal(turn.userMessage.content, 'Add an activity list');
  assert.equal(turn.agent.durationMs, 8_000);
  assert.equal(turn.agent.planningDurationMs, 2_000);
  assert.equal(turn.agent.plan?.steps[0]?.title, 'Update App');
  assert.deepEqual(turn.snapshot?.changedFiles, ['src/App.tsx']);
  assert.equal(turn.snapshot?.summary, 'Added a compact activity list');
  assert.deepEqual(
    turn.agent.events.map(event => event.sequence),
    [1, 2, 3, 4]
  );
});

test('preserves failed and incomplete Runs without requiring a Snapshot', () => {
  const turn = buildChatTimelineTurn({
    run: {
      _id: '66a3f4402f24b17418d55abe',
      prompt: 'Break nothing',
      status: 'failed',
      model: 'deepseek-chat',
      error: { code: 'VALIDATION_FAILED', message: 'Type-check failed' },
      createdAt: new Date('2026-07-25T10:01:00.000Z')
    },
    events: [],
    snapshot: null
  });

  assert.equal(turn.agent.status, 'failed');
  assert.equal(turn.agent.error?.message, 'Type-check failed');
  assert.equal(turn.snapshot, undefined);
});
