import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { once } from 'node:events';
import request from 'supertest';
import { createApp } from '../app';
import { emitAgentEvent } from '../agent/eventBus';
import { getAgentRunQueue } from '../agent/queue';
import { generateToken } from '../middleware/auth';
import { AgentEvent } from '../models/AgentEvent';
import { AgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { User } from '../models/User';
import { ValidationCandidate } from '../models/ValidationCandidate';
import { ProjectBranch } from '../models/ProjectBranch';
import { ensureMainBranch } from '../branches/branchService';
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';

let environment: IntegrationEnvironment;
const app = createApp();

before(async () => {
  environment = await createIntegrationEnvironment();
});

beforeEach(async () => {
  await environment.reset();
});

after(async () => {
  await environment.close();
});

const fixtures = async () => {
  const [owner, stranger] = await User.create([
    { email: 'owner@example.test', password: 'password', name: 'Owner' },
    { email: 'stranger@example.test', password: 'password', name: 'Stranger' }
  ]);
  const [{ workspace }] = await Promise.all([
    ensureDefaultWorkspaceForUser(owner._id),
    ensureDefaultWorkspaceForUser(stranger._id)
  ]);
  const [project, otherProject] = await Project.create([
    { workspaceId: workspace._id, userId: owner._id, name: 'Owner project' },
    { workspaceId: workspace._id, userId: owner._id, name: 'Other project' }
  ]);

  return {
    owner,
    stranger,
    project,
    otherProject,
    ownerToken: generateToken(owner._id.toString()),
    strangerToken: generateToken(stranger._id.toString())
  };
};

const createRun = async (
  userId: typeof User.prototype._id,
  projectId: typeof Project.prototype._id,
  status: 'queued' | 'running' = 'running'
) => AgentRun.create({
  userId,
  projectId,
  prompt: 'Build a dashboard',
  status,
  mode: 'create',
  baseSnapshotRevision: 0,
  maxRepairAttempts: 2,
  model: 'test-model'
});

test('Project creation creates one main Branch', async () => {
  const user = await User.create({
    email: 'branch-owner@example.test',
    password: 'password',
    name: 'Branch owner'
  });
  const token = generateToken(user._id.toString());

  const response = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Branched project' })
    .expect(201);

  const branches = await ProjectBranch.find({
    projectId: response.body.project._id
  });
  assert.equal(branches.length, 1);
  assert.equal(branches[0]?.name, 'main');
  assert.equal(branches[0]?.headVersion, 0);
});

test('Chat creation binds to main or an explicitly selected Branch', async () => {
  const { ownerToken, project } = await fixtures();
  const main = await ensureMainBranch(project);
  const feature = await ProjectBranch.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    name: 'feature',
    headVersion: 0
  });

  const first = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ projectId: project._id, titleSeed: 'Main chat' })
    .expect(201);
  const second = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id,
      branchId: feature._id,
      titleSeed: 'Feature chat'
    })
    .expect(201);

  assert.equal(first.body.chat.branchId, main._id.toString());
  assert.equal(second.body.chat.branchId, feature._id.toString());
});

test('Branch creation can start from a validated Snapshot', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const sourceRun = await createRun(owner._id, project._id);
  const snapshot = await ProjectSnapshot.create({
    userId: owner._id,
    projectId: project._id,
    sourceRunId: sourceRun._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Branch point'
  });

  const response = await request(app)
    .post(`/api/projects/${project._id}/branches`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'experiment', fromSnapshotId: snapshot._id })
    .expect(201);

  assert.equal(response.body.branch.name, 'experiment');
  assert.equal(
    response.body.branch.headSnapshotId,
    snapshot._id.toString()
  );
  assert.equal(response.body.branch.headVersion, 0);
});

test('authenticated run creation persists its event and BullMQ job', async () => {
  const { ownerToken, project } = await fixtures();
  const response = await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ projectId: project._id.toString(), prompt: 'Build a dashboard' })
    .expect(201);

  assert.equal(response.body.run.status, 'queued');
  assert.equal(await AgentRun.countDocuments({ _id: response.body.run._id }), 1);
  assert.equal(await AgentEvent.countDocuments({
    runId: response.body.run._id,
    type: 'run.created'
  }), 1);
  assert.ok(await getAgentRunQueue().getJob(response.body.run._id));
});

