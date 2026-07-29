import assert from 'node:assert/strict';
import test from 'node:test';
import { getPreviewConfig } from './config';
import { signPreviewToken, verifyPreviewToken } from './token';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { verifiedPreviewDescriptor } from './descriptor';
import { Types } from 'mongoose';

const ids = {
  tokenUse: 'preview' as const,
  workspaceId: '64b7f5086f1f8e9f0f000001',
  projectId: '64b7f5086f1f8e9f0f000002',
  snapshotId: '64b7f5086f1f8e9f0f000003',
  artifactId: '0123456789abcdef0123456789abcdef'
};

test('Preview configuration requires an origin isolated from the client', () => {
  assert.throws(
    () => getPreviewConfig({
      PREVIEW_PUBLIC_ORIGIN: 'https://app.example.com',
      CLIENT_URL: 'https://app.example.com',
      JWT_SECRET: 'secret'
    }),
    /must be isolated/
  );
  assert.equal(getPreviewConfig({
    PREVIEW_PUBLIC_ORIGIN: 'https://preview.example.com',
    CLIENT_URL: 'https://app.example.com',
    JWT_SECRET: 'secret'
  }).publicOrigin, 'https://preview.example.com');
});

test('Preview token is scoped to one verified Artifact', () => {
  const config = getPreviewConfig({
    PREVIEW_PUBLIC_ORIGIN: 'https://preview.example.com',
    CLIENT_URL: 'https://app.example.com',
    JWT_SECRET: 'secret'
  });
  const token = signPreviewToken(ids, config);

  assert.deepEqual(verifyPreviewToken(token, config), ids);
  assert.throws(
    () => verifyPreviewToken(token, { ...config, signingSecret: 'other' }),
    /invalid signature/
  );
});

test('only a verified Snapshot with a Preview Artifact gets a build URL', () => {
  const config = getPreviewConfig({
    PREVIEW_PUBLIC_ORIGIN: 'https://preview.example.com',
    CLIENT_URL: 'https://app.example.com',
    JWT_SECRET: 'secret'
  });
  const base = {
    workspaceId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    sourceRunId: new Types.ObjectId(),
    artifactId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    previewArtifactId: ids.artifactId,
    validation: {
      status: 'passed' as const,
      verification: 'verified' as const,
      checks: []
    },
    summary: 'Preview'
  };
  const verified = new ProjectSnapshot(base);
  assert.match(
    verifiedPreviewDescriptor(verified, config)?.url ?? '',
    /^https:\/\/preview\.example\.com\/api\/previews\//
  );
  const simulated = new ProjectSnapshot({
    ...base,
    validation: {
      status: 'passed',
      verification: 'simulated',
      checks: []
    }
  });
  assert.equal(verifiedPreviewDescriptor(simulated, config), undefined);
});
