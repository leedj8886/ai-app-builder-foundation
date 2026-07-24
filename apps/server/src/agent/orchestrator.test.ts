import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhaseOneWorkerEvents,
  buildPhaseTwoWorkerEvents
} from './orchestrator';

test('buildPhaseOneWorkerEvents returns fake processing steps', () => {
  const events = buildPhaseOneWorkerEvents();

  assert.deepEqual(events, [
    { type: 'run.started', message: 'Agent run started' },
    { type: 'agent.step', message: 'Phase 1 worker received the run' },
    { type: 'run.completed', message: 'Phase 1 fake worker completed the run' }
  ]);
});

test('buildPhaseTwoWorkerEvents returns snapshot processing steps', () => {
  const events = buildPhaseTwoWorkerEvents();

  assert.deepEqual(events, [
    { type: 'run.started', message: 'Agent run started' },
    { type: 'agent.step', message: 'Generating structured file operations' },
    { type: 'agent.step', message: 'Persisting project snapshot' },
    { type: 'run.completed', message: 'Agent run completed with a project snapshot' }
  ]);
});