test('retry validation creates a queued Run without regenerating a Chat message', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const sourceRun = await AgentRun.create({
    userId: owner._id,
    projectId: project._id,
    prompt: 'Build a dashboard',
    status: 'failed',
    mode: 'create',
    baseSnapshotRevision: 0,
    maxRepairAttempts: 2,
    model: 'test-model',
    retryable: true
  });
  const candidate = await ValidationCandidate.create({
    userId: owner._id,
    projectId: project._id,
    sourceRunId: sourceRun._id,
    files: [],
    packageJson: {
      dependencies: {},
      devDependencies: {},
      scripts: {}
    },
    summary: 'Candidate',
    expiresAt: new Date(Date.now() + 60_000)
  });
  sourceRun.validationCandidateId = candidate._id;
  await sourceRun.save();

  const response = await request(app)
    .post(`/api/agent/runs/${sourceRun._id}/retry-validation`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(201);

  assert.equal(response.body.run.status, 'queued');
  assert.equal(response.body.run.retryOfRunId, sourceRun._id.toString());
  assert.equal(response.body.run.validationCandidateId, candidate._id.toString());
});

test('Chat creation stores project metadata without an assistant response', async () => {
  const { ownerToken, project } = await fixtures();
  const response = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id.toString(),
      titleSeed: 'Build a support dashboard'
    })
    .expect(201);

  assert.equal(response.body.chat.projectId, project._id.toString());
  assert.equal(response.body.chat.title, 'Build a support dashboard');
  assert.deepEqual(response.body.chat.messages, []);
  assert.equal(
    (await Project.findById(project._id))?.chatIds.some(
      chatId => chatId.toString() === response.body.chat._id
    ),
    true
  );
});

test('Chat list returns owned records newest first with bounded previews', async () => {
  const { ownerToken, owner, stranger, project } = await fixtures();
  const longPrompt = 'x'.repeat(220);
  const [older, newer] = await Chat.create([
    {
      userId: owner._id,
      projectId: project._id,
      title: 'Older chat',
      messages: [
        {
          id: 'system-message',
          role: 'system',
          content: 'ignored',
          createdAt: new Date('2026-07-25T10:00:00.000Z')
        },
        {
          id: 'user-message',
          role: 'user',
          content: longPrompt,
          createdAt: new Date('2026-07-25T10:01:00.000Z')
        }
      ]
    },
    {
      userId: owner._id,
      projectId: project._id,
      title: 'Newer chat',
      messages: []
    }
  ]);
  await Chat.create({
    userId: stranger._id,
    title: 'Stranger chat',
    messages: []
  });
  await Chat.updateOne(
    { _id: older._id },
    { updatedAt: new Date('2026-07-25T11:00:00.000Z') },
    { timestamps: false }
  );
  await Chat.updateOne(
    { _id: newer._id },
    { updatedAt: new Date('2026-07-25T12:00:00.000Z') },
    { timestamps: false }
  );

  const response = await request(app)
    .get('/api/chat')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  assert.deepEqual(
    response.body.chats.map((chat: { title: string }) => chat.title),
    ['Newer chat', 'Older chat']
  );
  assert.equal(response.body.chats[0].preview, undefined);
  assert.equal(response.body.chats[1].preview, `${'x'.repeat(157)}...`);
  assert.equal(response.body.chats[1].preview.length, 160);
  assert.equal('messages' in response.body.chats[1], false);
});

test('creating a Chat-associated Run appends one user message', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    title: 'Support dashboard',
    messages: []
  });

  const response = await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id.toString(),
      chatId: chat._id.toString(),
      prompt: 'Add ticket filters',
      mode: 'create'
    })
    .expect(201);

  const refreshed = await Chat.findById(chat._id).lean();
  assert.equal(refreshed?.messages.length, 1);
  assert.equal(refreshed?.messages[0]?.role, 'user');
  assert.equal(refreshed?.messages[0]?.content, 'Add ticket filters');
  assert.equal(response.body.run.chatId, chat._id.toString());
});

