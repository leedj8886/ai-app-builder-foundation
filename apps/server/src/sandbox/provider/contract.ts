import test from 'node:test';
import assert from 'node:assert/strict';
import type { SandboxProvider } from './SandboxProvider';
import type { SandboxSpec } from '../types';

export interface SandboxProviderContractFactory {
  name: string;
  createProvider(): SandboxProvider;
  buildSpec(): SandboxSpec;
}

export const runSandboxProviderContract = (
  factory: SandboxProviderContractFactory
): void => {
  test(`${factory.name}: describes its core protocol`, async () => {
    const descriptor = await factory.createProvider().describe();

    assert.equal(descriptor.protocolVersion, 'sandbox-provider/v1');
    assert.equal(descriptor.capabilities.files, true);
    assert.equal(descriptor.capabilities.processes, true);
    assert.equal(descriptor.capabilities.lifecycle, true);
  });

  test(`${factory.name}: create is idempotent and rejects changed ownership`, async () => {
    const provider = factory.createProvider();
    const spec = factory.buildSpec();
    const first = await provider.create(spec);
    const second = await provider.create(spec);

    assert.deepEqual(second, first);
    await assert.rejects(
      provider.create({
        ...spec,
        ownership: { ...spec.ownership, branchId: 'other-branch' }
      }),
      /SANDBOX_OWNERSHIP_MISMATCH/
    );
  });

  test(`${factory.name}: connects, exchanges files, and runs commands`, async () => {
    const provider = factory.createProvider();
    const ref = await provider.create(factory.buildSpec());
    const handle = await provider.connect(ref);
    await handle.waitUntilReady({ timeoutMs: 1_000 });

    const content = new TextEncoder().encode('hello');
    await handle.files.writeFiles([{ path: 'src/message.txt', content }]);
    assert.equal(await handle.files.exists('src/message.txt'), true);
    assert.deepEqual(await handle.files.readFile('src/message.txt'), content);
    assert.deepEqual(await handle.files.listFiles('src'), ['src/message.txt']);

    const result = await handle.processes.run({
      executable: 'node',
      args: ['--version'],
      cwd: '/workspace',
      env: {},
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  });

  test(`${factory.name}: inspects and filters resources`, async () => {
    const provider = factory.createProvider();
    const spec = factory.buildSpec();
    const ref = await provider.create(spec);
    const inspection = await provider.inspect(ref);

    assert.equal(inspection.provisioningKey, spec.provisioningKey);
    assert.deepEqual(inspection.labels, spec.labels);
    assert.deepEqual(
      await provider.list({
        provisioningKey: spec.provisioningKey,
        labels: spec.labels
      }),
      [ref]
    );
    assert.deepEqual(await provider.list({ labels: { absent: 'yes' } }), []);
  });

  test(`${factory.name}: destroy is idempotent`, async () => {
    const provider = factory.createProvider();
    const ref = await provider.create(factory.buildSpec());

    assert.deepEqual(await provider.destroy(ref), {
      accepted: true,
      missing: false,
      pending: false
    });
    assert.deepEqual(await provider.destroy(ref), {
      accepted: true,
      missing: true,
      pending: false
    });
  });
};
