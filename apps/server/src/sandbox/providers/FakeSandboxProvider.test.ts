import test from 'node:test';
import assert from 'node:assert/strict';
import { runSandboxProviderContract } from '../provider/contract';
import type { SandboxSpec } from '../types';
import {
  FakeSandboxProvider,
  FakeSandboxState
} from './FakeSandboxProvider';

const buildSpec = (): SandboxSpec => ({
  provisioningKey: 'workspace/project/branch/build',
  ownership: {
    workspaceId: 'workspace',
    projectId: 'project',
    branchId: 'branch',
    runId: 'run',
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
  labels: { 'managed-by': 'open-v0', workspace: 'workspace' }
});

runSandboxProviderContract({
  name: 'FakeSandboxProvider',
  createProvider: () => new FakeSandboxProvider(new FakeSandboxState()),
  buildSpec
});

test('FakeSandboxProvider reports deterministic create failures', async () => {
  for (const input of [
    { outcome: 'not-created' as const, createResourceBeforeThrow: false },
    { outcome: 'unknown' as const, createResourceBeforeThrow: true }
  ]) {
    const state = new FakeSandboxState();
    const provider = new FakeSandboxProvider(state);
    state.failNextCreate(input);

    await assert.rejects(provider.create(buildSpec()), (error: unknown) => {
      assert.equal(
        (error as { outcome?: string }).outcome,
        input.outcome
      );
      return true;
    });
    assert.equal(state.resources().length, input.createResourceBeforeThrow ? 1 : 0);
  }
});

test('FakeSandboxProvider can time out readiness and lose resources', async () => {
  const state = new FakeSandboxState();
  const provider = new FakeSandboxProvider(state);
  const ref = await provider.create(buildSpec());
  state.setReadiness(ref, 'timeout');

  await assert.rejects(
    (await provider.connect(ref)).waitUntilReady({ timeoutMs: 10 }),
    /SANDBOX_NOT_READY/
  );
  state.setMissing(ref);
  assert.equal((await provider.inspect(ref)).status, 'missing');
  await assert.rejects(provider.connect(ref), /SANDBOX_NOT_FOUND/);
});

test('FakeSandboxProvider models delayed destruction', async () => {
  const state = new FakeSandboxState();
  const provider = new FakeSandboxProvider(state);
  const ref = await provider.create(buildSpec());
  state.delayDestroy(ref, 2);

  assert.equal((await provider.destroy(ref)).pending, true);
  state.advanceDestroy(ref);
  assert.equal((await provider.destroy(ref)).pending, true);
  state.advanceDestroy(ref);
  assert.equal((await provider.destroy(ref)).pending, false);
  assert.equal((await provider.inspect(ref)).status, 'missing');
});

test('FakeSandboxState can seed duplicate provisioning resources', async () => {
  const state = new FakeSandboxState();
  const provider = new FakeSandboxProvider(state);
  const first = await provider.create(buildSpec());
  const duplicate = state.seedDuplicate(buildSpec());

  assert.notDeepEqual(duplicate, first);
  assert.deepEqual(
    await provider.list({ provisioningKey: buildSpec().provisioningKey }),
    [first, duplicate]
  );
});
