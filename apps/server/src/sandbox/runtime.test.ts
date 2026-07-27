import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type IORedis from 'ioredis';
import type { ArtifactService } from '../artifacts/artifactService';
import { createSandboxRuntime } from './runtime';

const redis = {} as IORedis;
const artifactService = {} as ArtifactService;

test('Sandbox runtime marks Fake execution simulated', async () => {
  const runtime = await createSandboxRuntime({
    redis,
    artifactService,
    env: {
      NODE_ENV: 'test',
      SANDBOX_PROVIDER: 'fake'
    }
  });

  assert.equal(runtime.provider, 'fake');
  assert.equal(runtime.verification, 'simulated');
  assert.ok(runtime.fakeState);
});

test('Sandbox runtime enables verified Local execution only outside production', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'open-v0-runtime-test-'));
  try {
    const runtime = await createSandboxRuntime({
      redis,
      artifactService,
      env: {
        NODE_ENV: 'development',
        SANDBOX_PROVIDER: 'local',
        SANDBOX_LOCAL_ENABLED: 'true',
        SANDBOX_LOCAL_ROOT: root
      }
    });
    assert.equal(runtime.provider, 'local');
    assert.equal(runtime.verification, 'verified');

    await assert.rejects(
      createSandboxRuntime({
        redis,
        artifactService,
        env: {
          NODE_ENV: 'production',
          SANDBOX_PROVIDER: 'local',
          SANDBOX_LOCAL_ENABLED: 'true',
          SANDBOX_LOCAL_ROOT: root
        }
      }),
      /LocalProcessProvider cannot be enabled in production/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
