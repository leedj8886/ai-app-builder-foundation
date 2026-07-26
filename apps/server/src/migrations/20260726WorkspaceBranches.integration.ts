import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { AgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';
import {
  migrateWorkspaceBranches,
  verifyWorkspaceBranchMigration
} from './20260726WorkspaceBranches';

let environment: IntegrationEnvironment;

before(async () => {
  environment = await createIntegrationEnvironment();
});
beforeEach(async () => environment.reset());
after(async () => environment.close());

test('migration backfills legacy Projects Chats and Runs exactly once', async () => {
  const user = await User.create({
    email: 'legacy@example.test',
    password: 'password',
    name: 'Legacy'
  });
  const project = await Project.collection.insertOne({
    userId: user._id,
    name: 'Legacy project',
    chatIds: [],
    activeSnapshotRevision: 3,
    settings: {
      framework: 'react',
      styling: 'tailwind',
      uiLibrary: 'shadcn'
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const chat = await Chat.collection.insertOne({
    userId: user._id,
    projectId: project.insertedId,
    title: 'Legacy chat',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const run = await AgentRun.collection.insertOne({
    userId: user._id,
    projectId: project.insertedId,
    chatId: chat.insertedId,
    prompt: 'Legacy run',
    status: 'completed',
    mode: 'create',
    baseSnapshotRevision: 3,
    attempt: 0,
    maxRepairAttempts: 2,
    model: 'legacy-model',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await migrateWorkspaceBranches();
  await migrateWorkspaceBranches();
  await verifyWorkspaceBranchMigration();

  const [
    workspace,
    membership,
    migratedProject,
    branch,
    migratedChat,
    migratedRun
  ] = await Promise.all([
    Workspace.findOne({ slug: 'default' }),
    WorkspaceMember.findOne({ userId: user._id }),
    Project.findById(project.insertedId),
    ProjectBranch.findOne({ projectId: project.insertedId, name: 'main' }),
    Chat.findById(chat.insertedId),
    AgentRun.findById(run.insertedId)
  ]);

  assert.ok(workspace && membership && migratedProject && branch);
  assert.equal(await ProjectBranch.countDocuments({
    projectId: project.insertedId,
    name: 'main'
  }), 1);
  assert.equal(
    migratedProject.workspaceId?.toString(),
    workspace._id.toString()
  );
  assert.equal(migratedChat?.branchId?.toString(), branch._id.toString());
  assert.equal(migratedRun?.workspaceId?.toString(), workspace._id.toString());
  assert.equal(migratedRun?.branchId?.toString(), branch._id.toString());
  assert.equal(migratedRun?.baseHeadVersion, 3);
});
