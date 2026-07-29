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
import { ArtifactManifest } from '../models/ArtifactManifest';
import { ValidationCandidate } from '../models/ValidationCandidate';
import { SandboxLease } from '../models/SandboxLease';

test('ArtifactManifest exposes integrity metadata and exact indexes', () => {
  const paths = [
    'artifactId',
    'workspaceId',
    'projectId',
    'createdByRunId',
    'kind',
    'idempotencyKey',
    'format',
    'formatVersion',
    'storageKey',
    'sha256',
    'uncompressedBytes',
    'compressedBytes',
    'fileCount',
    'state',
    'errorCode',
    'createdAt',
    'updatedAt'
  ];
  for (const path of paths) assert.ok(ArtifactManifest.schema.path(path), path);

  assert.deepEqual(ArtifactManifest.schema.indexes(), [
    [{ artifactId: 1 }, { unique: true, background: true }],
    [{ idempotencyKey: 1 }, { unique: true, background: true }],
    [{ workspaceId: 1, projectId: 1, createdAt: -1 }, { background: true }],
    [{ state: 1, updatedAt: 1 }, { background: true }],
    [{ createdByRunId: 1, kind: 1 }, { background: true }]
  ]);
});

test('ArtifactManifest rejects malformed persisted integrity metadata', () => {
  const manifest = new ArtifactManifest({
    artifactId: 'a'.repeat(32),
    workspaceId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    createdByRunId: new Types.ObjectId(),
    kind: 'project_snapshot',
    idempotencyKey: 'snapshot:test',
    format: 'open-v0.bundle+json+gzip',
    formatVersion: 1,
    storageKey: 'outside/blob.gz',
    sha256: 'not-a-digest',
    uncompressedBytes: -1,
    compressedBytes: 1.5,
    fileCount: -1,
    state: 'writing'
  });

  const errors = manifest.validateSync()?.errors;
  assert.ok(errors?.storageKey);
  assert.ok(errors?.sha256);
  assert.ok(errors?.uncompressedBytes);
  assert.ok(errors?.compressedBytes);
  assert.ok(errors?.fileCount);
});

test('Project model exposes the active snapshot pointer', () => {
  assert.ok(Project.schema.path('activeSnapshotId'));
  assert.ok(Project.schema.path('activeSnapshotRevision'));
  assert.deepEqual(
    Project.schema.indexes().map(([fields]) => fields),
    [{ userId: 1, workspaceId: 1, updatedAt: -1 }]
  );
});

test('Sandbox models expose durable lease scope, policy, limits, and indexes', () => {
  for (const path of [
    'workspaceId',
    'projectId',
    'branchId',
    'requestedByUserId',
    'sourceArtifact.artifactId',
    'sourceArtifact.kind',
    'purpose',
    'provider',
    'provisioningKey',
    'externalId',
    'state',
    'spec.networkPolicy.defaultAction',
    'resourceProfile.cpu',
    'reservedAt',
    'expiresAt'
  ]) {
    assert.ok(SandboxLease.schema.path(path), path);
  }
  assert.ok(Project.schema.path('sandboxLimits.maxConcurrentBuilds'));
  assert.ok(Project.schema.path('sandboxLimits.maxRunningPreviews'));
  const project = new Project({
    workspaceId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    name: 'Sandbox defaults'
  });
  assert.equal(project.sandboxLimits.maxConcurrentBuilds, 2);
  assert.equal(project.sandboxLimits.maxRunningPreviews, 3);

  assert.deepEqual(
    SandboxLease.schema.indexes().map(([fields]) => fields),
    [
      { provisioningKey: 1 },
      { branchId: 1, purpose: 1 },
      { workspaceId: 1, purpose: 1, state: 1 },
      { projectId: 1, purpose: 1, state: 1 },
      { state: 1, expiresAt: 1 },
      { provider: 1, externalId: 1 }
    ]
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
  assert.deepEqual(indexes[5], { retryOfRunId: 1 });
  assert.deepEqual(AgentRun.schema.indexes()[5]?.[1], {
    unique: true,
    partialFilterExpression: {
      retryOfRunId: { $type: 'objectId' },
      status: {
        $in: [
          'waiting_for_capacity',
          'queued',
          'running',
          'planning',
          'generating',
          'validating',
          'repairing',
          'persisting'
        ]
      }
    },
    background: true
  });
});

test('AgentEvent model stores sequence per run', () => {
  assert.ok(AgentEvent.schema.path('runId'));
  assert.ok(AgentEvent.schema.path('sequence'));
  assert.ok(AgentEvent.schema.path('type'));

  const indexes = AgentEvent.schema.indexes().map(([fields]) => fields);
  assert.deepEqual(indexes[0], { runId: 1, sequence: 1 });
  assert.deepEqual(indexes[1], { userId: 1, createdAt: -1 });
});

test('ProjectSnapshot stores artifact references without source content', () => {
  assert.ok(ProjectSnapshot.schema.path('workspaceId'));
  assert.ok(ProjectSnapshot.schema.path('branchId'));
  assert.ok(ProjectSnapshot.schema.path('userId'));
  assert.ok(ProjectSnapshot.schema.path('projectId'));
  assert.ok(ProjectSnapshot.schema.path('sourceRunId'));
  assert.ok(ProjectSnapshot.schema.path('parentSnapshotId'));
  assert.ok(ProjectSnapshot.schema.path('artifactId'));
  assert.ok(ProjectSnapshot.schema.path('previewArtifactId'));
  assert.equal(ProjectSnapshot.schema.path('files'), undefined);
  assert.equal(ProjectSnapshot.schema.path('packageJson'), undefined);
  assert.ok(ProjectSnapshot.schema.path('validation'));
  assert.ok(ProjectSnapshot.schema.path('summary'));

  const indexes = ProjectSnapshot.schema.indexes().map(([fields]) => fields);
  assert.deepEqual(indexes, [
    { projectId: 1, createdAt: -1 },
    { userId: 1, createdAt: -1 },
    { sourceRunId: 1 },
    { artifactId: 1 },
    { previewArtifactId: 1 }
  ]);
  assert.equal(ProjectSnapshot.schema.indexes()[2]?.[1].unique, true);
});

test('ValidationCandidate stores artifact references without source content', () => {
  assert.ok(ValidationCandidate.schema.path('workspaceId'));
  assert.ok(ValidationCandidate.schema.path('branchId'));
  assert.ok(ValidationCandidate.schema.path('userId'));
  assert.ok(ValidationCandidate.schema.path('projectId'));
  assert.ok(ValidationCandidate.schema.path('sourceRunId'));
  assert.ok(ValidationCandidate.schema.path('artifactId'));
  assert.equal(ValidationCandidate.schema.path('files'), undefined);
  assert.equal(ValidationCandidate.schema.path('packageJson'), undefined);
  assert.ok(ValidationCandidate.schema.path('summary'));
  assert.ok(ValidationCandidate.schema.path('expiresAt'));

  assert.deepEqual(
    ValidationCandidate.schema.indexes().map(([fields]) => fields),
    [
      { expiresAt: 1 },
      { userId: 1, sourceRunId: 1 },
      { artifactId: 1 },
      { sourceRunId: 1 }
    ]
  );
  assert.equal(ValidationCandidate.schema.indexes()[3]?.[1].unique, true);
});

test('ProjectSnapshot accepts successful validation checks with empty output streams', () => {
  const snapshot = new ProjectSnapshot({
    workspaceId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    sourceRunId: new Types.ObjectId(),
    artifactId: 'a'.repeat(32),
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
