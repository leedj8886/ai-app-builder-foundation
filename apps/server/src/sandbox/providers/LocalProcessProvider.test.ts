import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  symlinkSync
} from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import { runSandboxProviderContract } from '../provider/contract';
import type { SandboxSpec } from '../types';
import { LocalProcessProvider } from './LocalProcessProvider';

const providerRoot = mkdtempSync(nodePath.join(tmpdir(), 'open-v0-local-test-'));
after(async () => rm(providerRoot, { recursive: true, force: true }));

const buildSpec = (): SandboxSpec => ({
  provisioningKey: `local-${crypto.randomUUID()}`,
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
  labels: { 'managed-by': 'open-v0' }
});

runSandboxProviderContract({
  name: 'LocalProcessProvider',
  createProvider: () =>
    new LocalProcessProvider({ root: providerRoot, production: false }),
  buildSpec
});

test('LocalProcessProvider is unavailable in production', () => {
  assert.throws(
    () => new LocalProcessProvider({ root: providerRoot, production: true }),
    /SANDBOX_POLICY_DENIED/
  );
});

test('LocalProcessProvider rejects unsupported purpose and network policies', async () => {
  const provider = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });

  await assert.rejects(
    provider.create({
      ...buildSpec(),
      ownership: { ...buildSpec().ownership, purpose: 'preview' }
    }),
    /SANDBOX_CAPABILITY_MISSING/
  );
  for (const networkPolicy of [
    { defaultAction: 'deny' as const, allowedDomains: [], allowedCidrs: [] },
    {
      defaultAction: 'allow' as const,
      allowedDomains: ['example.com'],
      allowedCidrs: []
    },
    {
      defaultAction: 'allow' as const,
      allowedDomains: [],
      allowedCidrs: ['10.0.0.0/8']
    }
  ]) {
    await assert.rejects(
      provider.create({ ...buildSpec(), networkPolicy }),
      /SANDBOX_CAPABILITY_MISSING/
    );
  }
});

test('LocalProcessProvider rejects traversal and symlink components', async () => {
  const provider = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });
  const ref = await provider.create(buildSpec());
  const handle = await provider.connect(ref);

  await assert.rejects(
    handle.files.writeFiles([
      { path: '../escape', content: new TextEncoder().encode('bad') }
    ]),
    /SANDBOX_POLICY_DENIED/
  );

  const sandboxRoot = nodePath.join(providerRoot, ref.externalId);
  symlinkSync(tmpdir(), nodePath.join(sandboxRoot, 'linked'));
  await assert.rejects(
    handle.files.writeFiles([
      { path: 'linked/escape', content: new TextEncoder().encode('bad') }
    ]),
    /SANDBOX_POLICY_DENIED/
  );
});

test('LocalProcessProvider truncates stdout and stderr independently', async () => {
  const provider = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });
  const handle = await provider.connect(await provider.create(buildSpec()));
  const result = await handle.processes.run({
    executable: process.execPath,
    args: [
      '-e',
      "process.stdout.write('a'.repeat(100)); process.stderr.write('b'.repeat(100))"
    ],
    cwd: '/workspace',
    env: { CI: 'true' },
    timeoutMs: 1_000,
    maxOutputBytes: 16
  });

  assert.equal(Buffer.byteLength(result.stdout), 16);
  assert.equal(Buffer.byteLength(result.stderr), 16);
  assert.equal(result.outputTruncated, true);
});

test('LocalProcessProvider times out a process group', async () => {
  const provider = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });
  const ref = await provider.create(buildSpec());
  const handle = await provider.connect(ref);
  const pidFile = nodePath.join(providerRoot, ref.externalId, 'child.pid');
  const result = await handle.processes.run({
    executable: process.execPath,
    args: [
      '-e',
      `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`
    ],
    cwd: '/workspace',
    env: { CI: 'true' },
    timeoutMs: 100,
    maxOutputBytes: 1_024
  });

  assert.equal(result.timedOut, true);
  const childPid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => process.kill(childPid, 0));
});

test('LocalProcessProvider aborts an active process group', async () => {
  const provider = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });
  const handle = await provider.connect(await provider.create(buildSpec()));
  const controller = new AbortController();
  const startedAt = Date.now();
  const command = handle.processes.run({
    executable: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)'],
    cwd: '/workspace',
    env: { CI: 'true' },
    timeoutMs: 10_000,
    maxOutputBytes: 1_024
  }, controller.signal);
  setTimeout(() => controller.abort(), 20);

  const result = await command;
  assert.equal(result.timedOut, false);
  assert.ok(Date.now() - startedAt < 1_000);
});

test('LocalProcessProvider destroy stops processes and removes its directory', async () => {
  const provider = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });
  const ref = await provider.create(buildSpec());
  const sandboxRoot = nodePath.join(providerRoot, ref.externalId);
  await provider.destroy(ref);

  await assert.rejects(stat(sandboxRoot), /ENOENT/);
});

test('LocalProcessProvider cannot reconnect after process restart', async () => {
  const first = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });
  const ref = await first.create(buildSpec());
  const fresh = new LocalProcessProvider({
    root: providerRoot,
    production: false
  });

  await assert.rejects(fresh.connect(ref), /SANDBOX_NOT_FOUND/);
});
