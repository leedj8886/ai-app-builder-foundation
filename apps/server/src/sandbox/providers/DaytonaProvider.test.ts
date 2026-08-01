import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DaytonaBadRequestError,
  DaytonaNotFoundError,
  DaytonaProcessExecutionTimeoutError
} from '@daytona/sdk';
import type {
  CreateSandboxFromImageParams,
  FileInfo,
  ListSandboxesQuery
} from '@daytona/sdk';
import { runSandboxProviderContract } from '../provider/contract';
import type { SandboxSpec } from '../types';
import {
  DaytonaProvider,
  type DaytonaClientLike,
  type DaytonaSandboxLike
} from './DaytonaProvider';

const fileInfo = (
  path: string,
  isDir: boolean,
  size = 0
): FileInfo => ({
  group: 'daytona',
  isDir,
  modTime: new Date(0).toString(),
  mode: isDir ? 'drwxr-xr-x' : '-rw-r--r--',
  modifiedAt: new Date(0).toISOString(),
  name: path.split('/').at(-1) ?? '',
  owner: 'daytona',
  path,
  permissions: isDir ? '755' : '644',
  size
});

class TestDaytonaSandbox implements DaytonaSandboxLike {
  state = 'started';
  createdAt = new Date().toISOString();
  errorReason?: string;
  readonly directories = new Set<string>(['/']);
  readonly files = new Map<string, Buffer>();
  readonly commands: Array<{
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }> = [];
  stopCalls = 0;
  commandResult: { exitCode: number; result: string } = {
    exitCode: 0,
    result: 'v22.0.0\n'
  };
  commandError?: Error;
  commandBarrier?: Promise<void>;

  constructor(
    readonly id: string,
    readonly labels: Record<string, string>
  ) {}

  readonly fs = {
    createFolder: async (path: string): Promise<void> => {
      this.directories.add(path);
    },
    uploadFiles: async (
      files: Array<{ source: Buffer; destination: string }>
    ): Promise<void> => {
      for (const file of files) {
        this.files.set(file.destination, Buffer.from(file.source));
      }
    },
    downloadFile: async (path: string): Promise<Buffer> => {
      const content = this.files.get(path);
      if (!content) throw new DaytonaNotFoundError('file missing');
      return Buffer.from(content);
    },
    getFileDetails: async (path: string): Promise<FileInfo> => {
      if (this.directories.has(path)) return fileInfo(path, true);
      const content = this.files.get(path);
      if (content) return fileInfo(path, false, content.byteLength);
      throw new DaytonaNotFoundError('path missing');
    },
    listFiles: async (path: string): Promise<FileInfo[]> => {
      const prefix = `${path}/`;
      const entries = new Map<string, FileInfo>();
      for (const directory of this.directories) {
        if (!directory.startsWith(prefix)) continue;
        const relative = directory.slice(prefix.length);
        if (!relative || relative.includes('/')) continue;
        entries.set(relative, fileInfo(directory, true));
      }
      for (const [candidate, content] of this.files) {
        if (!candidate.startsWith(prefix)) continue;
        const relative = candidate.slice(prefix.length);
        if (!relative || relative.includes('/')) continue;
        entries.set(relative, fileInfo(candidate, false, content.byteLength));
      }
      return [...entries.values()];
    }
  };

  readonly process = {
    executeCommand: async (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number
    ): Promise<{ exitCode: number; result: string }> => {
      this.commands.push({ command, cwd, env, timeout });
      if (this.commandBarrier) await this.commandBarrier;
      if (this.commandError) throw this.commandError;
      return this.commandResult;
    }
  };

  async start(): Promise<void> {
    this.state = 'started';
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.state = 'stopped';
  }

  async waitUntilStarted(): Promise<void> {
    this.state = 'started';
  }

  async refreshData(): Promise<void> {}

  async refreshActivity(): Promise<void> {}
}

class TestDaytonaClient implements DaytonaClientLike {
  readonly sandboxes = new Map<string, TestDaytonaSandbox>();
  readonly createParams: CreateSandboxFromImageParams[] = [];
  createError?: Error;
  sequence = 0;