test('Chat timeline aggregates owned Runs with stable cursor pagination', async () => {
  const {
    ownerToken,
    strangerToken,
    owner,
    project
  } = await fixtures();
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    title: 'Timeline chat',
    messages: []
  });
  const createdAt = [
    new Date('2026-07-25T10:00:00.000Z'),
    new Date('2026-07-25T10:01:00.000Z'),
    new Date('2026-07-25T10:02:00.000Z')
  ];
  const [oldest, completed, failed] = await AgentRun.create([
    {
      userId: owner._id,
      projectId: project._id,
      chatId: chat._id,
      prompt: 'Create the first version',
      status: 'completed',
      mode: 'create',
      baseSnapshotRevision: 0,
      maxRepairAttempts: 2,
      model: 'test-model',
      startedAt: new Date('2026-07-25T10:00:01.000Z'),
      completedAt: new Date('2026-07-25T10:00:05.000Z'),
      createdAt: createdAt[0]
    },
    {
      userId: owner._id,
      projectId: project._id,
      chatId: chat._id,
      prompt: 'Add an activity list',
      status: 'completed',
      mode: 'edit',
      baseSnapshotRevision: 1,
      maxRepairAttempts: 2,
      model: 'test-model',
      startedAt: new Date('2026-07-25T10:01:01.000Z'),
      completedAt: new Date('2026-07-25T10:01:08.000Z'),
      createdAt: createdAt[1]
    },
    {
      userId: owner._id,
      projectId: project._id,
      chatId: chat._id,
      prompt: 'Add a broken widget',
      status: 'failed',
      mode: 'edit',
      baseSnapshotRevision: 2,
      maxRepairAttempts: 2,
      model: 'test-model',
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Type-check failed'
      },
      startedAt: new Date('2026-07-25T10:02:01.000Z'),
      completedAt: new Date('2026-07-25T10:02:04.000Z'),
      createdAt: createdAt[2]
    }
  ]);
  assert.ok(oldest && completed && failed);

  await AgentEvent.create([
    {
      runId: completed._id,
      userId: owner._id,
      projectId: project._id,
      type: 'run.started',
      sequence: 1,
      message: 'Worker started',
      createdAt: new Date('2026-07-25T10:01:01.000Z')
    },
    {
      runId: completed._id,
      userId: owner._id,
      projectId: project._id,
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
      createdAt: new Date('2026-07-25T10:01:03.000Z')
    },
    {
      runId: completed._id,
      userId: owner._id,
      projectId: project._id,
      type: 'file.changed',
      sequence: 3,
      message: 'update src/App.tsx',
      payload: { operation: 'update', path: 'src/App.tsx' },
      createdAt: new Date('2026-07-25T10:01:05.000Z')
    },
    {
      runId: completed._id,
      userId: owner._id,
      projectId: project._id,
      type: 'file.changed',
      sequence: 4,
      message: 'update src/App.tsx',
      payload: { operation: 'update', path: 'src/App.tsx' },
      createdAt: new Date('2026-07-25T10:01:06.000Z')
    }
  ]);
  const snapshot = await ProjectSnapshot.create({
    userId: owner._id,
    projectId: project._id,
    sourceRunId: completed._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Added a compact activity list'
  });
  completed.resultSnapshotId = snapshot._id;
  await completed.save();

  const first = await request(app)
    .get(`/api/chat/${chat._id}/timeline?limit=2`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  assert.equal(first.body.turns.length, 2);
  assert.equal(first.body.pageInfo.hasMore, true);
  assert.equal(first.body.turns[0].runId, completed._id.toString());
  assert.equal(first.body.turns[1].runId, failed._id.toString());
  assert.equal(first.body.turns[0].agent.plan.steps[0].title, 'Update App');
  assert.deepEqual(first.body.turns[0].snapshot.changedFiles, ['src/App.tsx']);
  assert.equal(first.body.turns[1].agent.error.message, 'Type-check failed');
  assert.ok(first.body.pageInfo.nextBefore);

  const older = await request(app)
    .get(`/api/chat/${chat._id}/timeline`)
    .query({ limit: 2, before: first.body.pageInfo.nextBefore })
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  assert.equal(older.body.turns.length, 1);
  assert.equal(older.body.turns[0].runId, oldest._id.toString());
  assert.equal(older.body.pageInfo.hasMore, false);

  await request(app)
    .get(`/api/chat/${chat._id}/timeline`)
    .set('Authorization', `Bearer ${strangerToken}`)
    .expect(404);
});

