import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Worker } from 'bullmq';
import type { ModelClient } from '../agent/types';
import { createAgentWorker } from '../agent/createWorker';
import { emitAgentEvent } from '../agent/eventBus';
import { processAgentRun } from '../agent/orchestrator';
import { enqueueAgentRun } from '../agent/queue';
import { createFakeModelClient } from '../agent/testing/fakeModelClient';
import {
  createFailOnceValidator,
  createPassingValidator
} from '../agent/testing/fakeValidator';
import { AgentEvent } from '../models/AgentEvent';
import { AgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { ProjectBranch } from '../models/ProjectBranch';
import { User } from '../models/User';
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';
import { ensureMainBranch } from '../branches/branchService';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';

let environment: IntegrationEnvironment;

before(async () => {
  environment = await createIntegrationEnvironment();
});

beforeEach(async () => {
  await environment.reset();
});

after(async () => {
  await environment.close();
});

const createQueuedRun = async () => {
  const user = await User.create({
    email: `worker-${crypto.randomUUID()}@example.test`,
    password: 'password',
    name: 'Worker owner'
  });
  const { workspace } = await ensureDefaultWorkspaceForUser(user._id);
  const project = await Project.create({
    workspaceId: workspace._id,
    userId: user._id,
    name: 'Worker project'
  });
  const branch = await ensureMainBranch(project);
  const run = await AgentRun.create({
    userId: user._id,
    workspaceId: workspace._id,
    projectId: project._id,
    branchId: branch._id,
    prompt: 'Build a dashboard',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'fake-model'
  });
  await emitAgentEvent({
    runId: run._id,
    userId: user._id,
    projectId: project._id,
    type: 'run.created',
    message: 'Agent run queued'
  });

  return { user, project, run };
};

const createQueuedChatRun = async () => {
  const fixture = await createQueuedRun();
  const chat = await Chat.create({
    userId: fixture.user._id,
    projectId: fixture.project._id,
    branchId: fixture.run.branchId,
    title: 'Worker chat',
    messages: [{
      id: crypto.randomUUID(),
      role: 'user',
      content: fixture.run.prompt,
      createdAt: new Date()
    }]
  });
  fixture.run.chatId = chat._id;
  await fixture.run.save();

  return { ...fixture, chat };
};

const waitForTerminalRun = async (runId: string) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const run = await AgentRun.findById(runId);
    if (run && [
      'completed',
      'completed_with_conflict',
      'failed',
      'cancelled'
    ].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for worker run ${runId}`);
};

const withWorker = async (
  modelClient: ModelClient,
  validator: ReturnType<typeof createPassingValidator> | ReturnType<typeof createFailOnceValidator>,
  action: (worker: Worker) => Promise<void>
) => {
  const worker = createAgentWorker({
    queueName: environment.queueName,
    connection: { url: environment.redisUrl },
    modelClient,
    validator,
    concurrency: 2
  });
  try {
    await worker.waitUntilReady();
    await action(worker);
  } finally {
    await worker.close();
  }
};

test('two Runs on one Branch never execute their models concurrently', async () => {
  const first = await createQueuedRun();
  const branch = await ensureMainBranch(first.project);
  const secondRun = await AgentRun.create({
    userId: first.user._id,
    workspaceId: first.project.workspaceId,
    projectId: first.project._id,
    branchId: branch._id,
    prompt: 'Second change',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'fake-model'
  });

  let active = 0;
  let maxActive = 0;
  const model = createFakeModelClient();
  const originalPlan = model.generatePlan;
  model.generatePlan = async input => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      return await originalPlan(input);
    } finally {
      active -= 1;
    }
  };

  await Promise.all([
    enqueueAgentRun(first.run._id.toString()),
    enqueueAgentRun(secondRun._id.toString())
  ]);
  await withWorker(model, createPassingValidator(), async () => {
    const completed = await Promise.all([
      waitForTerminalRun(first.run._id.toString()),
      waitForTerminalRun(secondRun._id.toString())
    ]);
    assert.deepEqual(
      completed.map(run => run.status),
      ['completed', 'completed']
    );
  });

  assert.equal(maxActive, 1);
});

test('completed Run advances only its Branch Head', async () => {
  const { project, run } = await createQueuedRun();
  const main = await ensureMainBranch(project);
  const other = await ProjectBranch.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    name: 'other',
    headVersion: 0
  });

  await enqueueAgentRun(run._id.toString());
  await withWorker(
    createFakeModelClient(),
    createPassingValidator(),
    async () => {
      await waitForTerminalRun(run._id.toString());
    }
  );

  const [completed, refreshedMain, refreshedOther] = await Promise.all([
    AgentRun.findById(run._id),
    ProjectBranch.findById(main._id),
    ProjectBranch.findById(other._id)
  ]);
  assert.equal(completed?.status, 'completed');
  assert.equal(
    refreshedMain?.headSnapshotId?.toString(),
    completed?.resultSnapshotId?.toString()
  );
  assert.equal(refreshedMain?.headVersion, 1);
  assert.equal(refreshedOther?.headVersion, 0);
});

test('stale Run keeps its Snapshot and completes with conflict', async () => {
  const fixture = await createQueuedRun();
  const branch = await ensureMainBranch(fixture.project);
  const winningSnapshot = await ProjectSnapshot.create({
    userId: fixture.user._id,
    projectId: fixture.project._id,
    sourceRunId: fixture.run._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Winning snapshot'
  });
  branch.headSnapshotId = winningSnapshot._id;
  branch.headVersion = 1;
  await branch.save();

  await processAgentRun(
    { runId: fixture.run._id.toString() },
    createFakeModelClient(),
    createPassingValidator(),
    { assertHeld: async () => undefined }
  );

  const [run, refreshedBranch, resultSnapshot] = await Promise.all([
    AgentRun.findById(fixture.run._id),
    ProjectBranch.findById(branch._id),
    ProjectSnapshot.findOne({ sourceRunId: fixture.run._id }).sort({
      createdAt: -1
    })
  ]);
  assert.equal(run?.status, 'completed_with_conflict');
  assert.ok(run?.resultSnapshotId);
  assert.ok(resultSnapshot);
  assert.equal(
    refreshedBranch?.headSnapshotId?.toString(),
    winningSnapshot._id.toString()
  );
});

test('BullMQ Create run seeds required files when the model only updates App', async () => {
  const { run } = await createQueuedRun();
  const modelClient: ModelClient = {
    generatePlan: async input => {
      assert.deepEqual(
        input.context.files.map(file => file.path),
        ['index.html', 'src/App.tsx', 'src/index.css', 'src/main.tsx', 'tsconfig.json']
      );
      return {
        value: {
          summary: 'Build app',
          steps: [{
            title: 'Update App',
            intent: 'Render the app',
            filesLikelyTouched: ['src/App.tsx']
          }],
          assumptions: []
        }
      };
    },
    generateFiles: async () => ({
      value: {
        message: 'Updated App',
        operations: [{
          type: 'update',
          path: 'src/App.tsx',
          content: 'export default function App() { return <main>Real app</main>; }'
        }],
        dependencies: {},
        devDependencies: {}
      }
    }),
    repairFiles: async () => {
      throw new Error('repair should not run');
    }
  };

  await enqueueAgentRun(run._id.toString());
  await withWorker(modelClient, createPassingValidator(), async () => {
    const completed = await waitForTerminalRun(run._id.toString());
    assert.equal(completed.status, 'completed');
  });

  const snapshot = await ProjectSnapshot.findOne({ sourceRunId: run._id });
  assert.deepEqual(
    snapshot?.files.map(file => file.path),
    ['index.html', 'package.json', 'src/App.tsx', 'src/index.css', 'src/main.tsx', 'tsconfig.json']
  );
});

test('BullMQ worker completes a create run and activates one passing snapshot', async () => {
  const { project, run } = await createQueuedRun();
  const modelClient = createFakeModelClient();

  await enqueueAgentRun(run._id.toString());
  await withWorker(modelClient, createPassingValidator(), async () => {
    const completed = await waitForTerminalRun(run._id.toString());
    assert.equal(completed.status, 'completed');
  });

  const [completed, snapshot, refreshedProject, events] = await Promise.all([
    AgentRun.findById(run._id),
    ProjectSnapshot.findOne({ sourceRunId: run._id }),
    Project.findById(project._id),
    AgentEvent.find({ runId: run._id }).sort({ sequence: 1 })
  ]);
  assert.ok(completed?.resultSnapshotId);
  assert.equal(snapshot?.validation.status, 'passed');
  assert.ok(snapshot?.files.some((file) => file.path === 'src/App.tsx'));
  assert.equal(refreshedProject?.activeSnapshotId?.toString(), snapshot?._id.toString());
  assert.equal(refreshedProject?.activeSnapshotRevision, 1);
  assert.deepEqual(modelClient.calls, { plan: 1, generate: 1, repair: 0 });

  const lifecycle = events.map((event) => event.type).filter((type) => type !== 'file.changed');
  assert.deepEqual(lifecycle, [
    'run.created',
    'run.started',
    'agent.step',
    'agent.plan',
    'agent.step',
    'validation.started',
    'validation.passed',
    'run.completed'
  ]);
  assert.equal(events.filter((event) => event.type === 'file.changed').length, 4);
});

test('BullMQ worker repairs one failed validation before persisting once', async () => {
  const { project, run } = await createQueuedRun();
  const modelClient = createFakeModelClient();
  const validator = createFailOnceValidator();

  await enqueueAgentRun(run._id.toString());
  await withWorker(modelClient, validator, async () => {
    const completed = await waitForTerminalRun(run._id.toString());
    assert.equal(completed.status, 'completed');
  });

  const [completed, snapshots, refreshedProject, repairEvents] = await Promise.all([
    AgentRun.findById(run._id),
    ProjectSnapshot.find({ sourceRunId: run._id }),
    Project.findById(project._id),
    AgentEvent.countDocuments({ runId: run._id, type: 'repair.started' })
  ]);
  assert.equal(completed?.attempt, 1);
  assert.equal(modelClient.calls.repair, 1);
  assert.equal(validator.calls, 2);
  assert.equal(repairEvents, 1);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.validation.status, 'passed');
  assert.equal(refreshedProject?.activeSnapshotRevision, 1);
});

test('BullMQ worker appends one assistant turn to its Chat', async () => {
  const { project, run, chat } = await createQueuedChatRun();
  const modelClient = createFakeModelClient();
  const validator = createPassingValidator();

  await enqueueAgentRun(run._id.toString());
  await withWorker(modelClient, validator, async () => {
    const completed = await waitForTerminalRun(run._id.toString());
    assert.equal(completed.status, 'completed');
  });

  const refreshed = await Chat.findById(chat._id).lean();
  assert.equal(refreshed?.messages.length, 2);
  assert.equal(refreshed?.messages[0]?.role, 'user');
  assert.equal(refreshed?.messages[1]?.role, 'assistant');
  assert.match(refreshed?.messages[1]?.content ?? '', /Snapshot:/);

  await processAgentRun(
    { runId: run._id.toString() },
    modelClient,
    validator
  );
  assert.equal((await Chat.findById(chat._id))?.messages.length, 2);
  assert.equal(project._id.toString(), run.projectId.toString());
});

test('BullMQ worker leaves a cancelled queued run untouched', async () => {
  const { run } = await createQueuedRun();
  const modelClient = createFakeModelClient();
  await AgentRun.updateOne(
    { _id: run._id },
    { $set: { status: 'cancelled', completedAt: new Date() } }
  );
  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: 'run.cancelled',
    message: 'Agent run cancelled'
  });

  await withWorker(modelClient, createPassingValidator(), async (worker) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for cancelled job')), 20_000);
      worker.once('completed', () => {
        clearTimeout(timer);
        resolve();
      });
      worker.once('failed', (_job, error) => {
        clearTimeout(timer);
        reject(error);
      });
      void enqueueAgentRun(run._id.toString()).catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  });

  const [cancelled, startedEvents, snapshots] = await Promise.all([
    AgentRun.findById(run._id),
    AgentEvent.countDocuments({ runId: run._id, type: 'run.started' }),
    ProjectSnapshot.countDocuments({ sourceRunId: run._id })
  ]);
  assert.equal(cancelled?.status, 'cancelled');
  assert.equal(startedEvents, 0);
  assert.equal(snapshots, 0);
  assert.deepEqual(modelClient.calls, { plan: 0, generate: 0, repair: 0 });
});
