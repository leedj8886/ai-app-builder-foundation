import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { getArtifactService } from '../artifacts/runtime';
import { ProjectBranch } from '../models/ProjectBranch';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { User } from '../models/User';
import { WorkspaceMember } from '../models/WorkspaceMember';
import {
  legacyStylingSmoke,
  seedLegacyStylingSmokeData
} from '../testing/seedLegacyStylingSmoke';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';

let environment: IntegrationEnvironment | undefined;

before(async () => {
  environment = await createIntegrationEnvironment();
});

after(async () => environment?.close());

test('legacy styling Smoke seed uses current ownership and Artifact models', async () => {
  await environment!.reset();
  await seedLegacyStylingSmokeData();

  const user = await User.findOne({ email: legacyStylingSmoke.email });
  assert.ok(user);
  const membership = await WorkspaceMember.findOne({ userId: user._id });
  assert.ok(membership);
  const branch = await ProjectBranch.findOne({
    workspaceId: membership.workspaceId,
    name: 'main'
  });
  assert.ok(branch?.headSnapshotId);
  assert.equal(branch.headVersion, 1);

  const snapshot = await ProjectSnapshot.findById(branch.headSnapshotId);
  assert.ok(snapshot);
  assert.equal(snapshot.workspaceId.toString(), membership.workspaceId.toString());
  assert.equal(snapshot.branchId.toString(), branch._id.toString());
  assert.equal(snapshot.validation.status, 'passed');

  const bundle = await getArtifactService().readOwnedBundle({
    artifactId: snapshot.artifactId,
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    kind: 'project_snapshot'
  });
  assert.ok(bundle.files.some(file => (
    file.path === 'src/index.css'
    && file.content.includes('@tailwind utilities')
  )));
  assert.equal(
    bundle.files.some(file => file.path === 'tailwind.config.js'),
    false
  );
});
