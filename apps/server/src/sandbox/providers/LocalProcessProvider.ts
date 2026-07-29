import { spawn, type ChildProcess } from 'node:child_process';
import {
  constants,
  lstatSync,
  realpathSync,
  statSync
} from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm
} from 'node:fs/promises';
import nodePath from 'node:path';
import { SandboxError } from '../errors';
import {
  normalizeSandboxRelativePath,
  resolveSandboxPath
} from '../path';
import type { SandboxProvider } from '../provider/SandboxProvider';
import type {
  SandboxCommand,
  SandboxCommandResult,
  SandboxDestroyReceipt,
  SandboxHandle,
  SandboxInspection,
  SandboxListFilter,
  SandboxProviderDescriptor,
  SandboxRef,
  SandboxSpec
} from '../types';

interface LocalResource {
  ref: SandboxRef;
  spec: SandboxSpec;
  fingerprint: string;
  root: string;
  createdAt: Date;
  status: SandboxInspection['status'];
  processes: Set<ChildProcess>;
}

interface LocalProcessProviderOptions {
  root: string;
  production: boolean;
}

const fingerprint = (spec: SandboxSpec): string => JSON.stringify(spec);
const keyOf = (ref: SandboxRef): string => ref.externalId;

const policyDenied = (message: string): never => {
  throw new SandboxError('SANDBOX_POLICY_DENIED', message);
};

const capabilityMissing = (message: string): never => {
  throw new SandboxError('SANDBOX_CAPABILITY_MISSING', message);
};

const appendBounded = (
  chunks: Buffer[],
  chunk: Buffer,
  currentBytes: number,
  limit: number
): { bytes: number; truncated: boolean } => {
  const remaining = limit - currentBytes;
  if (remaining <= 0) return { bytes: currentBytes, truncated: true };
  if (chunk.byteLength <= remaining) {
    chunks.push(chunk);
    return { bytes: currentBytes + chunk.byteLength, truncated: false };
  }
  chunks.push(chunk.subarray(0, remaining));
  return { bytes: limit, truncated: true };
};

export class LocalProcessProvider implements SandboxProvider {
  readonly kind = 'local';
  private readonly root: string;
  private readonly resources = new Map<string, LocalResource>();

  constructor(options: LocalProcessProviderOptions) {
    if (options.production) {
      policyDenied('LocalProcessProvider cannot run in production');
    }
    const root = nodePath.resolve(options.root);
    const rootInfo = lstatSync(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      policyDenied('LocalProcessProvider root must be a trusted directory');
    }
    this.root = realpathSync(root);
  }

  async describe(): Promise<SandboxProviderDescriptor> {
    return {
      protocolVersion: 'sandbox-provider/v1',
      kind: this.kind,
      capabilities: {
        files: true,
        processes: true,
        lifecycle: true,
        preview: false,
        networkPolicy: false,
        checkpoints: false,
        reconnectAcrossProcessRestart: false
      }
    };
  }

  async create(spec: SandboxSpec): Promise<SandboxRef> {
    this.assertSupported(spec);
    const existing = [...this.resources.values()].find(
      (resource) =>
        resource.status !== 'missing' &&
        resource.spec.provisioningKey === spec.provisioningKey
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint(spec)) {
        throw new SandboxError(
          'SANDBOX_OWNERSHIP_MISMATCH',
          'Provisioning key belongs to a different Sandbox specification'
        );
      }
      return { ...existing.ref };
    }

    const root = await mkdtemp(nodePath.join(this.root, 'sandbox-'));
    const externalId = nodePath.basename(root);
    const ref = { provider: this.kind, externalId };
    const metadata = {
      protocolVersion: 'sandbox-provider/v1',
      provisioningKey: spec.provisioningKey,
      fingerprint: fingerprint(spec)
    };
    const metadataHandle = await open(
      nodePath.join(root, '.open-v0-sandbox.json'),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    );
    try {
      await metadataHandle.writeFile(JSON.stringify(metadata));
    } finally {
      await metadataHandle.close();
    }
    await mkdir(nodePath.join(root, '.home'), { mode: 0o700 });
    await mkdir(nodePath.join(root, '.npm-cache'), { mode: 0o700 });

