import test from 'node:test';
import assert from 'node:assert/strict';
import { getSandboxConfig } from './config';
import { createSandboxPolicy } from './policy';
import type { SandboxSpec } from './types';

const buildSpec = (overrides: Partial<SandboxSpec> = {}): SandboxSpec => ({
  provisioningKey: 'workspace/project/branch/build',
  ownership: {
    workspaceId: 'workspace',
    projectId: 'project',
    branchId: 'branch',
    purpose: 'build'
  },
  runtime: { image: 'node:22', workingDirectory: '/workspace' },
  resources: { cpu: 1, memoryMiB: 1_024, diskMiB: 2_048 },
  networkPolicy: {
    defaultAction: 'allow',
    allowedDomains: [],
    allowedCidrs: []
  },
  lifecycle: { leaseSeconds: 900, autoDeleteSeconds: 1_800 },
  labels: { 'managed-by': 'open-v0' },
  ...overrides
});

test('SandboxPolicy builds fixed commands', () => {
  const config = getSandboxConfig({});
  const policy = createSandboxPolicy(config);

  assert.deepEqual(
    policy.buildCommand('type-check', {
      hasPackageLock: false,
      maxOutputBytes: 1_024
    }),
    {
      executable: 'npm',
      args: ['run', 'type-check'],
      cwd: '/workspace',
      env: { CI: 'true' },
      timeoutMs: config.commandTimeouts.typeCheck,
      maxOutputBytes: 1_024
    }
  );
  assert.deepEqual(
    policy.buildCommand('install', {
      hasPackageLock: true,
      maxOutputBytes: Number.MAX_SAFE_INTEGER
    }).args,
    ['ci']
  );
  assert.deepEqual(
    policy.buildCommand('install', {
      hasPackageLock: false,
      maxOutputBytes: 1_024
    }).args,
    ['install']
  );
  assert.deepEqual(
    [
      'prisma-validate',
      'prisma-generate',
      'migration-history',
      'migration-replay',
      'nest-type-check',
      'api-test',
      'web-api-build',
      'runtime-smoke'
    ].map(name => policy.buildCommand(name as Parameters<typeof policy.buildCommand>[0], {
      hasPackageLock: false,
      maxOutputBytes: 1_024
    }).args),
    [
      ['run', 'prisma:validate'],
      ['run', 'prisma:generate'],
      ['run', 'migration:check'],
      ['run', 'migration:replay'],
      ['run', 'type-check'],
      ['run', 'test:api'],
      ['run', 'build'],
      ['run', 'runtime:smoke']
    ]
  );
  assert.deepEqual(
    policy.buildCommand('migration-replay', {
      hasPackageLock: false,
      maxOutputBytes: 1_024,
      environment: {
        DATABASE_URL: 'postgresql://primary',
        SHADOW_DATABASE_URL: 'postgresql://shadow'
      }
    }).env,
    {
      CI: 'true',
      DATABASE_URL: 'postgresql://primary',
      SHADOW_DATABASE_URL: 'postgresql://shadow'
    }
  );
});

test('SandboxPolicy rejects disallowed providers and specs', () => {
  const config = getSandboxConfig({});
  const policy = createSandboxPolicy(config);

  assert.throws(
    () => policy.assertProviderAllowed('local', { production: true }),
    /SANDBOX_POLICY_DENIED/
  );
  assert.throws(
    () =>
      policy.assertSpecAllowed(
        buildSpec({ runtime: { image: 'unknown:latest', workingDirectory: '/workspace' } })
      ),
    /SANDBOX_POLICY_DENIED/
  );
  assert.throws(
    () =>
      policy.assertSpecAllowed(
        buildSpec({ resources: { cpu: 0, memoryMiB: 1_024, diskMiB: 2_048 } })
      ),
    /SANDBOX_POLICY_DENIED/
  );
  assert.throws(
    () => policy.buildCommand('api-test', {
      hasPackageLock: false,
      maxOutputBytes: 1_024,
      environment: { UNSAFE_SECRET: 'value' } as never
    }),
    /SANDBOX_POLICY_DENIED/
  );
});

test('SandboxPolicy derives purpose capabilities and bounds output', () => {
  const policy = createSandboxPolicy(getSandboxConfig({}));

  assert.deepEqual(policy.requiredCapabilities(buildSpec()), [
    'files',
    'processes',
    'lifecycle'
  ]);
  assert.deepEqual(
    policy.requiredCapabilities(
      buildSpec({
        ownership: {
          workspaceId: 'workspace',
          projectId: 'project',
          branchId: 'branch',
          purpose: 'preview'
        }
      })
    ),
    ['files', 'processes', 'lifecycle', 'preview']
  );

  const command = policy.buildCommand('build', {
    hasPackageLock: true,
    maxOutputBytes: Number.MAX_SAFE_INTEGER
  });
  assert.deepEqual(command.args, ['run', 'build', '--', '--base=./']);
  assert.ok(command.maxOutputBytes < Number.MAX_SAFE_INTEGER);
});
