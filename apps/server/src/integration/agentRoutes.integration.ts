import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { once } from 'node:events';
import request from 'supertest';
import { Types } from 'mongoose';
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
import {
  createArtifactBackedCandidate,
  createArtifactBackedSnapshot
} from '../artifacts/testing';
import {
  getArtifactService,
  setArtifactServiceForTests
} from '../artifacts/runtime';
import type { ArtifactService } from '../artifacts/artifactService';
import { ArtifactManifest } from '../models/ArtifactManifest';

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
) => {
  const project = await Project.findById(projectId);
  assert.ok(project);
  const branch = await ensureMainBranch(project);
  return AgentRun.create({
    userId,
    workspaceId: project.workspaceId!,
    projectId,
    branchId: branch._id!,
    prompt: 'Build a dashboard',
    status,
    mode: 'create',
    baseSnapshotRevision: branch.headVersion,
    baseHeadVersion: branch.headVersion,
    maxRepairAttempts: 2,
    model: 'test-model'
  });
};

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
  assert.equal(response.body.project.settings.agentModelId, 'deepseek-default');
});

test('model catalog is public and does not expose credentials or endpoints', async () => {
  const response = await request(app).get('/api/models').expect(200);

  assert.equal(response.body.defaultModelId, 'deepseek-default');
  assert.equal(response.body.models[0].id, 'deepseek-default');
  assert.equal('baseURL' in response.body.models[0], false);
  assert.equal('apiKeyEnv' in response.body.models[0], false);
});

test('Project model assignment is validated and preserves other settings', async () => {
  const { ownerToken, project } = await fixtures();

  const updated = await request(app)
    .patch(`/api/projects/${project._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ settings: { agentModelId: 'deepseek-default' } })
    .expect(200);

  assert.equal(updated.body.project.settings.agentModelId, 'deepseek-default');
  assert.equal(updated.body.project.settings.framework, 'react');
  assert.equal(updated.body.project.settings.styling, 'tailwind');

  await request(app)
    .patch(`/api/projects/${project._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ settings: { agentModelId: 'unknown-model' } })
    .expect(400);
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
  const snapshot = await createArtifactBackedSnapshot({
    workspaceId: project.workspaceId!,
    branchId: sourceRun.branchId!,
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

test('Chat-associated Run captures its Branch Head baseline', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const sourceRun = await createRun(owner._id, project._id);
  const snapshot = await createArtifactBackedSnapshot({
    workspaceId: project.workspaceId!,
    branchId: sourceRun.branchId!,
    userId: owner._id,
    projectId: project._id,
    sourceRunId: sourceRun._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Feature base'
  });
  const branch = await ProjectBranch.create({
    workspaceId: project.workspaceId!,
    projectId: project._id,
    name: 'feature',
    headSnapshotId: snapshot._id,
    headVersion: 7
  });
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    branchId: branch._id,
    title: 'Feature chat',
    messages: []
  });

  const response = await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id,
      chatId: chat._id,
      prompt: 'Continue the feature',
      mode: 'edit'
    })
    .expect(201);

  assert.equal(response.body.run.workspaceId, project.workspaceId?.toString());
  assert.equal(response.body.run.branchId, branch._id.toString());
  assert.equal(response.body.run.baseSnapshotId, snapshot._id.toString());
  assert.equal(response.body.run.baseHeadVersion, 7);
});

test('Run creation rejects a Chat whose Branch is not in the Project', async () => {
  const { ownerToken, owner, project, otherProject } = await fixtures();
  const otherBranch = await ensureMainBranch(otherProject);
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    branchId: otherBranch._id,
    title: 'Invalid branch chat',
    messages: []
  });

  await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id,
      chatId: chat._id,
      prompt: 'Do not run'
    })
    .expect(404);
});

test('authenticated run creation persists its event and BullMQ job', async () => {
  const { ownerToken, project } = await fixtures();
  const response = await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ projectId: project._id.toString(), prompt: 'Build a dashboard' })
    .expect(201);

  assert.equal(response.body.run.status, 'queued');
  assert.equal(response.body.run.modelId, 'deepseek-default');
  assert.equal(response.body.run.modelProvider, 'deepseek');
  assert.equal(response.body.run.model, 'deepseek-v4-flash');
  assert.equal(await AgentRun.countDocuments({ _id: response.body.run._id }), 1);
  assert.equal(await AgentEvent.countDocuments({
    runId: response.body.run._id,
    type: 'run.created'
  }), 1);
  assert.ok(await getAgentRunQueue().getJob(response.body.run._id));
});

test('run creation rejects a model outside the configured catalog', async () => {
  const { ownerToken, project } = await fixtures();

  await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id.toString(),
      prompt: 'Build a dashboard',
      modelId: 'unknown-model'
    })
    .expect(400);
});

