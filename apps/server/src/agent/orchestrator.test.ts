import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhaseOneWorkerEvents } from './orchestrator';

test('buildPhaseOneWorkerEvents returns fake processing steps', () => {
  const events = buildPhaseOneWorkerEvents();

  assert.deepEqual(events, [
    { type: 'run.started', message: 'Agent run started' },
    { type: 'agent.step', message: 'Phase 1 worker received the run' },
    { type: 'run.completed', message: 'Phase 1 fake worker completed the run' }
  ]);
});
