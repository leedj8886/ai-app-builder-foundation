import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentJobProcessor } from './createWorker';
import type { ModelClient } from './types';
import type { ProjectValidator } from './validator';

const modelClient = {} as ModelClient;
const validator = {} as ProjectValidator;

test('createAgentJobProcessor rejects unsupported job names', async () => {
  const processor = createAgentJobProcessor({ modelClient, validator });
  await assert.rejects(
    processor({ name: 'unknown', data: { runId: 'run-1' } }),
    /Unsupported job name: unknown/
  );
});

test('createAgentJobProcessor delegates agent-run jobs with injected dependencies', async () => {
  const calls: unknown[][] = [];
  const processor = createAgentJobProcessor({
    modelClient,
    validator,
    processRun: async (...args) => {
      calls.push(args);
    }
  });
  const data = { runId: 'run-1' };

  await processor({ name: 'agent-run', data });

  assert.deepEqual(calls, [[data, modelClient, validator]]);
});

test('createAgentJobProcessor routes retry-validation jobs separately', async () => {
  const calls: unknown[][] = [];
  const data = {
    runId: 'run-2',
    kind: 'retry-validation' as const,
    candidateId: 'candidate-1'
  };
  const processor = createAgentJobProcessor({
    modelClient,
    validator,
    processValidation: async (...args) => {
      calls.push(args);
    }
  });

  await processor({ name: 'retry-validation', data });

  assert.deepEqual(calls, [[data, validator]]);
});
