import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema, Types } from 'mongoose';
import { AgentRun } from '../../models/AgentRun';
import { Project } from '../../models/Project';
import { ProjectSnapshot } from '../../models/ProjectSnapshot';
import { ValidationCandidate } from '../../models/ValidationCandidate';
import { STATIC_REACT_PROFILE_REF } from './staticReactProfile';

test('persisted domain models expose a structured Profile reference', () => {
  for (const Model of [Project, AgentRun, ProjectSnapshot, ValidationCandidate]) {
    const schema = Model.schema as Schema;
    assert.ok(schema.path('profile'));
    assert.ok(schema.path('profile.id'));
    assert.ok(schema.path('profile.version'));
  }
});

test('new domain documents retain an explicit Profile while legacy documents may omit it', () => {
  const ids = {
    userId: new Types.ObjectId(),
    workspaceId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    runId: new Types.ObjectId()
  };
  const explicit = new AgentRun({
    ...ids,
    profile: STATIC_REACT_PROFILE_REF,
    prompt: 'Build an app',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    attempt: 0,
    maxRepairAttempts: 2,
    model: 'test'
  });
  const legacy = new AgentRun({
    ...ids,
    prompt: 'Build an app',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    attempt: 0,
    maxRepairAttempts: 2,
    model: 'test'
  });

  assert.deepEqual(JSON.parse(JSON.stringify(explicit.profile)), {
    id: 'static-react',
    version: 1
  });
  assert.equal(legacy.profile, undefined);
});