test('retry validation creates a queued Run without regenerating a Chat message', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const branch = await ensureMainBranch(project);
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    branchId: branch._id,
    title: 'Retry validation chat',
    messages: [{
      id: crypto.randomUUID(),
      role: 'user',
      content: 'Build a dashboard',
      createdAt: new Date()
    }]
  });
  const sourceRun = await AgentRun.create({
    userId: owner._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    branchId: branch._id,
    chatId: chat._id,
    prompt: 'Build a dashboard',
    status: 'failed',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'test-model',
    retryable: true
  });
  const candidate = await createArtifactBackedCandidate({
    workspaceId: project.workspaceId!,
    branchId: branch._id,
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
  assert.equal((await Chat.findById(chat._id).orFail()).messages.length, 1);

  const timeline = await request(app)
    .get(`/api/chat/${chat._id}/timeline`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assert.equal(timeline.body.turns.length, 2);
  assert.equal(
    timeline.body.turns[1].retryOfRunId,
    sourceRun._id.toString()
  );
});

test('concurrent validation retry requests converge on one non-terminal Run', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const branch = await ensureMainBranch(project);
  const sourceRun = await AgentRun.create({
    userId: owner._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    branchId: branch._id,
    prompt: 'Retry once',
    status: 'failed',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'test-model',
    retryable: true
  });
  const candidate = await createArtifactBackedCandidate({
    workspaceId: project.workspaceId!,
    branchId: branch._id,
    userId: owner._id,
    projectId: project._id,
    sourceRunId: sourceRun._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    summary: 'Concurrent candidate',
    expiresAt: new Date(Date.now() + 60_000)
  });
  sourceRun.validationCandidateId = candidate._id;
  await sourceRun.save();
  await AgentRun.syncIndexes();

  const responses = await Promise.all([
    request(app)
      .post(`/api/agent/runs/${sourceRun._id}/retry-validation`)
      .set('Authorization', `Bearer ${ownerToken}`),
    request(app)
      .post(`/api/agent/runs/${sourceRun._id}/retry-validation`)
      .set('Authorization', `Bearer ${ownerToken}`)
  ]);
  assert.deepEqual(
    responses.map(response => response.status).sort(),
    [200, 201]
  );
  assert.equal(
    responses[0]?.body.run._id,
    responses[1]?.body.run._id
  );
  assert.equal(await AgentRun.countDocuments({
    retryOfRunId: sourceRun._id,
    completedAt: { $exists: false }
  }), 1);
});

test('snapshot and Run detail hydrate artifacts while list does not read Blob content', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const branch = await ensureMainBranch(project);
  const run = await createRun(owner._id, project._id);
  const snapshot = await createArtifactBackedSnapshot({
    workspaceId: project.workspaceId!,
    branchId: branch._id,
    userId: owner._id,
    projectId: project._id,
    sourceRunId: run._id,
    files: [{
      path: 'src/App.tsx',
      content: 'export default function App() { return null; }',
      language: 'tsx'
    }],
    packageJson: {
      dependencies: { react: '^18.3.0' },
      devDependencies: {},
      scripts: { build: 'vite build' }
    },
    validation: { status: 'passed', checks: [] },
    summary: 'Hydrated snapshot'
  });
  run.status = 'completed';
  run.resultSnapshotId = snapshot._id;
  await run.save();

  const detail = await request(app)
    .get(`/api/projects/${project._id}/snapshots/${snapshot._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assert.equal(detail.body.snapshot.files[0].path, 'src/App.tsx');
  assert.equal(detail.body.snapshot.packageJson.dependencies.react, '^18.3.0');

  const runDetail = await request(app)
    .get(`/api/agent/runs/${run._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assert.equal(runDetail.body.resultSnapshot.files[0].path, 'src/App.tsx');

  const rollback = await request(app)
    .post(`/api/projects/${project._id}/snapshots/${snapshot._id}/rollback`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ branchId: branch._id })
    .expect(200);
  assert.equal(rollback.body.snapshot.files[0].path, 'src/App.tsx');
  assert.equal(
    rollback.body.snapshot.packageJson.dependencies.react,
    '^18.3.0'
  );

  const realService = getArtifactService();
  setArtifactServiceForTests({
    readBundle: async () => {
      throw new Error('Blob reads are forbidden for snapshot lists');
    }
  } as unknown as ArtifactService);
  try {
    const list = await request(app)
      .get(`/api/projects/${project._id}/snapshots`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    assert.equal(list.body.snapshots[0].fileCount, 1);
  } finally {
    setArtifactServiceForTests(realService);
  }
});

test('rollback rejects cross-Branch snapshots and does not advance on corrupt artifacts', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const main = await ensureMainBranch(project);
  const feature = await ProjectBranch.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    name: 'feature',
    headVersion: 0
  });
  const sourceRun = await AgentRun.create({
    userId: owner._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    branchId: feature._id,
    prompt: 'Feature snapshot',
    status: 'completed',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'test-model'
  });
  const snapshot = await createArtifactBackedSnapshot({
    workspaceId: project.workspaceId!,
    branchId: feature._id,
    userId: owner._id,
    projectId: project._id,
    sourceRunId: sourceRun._id,
    files: [{
      path: 'src/App.tsx',
      content: 'export default function App() { return null; }',
      language: 'tsx'
    }],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Feature only'
  });

  await request(app)
    .post(`/api/projects/${project._id}/snapshots/${snapshot._id}/rollback`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ branchId: main._id })
    .expect(404);
  assert.equal((await ProjectBranch.findById(main._id))?.headVersion, 0);

  await ArtifactManifest.updateOne(
    { artifactId: snapshot.artifactId },
    { $set: { state: 'corrupt' } }
  );
  await request(app)
    .post(`/api/projects/${project._id}/snapshots/${snapshot._id}/rollback`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ branchId: feature._id })
    .expect(500);
  assert.equal((await ProjectBranch.findById(feature._id))?.headVersion, 0);
});

