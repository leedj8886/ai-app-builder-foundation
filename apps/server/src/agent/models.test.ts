import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { AgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import { ProjectBranch } from '../models/ProjectBranch';
import { BranchExecutionLease } from '../models/BranchExecutionLease';
import { Chat } from '../models/Chat';

test('Project model exposes the active snapshot pointer', () => {
  assert.ok(Project.schema.path('activeSnapshotId'));
  assert.ok(Project.schema.path('activeSnapshotRevision'));
  assert.deepEqual(
    Project.schema.indexes().map(([fields]) => fields),
    [{ userId: 1, workspaceId: 1, updatedAt: -1 }]
  );
});

test('Workspace models expose membership and execution boundaries', () => {
  assert.ok(Workspace.schema.path('slug'));
  assert.ok(Workspace.schema.path('createdByUserId'));
  assert.ok(Workspace.schema.path('executionLimits.maxConcurrentBuilds'));
  assert.ok(WorkspaceMember.schema.path('workspaceId'));
  assert.ok(WorkspaceMember.schema.path('userId'));
  assert.ok(WorkspaceMember.schema.path('role'));

  assert.deepEqual(
    WorkspaceMember.schema.indexes().map(([fields]) => fields),
    [
      { workspaceId: 1, userId: 1 },
      { userId: 1, workspaceId: 1 }
    ]
  );
});

test('ProjectBranch stores one version head per named branch', () => {
  assert.ok(ProjectBranch.schema.path('workspaceId'));
  assert.ok(ProjectBranch.schema.path('projectId'));
  assert.ok(ProjectBranch.schema.path('headSnapshotId'));
  assert.ok(ProjectBranch.schema.path('headVersion'));

  assert.deepEqual(
    ProjectBranch.schema.indexes().map(([fields]) => fields),
    [
      { projectId: 1, name: 1 },
      { workspaceId: 1, projectId: 1, updatedAt: -1 }
    ]
  );
});

test('BranchExecutionLease allows only one active writer per Branch', () => {
  assert.ok(BranchExecutionLease.schema.path('branchId'));
  assert.ok(BranchExecutionLease.schema.path('runId'));
  assert.ok(BranchExecutionLease.schema.path('expiresAt'));

  assert.deepEqual(
    BranchExecutionLease.schema.indexes().map(([fields]) => fields),
    [
      { branchId: 1 },
      { expiresAt: 1 }
    ]
  );
});

test('Project Chat and AgentRun expose Workspace and Branch references', () => {
  assert.ok(Project.schema.path('workspaceId'));
  assert.ok(Chat.schema.path('branchId'));
  assert.ok(AgentRun.schema.path('workspaceId'));
  assert.ok(AgentRun.schema.path('branchId'));
  assert.ok(AgentRun.schema.path('baseHeadVersion'));
});

test('AgentRun model exposes required paths and indexes', () => {
  assert.ok(AgentRun.schema.path('userId'));
  assert.ok(AgentRun.schema.path('projectId'));
  assert.ok(AgentRun.schema.path('prompt'));
  assert.ok(AgentRun.schema.path('status'));
  assert.ok(AgentRun.schema.path('baseSnapshotRevision'));

  const indexes = AgentRun.schema.indexes().map(([fields]) => fields);
  assert.deepEqual(indexes[0], { userId: 1, updatedAt: -1 });
  assert.deepEqual(indexes[1], { projectId: 1, updatedAt: -1 });
  assert.deepEqual(indexes[2], { status: 1, updatedAt: 1 });
});

test('AgentEvent model stores sequence per run', () => {
  assert.ok(AgentEvent.schema.path('runId'));
  assert.ok(AgentEvent.schema.path('sequence'));
  assert.ok(AgentEvent.schema.path('type'));

  const indexes = AgentEvent.schema.indexes().map(([fields]) => fields);
  assert.deepEqual(indexes[0], { runId: 1, sequence: 1 });
  assert.deepEqual(indexes[1], { userId: 1, createdAt: -1 });
});

test('ProjectSnapshot model stores full file tree snapshots', () => {
  assert.ok(ProjectSnapshot.schema.path('userId'));
  assert.ok(ProjectSnapshot.schema.path('projectId'));
  assert.ok(ProjectSnapshot.schema.path('sourceRunId'));
  assert.ok(ProjectSnapshot.schema.path('parentSnapshotId'));
  assert.ok(ProjectSnapshot.schema.path('files'));
  assert.ok(ProjectSnapshot.schema.path('packageJson'));
  assert.ok(ProjectSnapshot.schema.path('validation'));
  assert.ok(ProjectSnapshot.schema.path('summary'));

  const indexes = ProjectSnapshot.schema.indexes().map(([fields]) => fields);
  assert.deepEqual(indexes[0], { projectId: 1, createdAt: -1 });
  assert.deepEqual(indexes[1], { userId: 1, createdAt: -1 });
  assert.deepEqual(indexes[2], { sourceRunId: 1 });
});

test('ProjectSnapshot accepts successful validation checks with empty output streams', () => {
  const snapshot = new ProjectSnapshot({
    userId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    sourceRunId: new Types.ObjectId(),
    files: [{
      path: 'index.html',
      content: '<div id="root"></div>',
      language: 'html'
    }],
    packageJson: {
      dependencies: {},
      devDependencies: {},
      scripts: {}
    },
    validation: {
      status: 'passed',
      checks: [{
        name: 'type-check',
        command: 'npm run type-check',
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1
      }]
    },
    summary: 'Validated snapshot'
  });

  assert.equal(snapshot.validateSync(), undefined);
});

test('new persisted domain records require Workspace and Branch references', () => {
  const userId = new Types.ObjectId();
  const projectId = new Types.ObjectId();

  const project = new Project({
    userId,
    name: 'Missing Workspace'
  });
  assert.equal(
    project.validateSync()?.errors.workspaceId?.kind,
    'required'
  );

  const run = new AgentRun({
    userId,
    projectId,
    prompt: 'Missing Branch baseline',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    maxRepairAttempts: 2,
    model: 'test-model'
  });
  const runErrors = run.validateSync()?.errors;
  assert.equal(runErrors?.workspaceId?.kind, 'required');
  assert.equal(runErrors?.branchId?.kind, 'required');
  assert.equal(runErrors?.baseHeadVersion?.kind, 'required');

  const standaloneChat = new Chat({
    userId,
    title: 'Standalone legacy chat',
    messages: []
  });
  assert.equal(standaloneChat.validateSync(), undefined);
});