  async create(
    params: CreateSandboxFromImageParams
  ): Promise<TestDaytonaSandbox> {
    this.createParams.push(structuredClone(params));
    if (this.createError) throw this.createError;
    const sandbox = new TestDaytonaSandbox(
      `daytona-${++this.sequence}`,
      { ...(params.labels ?? {}) }
    );
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  async get(id: string): Promise<TestDaytonaSandbox> {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) throw new DaytonaNotFoundError('sandbox missing');
    return sandbox;
  }

  async *list(
    query?: ListSandboxesQuery
  ): AsyncIterableIterator<TestDaytonaSandbox> {
    for (const sandbox of this.sandboxes.values()) {
      if (
        Object.entries(query?.labels ?? {}).every(
          ([key, value]) => sandbox.labels[key] === value
        )
      ) {
        yield sandbox;
      }
    }
  }

  async delete(sandbox: DaytonaSandboxLike): Promise<void> {
    this.sandboxes.delete(sandbox.id);
  }
}

const buildSpec = (): SandboxSpec => ({
  provisioningKey: `daytona-${crypto.randomUUID()}`,
  ownership: {
    workspaceId: 'workspace',
    projectId: 'project',
    branchId: 'branch',
    runId: 'run',
    purpose: 'build'
  },
  runtime: { image: 'node:22', workingDirectory: '/workspace' },
  resources: { cpu: 2, memoryMiB: 2_048, diskMiB: 4_096 },
  networkPolicy: {
    defaultAction: 'allow',
    allowedDomains: [],
    allowedCidrs: []
  },
  lifecycle: { leaseSeconds: 900, autoDeleteSeconds: 1_800 },
  labels: { 'managed-by': 'open-v0', workspace: 'workspace' }
});

runSandboxProviderContract({
  name: 'DaytonaProvider',
  createProvider: () =>
    new DaytonaProvider({ client: new TestDaytonaClient() }),
  buildSpec
});

test('DaytonaProvider maps Build Sandbox resources, lifecycle, and network policy', async () => {
  const client = new TestDaytonaClient();
  const provider = new DaytonaProvider({ client });
  const spec = {
    ...buildSpec(),
    networkPolicy: {
      defaultAction: 'deny' as const,
      allowedDomains: ['registry.npmjs.org'],
      allowedCidrs: ['10.0.0.0/8']
    },
    lifecycle: {
      leaseSeconds: 125,
      autoStopSeconds: 61,
      autoDeleteSeconds: 121
    }
  };

  await provider.create(spec);
  const params = client.createParams[0];
  assert.equal(params.image, 'node:22');
  assert.deepEqual(params.resources, { cpu: 2, memory: 2, disk: 4 });
  assert.equal(params.networkBlockAll, true);
  assert.equal(params.domainAllowList, 'registry.npmjs.org');
  assert.equal(params.networkAllowList, '10.0.0.0/8');
  assert.equal(params.ttlMinutes, 3);
  assert.equal(params.autoStopInterval, 2);
  assert.equal(params.autoDeleteInterval, 3);
  assert.equal(params.labels?.['managed-by'], 'open-v0');
  assert.ok(params.labels?.['provisioning-key']);
  assert.match(params.labels?.['open-v0-spec-hash'] ?? '', /^[a-f0-9]{64}$/);
  assert.equal(params.labels?.['workspace-id'], 'workspace');
  assert.equal(params.labels?.['project-id'], 'project');
  assert.equal(params.labels?.['branch-id'], 'branch');
  assert.equal(params.labels?.['run-id'], 'run');
});