test('Run detail does not hydrate a result Snapshot bound to another Branch', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const main = await ensureMainBranch(project);
  const feature = await ProjectBranch.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    name: 'detail-feature',
    headVersion: 0
  });
  const run = await createRun(owner._id, project._id);
  const sourceRunId = new Types.ObjectId();
  const snapshot = await createArtifactBackedSnapshot({
    workspaceId: project.workspaceId!,
    branchId: feature._id,
    userId: owner._id,
    projectId: project._id,
    sourceRunId,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Wrong Branch result'
  });
  assert.equal(run.branchId?.toString(), main._id.toString());
  run.status = 'completed';
  run.resultSnapshotId = snapshot._id;
  await run.save();

  const response = await request(app)
    .get(`/api/agent/runs/${run._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assert.equal(response.body.resultSnapshot, null);
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
  const branch = await ensureMainBranch(project);
  const longPrompt = 'x'.repeat(220);
  const [older, newer] = await Chat.create([
    {
      userId: owner._id,
      projectId: project._id,
      branchId: branch._id,
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
      branchId: branch._id,
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
  const branch = await ensureMainBranch(project);
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    branchId: branch._id,
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
  const branch = await ensureMainBranch(project);
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    branchId: branch._id,
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
      workspaceId: project.workspaceId,
      projectId: project._id,
      branchId: branch._id,
      chatId: chat._id,
      prompt: 'Create the first version',
      status: 'completed',
      mode: 'create',
      baseSnapshotRevision: 0,
      baseHeadVersion: 0,
      maxRepairAttempts: 2,
      model: 'test-model',
      startedAt: new Date('2026-07-25T10:00:01.000Z'),
      completedAt: new Date('2026-07-25T10:00:05.000Z'),
      createdAt: createdAt[0]
    },
    {
      userId: owner._id,
      workspaceId: project.workspaceId,
      projectId: project._id,
      branchId: branch._id,
      chatId: chat._id,
      prompt: 'Add an activity list',
      status: 'completed',
      mode: 'edit',
      baseSnapshotRevision: 1,
      baseHeadVersion: 1,
      maxRepairAttempts: 2,
      model: 'test-model',
      startedAt: new Date('2026-07-25T10:01:01.000Z'),
      completedAt: new Date('2026-07-25T10:01:08.000Z'),
      createdAt: createdAt[1]
    },
    {
      userId: owner._id,
      workspaceId: project.workspaceId,
      projectId: project._id,
      branchId: branch._id,
      chatId: chat._id,
      prompt: 'Add a broken widget',
      status: 'failed',
      mode: 'edit',
      baseSnapshotRevision: 2,
      baseHeadVersion: 2,
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
  const snapshot = await createArtifactBackedSnapshot({
    workspaceId: project.workspaceId!,
    branchId: completed.branchId!,
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

  const realService = getArtifactService();
  setArtifactServiceForTests({
    readBundle: async () => {
      throw new Error('Blob reads are forbidden for chat timelines');
    }
  } as unknown as ArtifactService);
  let first;
  try {
    first = await request(app)
      .get(`/api/chat/${chat._id}/timeline?limit=2`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  } finally {
    setArtifactServiceForTests(realService);
  }

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
  const otherBranch = await ensureMainBranch(otherProject);
  const chat = await Chat.create({
    userId: owner._id,
    projectId: otherProject._id,
    branchId: otherBranch._id,
    title: 'Other chat',
    messages: []
  });
  const snapshot = await createArtifactBackedSnapshot({
    workspaceId: project.workspaceId!,
    branchId: run.branchId!,
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
