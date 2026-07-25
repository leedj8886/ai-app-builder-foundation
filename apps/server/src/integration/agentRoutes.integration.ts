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
  const [project, otherProject] = await Project.create([
    { userId: owner._id, name: 'Owner project' },
    { userId: owner._id, name: 'Other project' }
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