    this.resources.set(externalId, {
      ref,
      spec: structuredClone(spec),
      fingerprint: fingerprint(spec),
      root,
      createdAt: new Date(),
      status: 'ready',
      processes: new Set()
    });
    return { ...ref };
  }

  async connect(ref: SandboxRef): Promise<SandboxHandle> {
    const resource = this.require(ref);
    return {
      ref: { ...ref },
      waitUntilReady: async () => {
        this.require(ref);
      },
      files: {
        writeFiles: async (files) => {
          for (const file of files) {
            await this.writeFile(resource, file.path, file.content);
          }
        },
        readFile: async (path) => this.readFile(resource, path),
        listFiles: async (directory) => this.listFiles(resource, directory),
        exists: async (path) => {
          try {
            await this.assertSafeExistingPath(
              resource,
              normalizeSandboxRelativePath(path),
              true
            );
            return true;
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ENOENT'
            ) {
              return false;
            }
            throw error;
          }
        }
      },
      processes: {
        run: async (command, signal) =>
          this.runCommand(resource, command, signal),
        stopAll: async () => this.stopAll(resource)
      },
      lifecycle: {
        heartbeat: async () => {
          this.require(ref);
        },
        stop: async () => {
          await this.stopAll(resource);
          resource.status = 'stopped';
        }
      }
    };
  }

  async inspect(ref: SandboxRef): Promise<SandboxInspection> {
    this.assertProvider(ref);
    const resource = this.resources.get(keyOf(ref));
    if (!resource) {
      throw new SandboxError('SANDBOX_NOT_FOUND', 'Sandbox resource not found');
    }
    return {
      ref: { ...resource.ref },
      status: resource.status,
      provisioningKey: resource.spec.provisioningKey,
      createdAt: new Date(resource.createdAt),
      labels: { ...resource.spec.labels }
    };
  }

  async list(filter: SandboxListFilter): Promise<SandboxRef[]> {
    return [...this.resources.values()]
      .filter((resource) => resource.status !== 'missing')
      .filter(
        (resource) =>
          filter.provisioningKey === undefined ||
          resource.spec.provisioningKey === filter.provisioningKey
      )
      .filter((resource) =>
        Object.entries(filter.labels ?? {}).every(
          ([key, value]) => resource.spec.labels[key] === value
        )
      )
      .map((resource) => ({ ...resource.ref }));
  }

  async destroy(
    ref: SandboxRef,
    _options?: { wait?: boolean }
  ): Promise<SandboxDestroyReceipt> {
    this.assertProvider(ref);
    const resource = this.resources.get(keyOf(ref));
    if (!resource || resource.status === 'missing') {
      return { accepted: true, missing: true, pending: false };
    }
    await this.stopAll(resource);
    await rm(resource.root, { recursive: true, force: true });
    resource.status = 'missing';
    return { accepted: true, missing: false, pending: false };
  }

  private assertSupported(spec: SandboxSpec): void {
    if (spec.ownership.purpose !== 'build') {
      capabilityMissing('LocalProcessProvider only supports build Sandboxes');
    }
    if (
      spec.networkPolicy.defaultAction !== 'allow' ||
      spec.networkPolicy.allowedDomains.length > 0 ||
      spec.networkPolicy.allowedCidrs.length > 0
    ) {
      capabilityMissing(
        'LocalProcessProvider cannot enforce the requested network policy'
      );
    }
  }

  private assertProvider(ref: SandboxRef): void {
    if (ref.provider !== this.kind) {
      throw new SandboxError(
        'SANDBOX_OWNERSHIP_MISMATCH',
        'Sandbox reference belongs to a different provider'
      );
    }
  }

  private require(ref: SandboxRef): LocalResource {
    this.assertProvider(ref);
    const resource = this.resources.get(keyOf(ref));
    if (!resource || resource.status === 'missing') {
      throw new SandboxError('SANDBOX_NOT_FOUND', 'Sandbox resource not found');
    }
    return resource;
  }

  private async ensureSafeParent(
    resource: LocalResource,
    relativePath: string
  ): Promise<void> {
    const segments = relativePath.split('/').slice(0, -1);
    let current = resource.root;
    for (const segment of segments) {
      current = nodePath.join(current, segment);
      try {
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) {
          policyDenied('Sandbox path contains an unsafe component');
        }
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          await mkdir(current, { mode: 0o700 });
          continue;
        }
        throw error;
      }
    }
  }

  private async assertSafeExistingPath(
    resource: LocalResource,
    relativePath: string,
    allowDirectory: boolean
  ): Promise<string> {
    const segments = relativePath.split('/');
    let current = resource.root;
    for (const [index, segment] of segments.entries()) {
      current = nodePath.join(current, segment);
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        policyDenied('Sandbox path contains a symbolic link');
      }
      const final = index === segments.length - 1;
      if (!final && !info.isDirectory()) {
        policyDenied('Sandbox path contains a non-directory component');
      }
      if (final && !allowDirectory && !info.isFile()) {
        policyDenied('Sandbox path is not a regular file');
      }
    }
    return current;
  }

  private async writeFile(
    resource: LocalResource,
    candidate: string,
    content: Uint8Array
  ): Promise<void> {
    const relative = normalizeSandboxRelativePath(candidate);
    await this.ensureSafeParent(resource, relative);
    const destination = resolveSandboxPath(resource.root, relative);
    try {
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink()) {
        policyDenied('Sandbox destination is not a regular file');
      }
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }

    const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private async readFile(
    resource: LocalResource,
    candidate: string
  ): Promise<Uint8Array> {
    const relative = normalizeSandboxRelativePath(candidate);
    const filePath = await this.assertSafeExistingPath(
      resource,
      relative,
      false
    );
    const handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  }

  private async listFiles(
    resource: LocalResource,
    candidate: string
  ): Promise<string[]> {
    const relative = normalizeSandboxRelativePath(candidate);
    const directory = await this.assertSafeExistingPath(
      resource,
      relative,
      true
    );
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      policyDenied('Sandbox list target is not a safe directory');
    }

    const files: string[] = [];
    const visit = async (absoluteDirectory: string, relativeDirectory: string) => {
      const entries = await readdir(absoluteDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = `${relativeDirectory}/${entry.name}`;
        const absolutePath = nodePath.join(absoluteDirectory, entry.name);
        const info = await lstat(absolutePath);
        if (info.isSymbolicLink()) {
          policyDenied('Sandbox output contains a symbolic link');
        }
        if (info.isDirectory()) {
          await visit(absolutePath, relativePath);
        } else if (info.isFile()) {
          files.push(relativePath);
        } else {
          policyDenied('Sandbox output contains an unsupported file type');
        }
      }
    };
    await visit(directory, relative);
    return files.sort();
  }

  private resolveCommandCwd(resource: LocalResource, cwd: string): string {
    if (cwd === '/workspace') return resource.root;
    if (!cwd.startsWith('/workspace/')) {
      policyDenied('Command working directory is outside /workspace');
    }
    const relative = cwd.slice('/workspace/'.length);
    return resolveSandboxPath(resource.root, relative);
  }

  private async runCommand(
    resource: LocalResource,
    command: SandboxCommand,
    signal?: AbortSignal
  ): Promise<SandboxCommandResult> {
    if (
      Object.keys(command.env).some((key) => key !== 'CI') ||
      !Number.isSafeInteger(command.timeoutMs) ||
      command.timeoutMs <= 0 ||
      !Number.isSafeInteger(command.maxOutputBytes) ||
      command.maxOutputBytes <= 0
    ) {
      policyDenied('Sandbox command violates the local execution policy');
    }
    const cwd = this.resolveCommandCwd(resource, command.cwd);
    const cwdInfo = statSync(cwd);
    if (!cwdInfo.isDirectory()) policyDenied('Command cwd is not a directory');

    const startedAt = Date.now();
    const child = spawn(command.executable, command.args, {
      cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: nodePath.join(resource.root, '.home'),
        npm_config_cache: nodePath.join(resource.root, '.npm-cache'),
        ...command.env
      },
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    resource.processes.add(child);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
    let timedOut = false;

    child.stdout?.on('data', (value: Buffer) => {
      const appended = appendBounded(
        stdout,
        value,
        stdoutBytes,
        command.maxOutputBytes
      );
      stdoutBytes = appended.bytes;
      outputTruncated ||= appended.truncated;
    });
    child.stderr?.on('data', (value: Buffer) => {
      const appended = appendBounded(
        stderr,
        value,
        stderrBytes,
        command.maxOutputBytes
      );
      stderrBytes = appended.bytes;
      outputTruncated ||= appended.truncated;
    });

    const terminate = () => this.terminateProcess(child);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, command.timeoutMs);
    const onAbort = () => terminate();
    signal?.addEventListener('abort', onAbort, { once: true });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code));
    }).finally(() => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resource.processes.delete(child);
    });

    return {
      exitCode,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      durationMs: Date.now() - startedAt,
      timedOut,
      outputTruncated
    };
  }

  private terminateProcess(child: ChildProcess): void {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      // The process may have exited between the state check and signal.
    }
    const force = setTimeout(() => {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The process group is already gone.
      }
    }, 100);
    force.unref();
  }

  private async stopAll(resource: LocalResource): Promise<void> {
    const children = [...resource.processes];
    for (const child of children) this.terminateProcess(child);
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null) return resolve();
            const fallback = setTimeout(resolve, 500);
            fallback.unref();
            child.once('close', () => {
              clearTimeout(fallback);
              resolve();
            });
          })
      )
    );
  }
}
