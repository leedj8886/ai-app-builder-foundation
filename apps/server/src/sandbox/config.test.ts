import test from 'node:test';
import assert from 'node:assert/strict';
import { getSandboxConfig } from './config';

test('getSandboxConfig uses safe defaults', () => {
  const config = getSandboxConfig({});

  assert.equal(config.provider, 'fake');
  assert.equal(config.localEnabled, false);
  assert.equal(config.localRoot, '/tmp/open-v0-sandboxes');
  assert.deepEqual(config.allowedBuildImages, ['node:22']);
  assert.equal(config.quotaLockTtlMs, 5_000);
  assert.equal(config.quotaLockWaitMs, 2_000);
  assert.equal(config.readinessTimeoutMs, 60_000);
  assert.equal(config.leaseSeconds, 900);
  assert.equal(config.autoDeleteSeconds, 1_800);
  assert.equal(config.orphanGraceMs, 300_000);
  assert.equal(config.reconcileIntervalMs, 30_000);
  assert.equal(config.heartbeatIntervalMs, 10_000);
  assert.equal(config.heartbeatTimeoutMs, 45_000);
  assert.deepEqual(config.commandTimeouts, {
    install: 180_000,
    typeCheck: 60_000,
    build: 120_000
  });
});

test('getSandboxConfig parses strict overrides', () => {
  const config = getSandboxConfig({
    SANDBOX_PROVIDER: 'daytona',
    DAYTONA_API_KEY: 'test-api-key',
    DAYTONA_API_URL: 'https://example.test/api',
    DAYTONA_TARGET: 'eu',
    SANDBOX_LOCAL_ENABLED: 'true',
    SANDBOX_ALLOWED_BUILD_IMAGES: 'node:22, node:24',
    SANDBOX_QUOTA_LOCK_TTL_MS: '7000',
    SANDBOX_READINESS_TIMEOUT_MS: '8000',
    SANDBOX_LEASE_SECONDS: '9000',
    SANDBOX_AUTO_DELETE_SECONDS: '10000',
    SANDBOX_ORPHAN_GRACE_MS: '11000',
    SANDBOX_RECONCILE_INTERVAL_MS: '12000',
    SANDBOX_HEARTBEAT_INTERVAL_MS: '13000',
    SANDBOX_HEARTBEAT_TIMEOUT_MS: '14000'
  });

  assert.equal(config.provider, 'daytona');
  assert.deepEqual(config.daytona, {
    apiKey: 'test-api-key',
    apiUrl: 'https://example.test/api',
    target: 'eu'
  });
  assert.equal(config.localEnabled, true);
  assert.deepEqual(config.allowedBuildImages, ['node:22', 'node:24']);
  assert.equal(config.quotaLockTtlMs, 7_000);
  assert.equal(config.readinessTimeoutMs, 8_000);
  assert.equal(config.leaseSeconds, 9_000);
  assert.equal(config.autoDeleteSeconds, 10_000);
  assert.equal(config.orphanGraceMs, 11_000);
  assert.equal(config.reconcileIntervalMs, 12_000);
  assert.equal(config.heartbeatIntervalMs, 13_000);
  assert.equal(config.heartbeatTimeoutMs, 14_000);
});

test('getSandboxConfig rejects unsafe production local mode', () => {
  assert.throws(
    () =>
      getSandboxConfig({
        NODE_ENV: 'production',
        SANDBOX_PROVIDER: 'local',
        SANDBOX_LOCAL_ENABLED: 'true'
      }),
    /LocalProcessProvider cannot be enabled in production/
  );
  assert.throws(
    () =>
      getSandboxConfig({
        NODE_ENV: 'production',
        SANDBOX_LOCAL_ENABLED: 'true'
      }),
    /LocalProcessProvider cannot be enabled in production/
  );
});

test('getSandboxConfig rejects malformed values', () => {
  assert.throws(
    () => getSandboxConfig({ SANDBOX_PROVIDER: 'daytona' }),
    /DaytonaProvider requires/
  );
  assert.throws(
    () => getSandboxConfig({
      SANDBOX_PROVIDER: 'daytona',
      DAYTONA_JWT_TOKEN: 'jwt'
    }),
    /DAYTONA_ORGANIZATION_ID is required/
  );
  assert.throws(
    () => getSandboxConfig({ SANDBOX_QUOTA_LOCK_TTL_MS: '0' }),
    /positive safe integer/
  );
  assert.throws(
    () => getSandboxConfig({ SANDBOX_LOCAL_ENABLED: 'TRUE' }),
    /must be "true" or "false"/
  );
  assert.throws(
    () => getSandboxConfig({ SANDBOX_ALLOWED_BUILD_IMAGES: 'node:22, ' }),
    /non-empty image names/
  );
  assert.throws(
    () => getSandboxConfig({ SANDBOX_RECONCILE_INTERVAL_MS: '0' }),
    /positive safe integer/
  );
  assert.throws(
    () => getSandboxConfig({
      SANDBOX_HEARTBEAT_INTERVAL_MS: '1000',
      SANDBOX_HEARTBEAT_TIMEOUT_MS: '1000'
    }),
    /must be greater/
  );
});
