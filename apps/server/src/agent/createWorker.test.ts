import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DelayedError } from 'bullmq';
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
  const controller = new AbortController();
  const processor = createAgentJobProcessor({
    modelClient,
    validator,
    loadRunStatus: async () => 'queued',
    acquireBranchExecution: async () => ({
      signal: controller.signal,
      assertHeld: async () => undefined,
      release: async () => undefined
    }),
    processRun: async (...args) => {
      calls.push(args);
    }
  });
  const data = { runId: 'run-1' };

  await processor({ name: 'agent-run', data });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 3), [data, modelClient, validator]);
  assert.equal(
    (calls[0]?.[3] as { signal?: AbortSignal }).signal,
    controller.signal
  );
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
    loadRunStatus: async () => 'queued',
    acquireBranchExecution: async () => ({
      signal: new AbortController().signal,
      assertHeld: async () => undefined,
      release: async () => undefined
    }),
    processValidation: async (...args) => {
      calls.push(args);
    }
  });

  await processor({ name: 'retry-validation', data });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 2), [data, validator]);
});

test('processor delays a Run when another Run owns the Branch lease', async () => {
  const moved: Array<{ timestamp: number; token?: string }> = [];
  let processCalls = 0;
  const processRun = async () => {
    processCalls += 1;
  };
  const processor = createAgentJobProcessor({
    modelClient,
    validator,
    processRun,
    loadRunStatus: async () => 'queued',
    markRunWaiting: async () => undefined,
    acquireBranchExecution: async () => null,
    branchRetryDelayMs: 2_000
  });

  await assert.rejects(
    processor({
      name: 'agent-run',
      data: { runId: 'run-2' },
      moveToDelayed: async (timestamp: number, token?: string) => {
        moved.push({ timestamp, token });
      }
    } as never, 'worker-token'),
    DelayedError
  );

  assert.equal(processCalls, 0);
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.token, 'worker-token');
});

test('processor releases an acquired Branch lease after processing', async () => {
  let released = 0;
  const processor = createAgentJobProcessor({
    modelClient,
    validator,
    loadRunStatus: async () => 'queued',
    processRun: async (_data, _model, _validator, execution) => {
      await execution?.assertHeld();
    },
    acquireBranchExecution: async () => ({
      signal: new AbortController().signal,
      assertHeld: async () => undefined,
      release: async () => { released += 1; }
    })
  });

  await processor({
    name: 'agent-run',
    data: { runId: 'run-1' }
  } as never);

  assert.equal(released, 1);
});