test('agent routes hide projects runs snapshots and cross-project chats from other owners', async () => {
  const {
    owner,
    strangerToken,
    project,
    otherProject
  } = await fixtures();
  const run = await createRun(owner._id, project._id);
  const chat = await Chat.create({
    userId: owner._id,
    projectId: otherProject._id,
    title: 'Other chat',
    messages: []
  });
  const snapshot = await ProjectSnapshot.create({
    userId: owner._id,
    projectId: project._id,
    sourceRunId: run._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Owner snapshot'
  });

  const authorization = `Bearer ${strangerToken}`;
  await request(app).post('/api/agent/runs').set('Authorization', authorization)
    .send({ projectId: project._id.toString(), prompt: 'Steal it' }).expect(404);
  await request(app).get(`/api/agent/runs/${run._id}`).set('Authorization', authorization).expect(404);
  await request(app).get(`/api/agent/runs/${run._id}/events`).set('Authorization', authorization).expect(404);
  await request(app).get(`/api/projects/${project._id}/snapshots/${snapshot._id}`)
    .set('Authorization', authorization).expect(404);
  await request(app).post(`/api/projects/${project._id}/snapshots/${snapshot._id}/rollback`)
    .set('Authorization', authorization).expect(404);

  const ownerToken = generateToken(owner._id.toString());
  await request(app).post('/api/agent/runs').set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id.toString(),
      chatId: chat._id.toString(),
      prompt: 'Wrong project chat'
    }).expect(404);
  assert.equal((await Chat.findById(chat._id))?.messages.length, 0);
});

interface StreamEvent {
  sequence: number;
  type: string;
}

const readStreamEvents = async (
  server: Server,
  path: string,
  token: string,
  count: number,
  lastEventId?: number,
  afterOpen?: () => Promise<void>
): Promise<StreamEvent[]> => {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(lastEventId === undefined ? {} : { 'Last-Event-ID': String(lastEventId) })
    },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.ok(response.body);
  await afterOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = '';

  try {
    while (events.length < count) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (data) events.push(JSON.parse(data.slice(6)) as StreamEvent);
      }
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }

  return events;
};

test('SSE delivers backlog live events once and resumes after Last-Event-ID', async () => {
  const { owner, ownerToken, project } = await fixtures();
  const run = await createRun(owner._id, project._id);
  for (const type of ['run.created', 'run.started', 'agent.plan'] as const) {
    await emitAgentEvent({
      runId: run._id,
      userId: owner._id,
      projectId: project._id,
      type,
      message: type
    });
  }

  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const initial = await readStreamEvents(
      server,
      `/api/agent/runs/${run._id}/events`,
      ownerToken,
      4,
      undefined,
      async () => {
        await emitAgentEvent({
          runId: run._id,
          userId: owner._id,
          projectId: project._id,
          type: 'agent.step',
          message: 'live'
        });
      }
    );
    assert.deepEqual(initial.map((event) => event.sequence), [1, 2, 3, 4]);

    const resumed = await readStreamEvents(
      server,
      `/api/agent/runs/${run._id}/events`,
      ownerToken,
      2,
      2
    );
    assert.deepEqual(resumed.map((event) => event.sequence), [3, 4]);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('cancelling a queued run persists one cancellation event', async () => {
  const { owner, ownerToken, project } = await fixtures();
  const run = await createRun(owner._id, project._id, 'queued');

  const response = await request(app)
    .post(`/api/agent/runs/${run._id}/cancel`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  assert.equal(response.body.run.status, 'cancelled');
  assert.equal(await AgentEvent.countDocuments({
    runId: run._id,
    type: 'run.cancelled'
  }), 1);
});