test('DaytonaProvider quotes command arguments and bounds output', async () => {
  const client = new TestDaytonaClient();
  const provider = new DaytonaProvider({ client });
  const ref = await provider.create(buildSpec());
  const sandbox = await client.get(ref.externalId);
  sandbox.commandResult = {
    exitCode: 0,
    result: 'abcdef'
  };

  const result = await (await provider.connect(ref)).processes.run({
    executable: 'node',
    args: ['-e', "console.log('safe')"],
    cwd: '/workspace',
    env: { CI: 'true' },
    timeoutMs: 1_100,
    maxOutputBytes: 4
  });

  assert.equal(
    sandbox.commands[0].command,
    `'node' '-e' 'console.log('"'"'safe'"'"')'`
  );
  assert.equal(sandbox.commands[0].timeout, 2);
  assert.equal(result.stdout, 'abcd');
  assert.equal(result.outputTruncated, true);
});

test('DaytonaProvider recursively lists build output when Toolbox ignores depth', async () => {
  const client = new TestDaytonaClient();
  const provider = new DaytonaProvider({ client });
  const ref = await provider.create(buildSpec());
  const sandbox = await client.get(ref.externalId);
  sandbox.directories.add('/workspace/dist');
  sandbox.directories.add('/workspace/dist/assets');
  sandbox.files.set('/workspace/dist/index.html', Buffer.from('html'));
  sandbox.files.set('/workspace/dist/assets/app.css', Buffer.from('css'));
  sandbox.files.set('/workspace/dist/assets/app.js', Buffer.from('js'));

  assert.deepEqual(
    await (await provider.connect(ref)).files.listFiles('dist'),
    [
      'dist/assets/app.css',
      'dist/assets/app.js',
      'dist/index.html'
    ]
  );
});

test('DaytonaProvider maps command timeout and aborts by stopping the Sandbox', async () => {
  const client = new TestDaytonaClient();
  const provider = new DaytonaProvider({ client });
  const ref = await provider.create(buildSpec());
  const sandbox = await client.get(ref.externalId);
  const handle = await provider.connect(ref);
  const command = {
    executable: 'npm',
    args: ['run', 'build'],
    cwd: '/workspace',
    env: { CI: 'true' },
    timeoutMs: 1_000,
    maxOutputBytes: 1_024
  };

  sandbox.commandError = new DaytonaProcessExecutionTimeoutError('timed out');
  assert.equal((await handle.processes.run(command)).timedOut, true);

  sandbox.commandError = undefined;
  sandbox.commandBarrier = new Promise(() => undefined);
  const controller = new AbortController();
  const reason = new Error('cancelled');
  const running = handle.processes.run(command, controller.signal);
  controller.abort(reason);
  await assert.rejects(running, reason);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.stopCalls, 1);
});

test('DaytonaProvider rejects command working-directory traversal', async () => {
  const client = new TestDaytonaClient();
  const provider = new DaytonaProvider({ client });
  const handle = await provider.connect(await provider.create(buildSpec()));

  await assert.rejects(
    handle.processes.run({
      executable: 'npm',
      args: ['run', 'build'],
      cwd: '/workspace/../etc',
      env: { CI: 'true' },
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    }),
    /SANDBOX_POLICY_DENIED/
  );
});

test('DaytonaProvider reconnects through a fresh provider and reports deleted resources missing', async () => {
  const client = new TestDaytonaClient();
  const first = new DaytonaProvider({ client });
  const ref = await first.create(buildSpec());
  const fresh = new DaytonaProvider({ client });

  await (await fresh.connect(ref)).waitUntilReady({ timeoutMs: 1_000 });
  await fresh.destroy(ref);
  assert.equal((await fresh.inspect(ref)).status, 'missing');
});

test('DaytonaProvider classifies deterministic and unknown create failures', async () => {
  for (const [error, outcome] of [
    [new DaytonaBadRequestError('invalid image'), 'not-created'],
    [new Error('connection dropped'), 'unknown']
  ] as const) {
    const client = new TestDaytonaClient();
    client.createError = error;
    const provider = new DaytonaProvider({ client });

    await assert.rejects(provider.create(buildSpec()), (failure: unknown) => {
      assert.equal(
        (failure as { outcome?: string }).outcome,
        outcome
      );
      return true;
    });
  }
});
