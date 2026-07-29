import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app';
import { mergeProjectPackageJson } from '../agent/dependencies';
import { getArtifactService } from '../artifacts/runtime';
import { createPreviewArtifactBundle } from '../artifacts/previewBundle';
import { ensureMainBranch } from '../branches/branchService';
import { AgentRun } from '../models/AgentRun';
import { ArtifactManifest } from '../models/ArtifactManifest';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { User } from '../models/User';
import { verifiedPreviewDescriptor } from '../preview/descriptor';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';

let environment: IntegrationEnvironment | undefined;

before(async () => {
  environment = await createIntegrationEnvironment();
  process.env.CLIENT_URL = 'http://localhost:3000';
  process.env.PREVIEW_PUBLIC_ORIGIN = 'http://localhost:3001';
  await Promise.all([
    ArtifactManifest.syncIndexes(),
    ProjectSnapshot.syncIndexes()
  ]);
});
beforeEach(async () => environment!.reset());
after(async () => environment?.close());

test('serves only the signed verified build with isolated preview headers', async () => {
  const user = await User.create({
    email: `preview-${crypto.randomUUID()}@example.test`,
    password: 'password',
    name: 'Preview owner'
  });
  const { workspace } = await ensureDefaultWorkspaceForUser(user._id);
  const project = await Project.create({
    workspaceId: workspace._id,
    userId: user._id,
    name: 'Preview project'
  });
  const branch = await ensureMainBranch(project);
  const run = await AgentRun.create({
    userId: user._id,
    workspaceId: workspace._id,
    projectId: project._id,
    branchId: branch._id,
    prompt: 'Build a preview',
    status: 'persisting',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'fake-model'
  });
  const packageJson = mergeProjectPackageJson(undefined, {
    dependencies: {},
    devDependencies: {}
  });
  const source = await getArtifactService().writeBundle({
    workspaceId: workspace._id,
    projectId: project._id,
    createdByRunId: run._id,
    kind: 'project_snapshot',
    idempotencyKey: `preview-source:${run._id.toString()}`,
    bundle: {
      version: 1,
      files: [{
        path: 'src/main.tsx',
        content: 'document.body.textContent = "source";',
        language: 'tsx'
      }],
      packageJson
    }
  });
  const preview = await getArtifactService().writePreviewBundle({
    workspaceId: workspace._id,
    projectId: project._id,
    createdByRunId: run._id,
    kind: 'preview_build',
    idempotencyKey: `preview-build:${run._id.toString()}`,
    bundle: createPreviewArtifactBundle([
      {
        path: 'index.html',
        content: new TextEncoder().encode(
          '<link rel="stylesheet" href="./assets/app.css"><main>verified</main>'
        )
      },
      {
        path: 'assets/app.css',
        content: new TextEncoder().encode('main{background:#bfdbfe}')
      }
    ])
  });
  const snapshot = await ProjectSnapshot.create({
    workspaceId: workspace._id,
    branchId: branch._id,
    userId: user._id,
    projectId: project._id,
    sourceRunId: run._id,
    artifactId: source.artifactId,
    previewArtifactId: preview.artifactId,
    validation: {
      status: 'passed',
      verification: 'verified',
      checks: []
    },
    summary: 'Verified preview'
  });
  const descriptor = verifiedPreviewDescriptor(snapshot)!;
  const previewPath = new URL(descriptor.url).pathname;
  const app = createApp();

  const index = await request(app).get(previewPath).expect(200);
  assert.match(index.text, /<main>verified<\/main>/);
  assert.equal(index.headers['x-frame-options'], undefined);
  assert.match(
    index.headers['content-security-policy'],
    /frame-ancestors http:\/\/localhost:3000/
  );
  assert.equal(index.headers['cross-origin-resource-policy'], 'cross-origin');

  const css = await request(app)
    .get(`${previewPath}assets/app.css`)
    .expect(200);
  assert.equal(css.text, 'main{background:#bfdbfe}');
  assert.match(css.headers['content-type'], /^text\/css/);

  await ProjectSnapshot.updateOne(
    { _id: snapshot._id },
    { $unset: { previewArtifactId: 1 } }
  );
  await request(app).get(previewPath).expect(404);

  const tampered = `${previewPath.slice(0, -2)}x/`;
  await request(app).get(tampered).expect(401);
});
