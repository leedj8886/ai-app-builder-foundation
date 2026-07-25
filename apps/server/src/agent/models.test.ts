import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { AgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { Project } from '../models/Project';

test('Project model exposes the active snapshot pointer', () => {
  assert.ok(Project.schema.path('activeSnapshotId'));
  assert.ok(Project.schema.path('activeSnapshotRevision'));
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
