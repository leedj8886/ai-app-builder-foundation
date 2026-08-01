import { createHash } from 'node:crypto';
import {
  DaytonaBadRequestError,
  DaytonaAuthenticationError,
  DaytonaConflictError,
  DaytonaFileNotFoundError,
  DaytonaForbiddenError,
  DaytonaNotFoundError,
  DaytonaProcessExecutionTimeoutError,
  DaytonaTimeoutError,
  DaytonaUnprocessableEntityError
} from '@daytona/sdk';
import type {
  CreateSandboxFromImageParams,
  FileInfo,
  ListSandboxesQuery
} from '@daytona/sdk';
import { SandboxCreateError, SandboxError } from '../errors';
import { normalizeSandboxRelativePath } from '../path';
import type { SandboxProvider } from '../provider/SandboxProvider';
import type {
  NetworkPolicy,
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

const PROVISIONING_KEY_LABEL = 'provisioning-key';
const SPEC_HASH_LABEL = 'open-v0-spec-hash';
const INTERNAL_OWNERSHIP_LABELS = [
  'workspace-id',
  'project-id',
  'branch-id',
  'run-id',
  'snapshot-id'
] as const;
const WORKSPACE_ROOT = '/workspace';
const MAX_LIST_DEPTH = 64;

interface DaytonaFileSystemLike {
  createFolder(path: string, mode: string): Promise<void>;
  uploadFiles(
    files: Array<{ source: Buffer; destination: string }>,
    timeout?: number
  ): Promise<void>;
  downloadFile(path: string, timeout?: number): Promise<Buffer>;
  getFileDetails(path: string): Promise<FileInfo>;
  listFiles(path: string, options?: { depth?: number }): Promise<FileInfo[]>;
}

interface DaytonaProcessLike {
  executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number
  ): Promise<{ exitCode: number; result: string }>;
}

export interface DaytonaSandboxLike {
  id: string;
  state?: string;
  labels: Record<string, string>;
  createdAt?: string;
  errorReason?: string;
  fs: DaytonaFileSystemLike;
  process: DaytonaProcessLike;
  start(timeout?: number): Promise<void>;
  stop(timeout?: number, force?: boolean): Promise<void>;
  waitUntilStarted(timeout?: number): Promise<void>;
  refreshData(): Promise<void>;
  refreshActivity(): Promise<void>;
}

export interface DaytonaClientLike {
  create(
    params: CreateSandboxFromImageParams,
    options?: { timeout?: number }
  ): Promise<DaytonaSandboxLike>;
  get(id: string): Promise<DaytonaSandboxLike>;
  list(query?: ListSandboxesQuery): AsyncIterableIterator<DaytonaSandboxLike>;
  delete(
    sandbox: DaytonaSandboxLike,
    timeout?: number,
    wait?: boolean
  ): Promise<void>;
}

export interface DaytonaProviderOptions {
  client: DaytonaClientLike;
  operationTimeoutMs?: number;
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const specHash = (spec: SandboxSpec): string =>
  createHash('sha256').update(stableJson(spec)).digest('hex');

const refOf = (sandbox: DaytonaSandboxLike): SandboxRef => ({
  provider: 'daytona',
  externalId: sandbox.id
});

const isNotFound = (error: unknown): boolean =>
  error instanceof DaytonaNotFoundError ||
  error instanceof DaytonaFileNotFoundError ||
  (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === 404
  );

const isCreateRejected = (error: unknown): boolean =>
  error instanceof DaytonaBadRequestError ||
  error instanceof DaytonaAuthenticationError ||
  error instanceof DaytonaForbiddenError ||
  error instanceof DaytonaConflictError ||
  error instanceof DaytonaNotFoundError ||
  error instanceof DaytonaUnprocessableEntityError;

const isCommandTimeout = (error: unknown): boolean =>
  error instanceof DaytonaProcessExecutionTimeoutError ||
  (
    error instanceof DaytonaTimeoutError &&
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'PROCESS_EXECUTION_TIMEOUT'
  );

const originalLabels = (
  labels: Record<string, string>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(labels).filter(
      ([key]) =>
        key !== PROVISIONING_KEY_LABEL &&
        key !== SPEC_HASH_LABEL &&
        !INTERNAL_OWNERSHIP_LABELS.includes(
          key as (typeof INTERNAL_OWNERSHIP_LABELS)[number]
        )
    )
  );

const mapStatus = (state?: string): SandboxInspection['status'] => {
  switch (state) {
    case 'started':
      return 'ready';
    case 'stopped':
    case 'stopping':
    case 'paused':
    case 'pausing':
    case 'archived':
    case 'archiving':
      return 'stopped';
    case 'destroyed':
      return 'missing';
    case 'error':
    case 'build_failed':
    case 'unknown':
    case '11184809':
      return 'error';
    default:
      return 'creating';
  }
};

const absolutePath = (candidate: string): string =>
  `${WORKSPACE_ROOT}/${normalizeSandboxRelativePath(candidate)}`;

const relativePath = (candidate: string): string => {
  const normalized = candidate.replaceAll('\\', '/');
  if (!normalized.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new SandboxError(
      'SANDBOX_OWNERSHIP_MISMATCH',
      'Daytona returned a path outside the Sandbox workspace'
    );
  }
  return normalizeSandboxRelativePath(
    normalized.slice(`${WORKSPACE_ROOT}/`.length)
  );
};

const quoteShellToken = (value: string): string =>
  `'${value.replaceAll("'", "'\"'\"'")}'`;

const commandLine = (command: SandboxCommand): string =>
  [command.executable, ...command.args].map(quoteShellToken).join(' ');

const truncateUtf8 = (
  value: string,
  limit: number
): { value: string; truncated: boolean } => {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= limit) return { value, truncated: false };
  return {
    value: bytes.subarray(0, limit).toString('utf8'),
    truncated: true
  };
};

const timeoutSeconds = (milliseconds: number): number =>
  Math.max(1, Math.ceil(milliseconds / 1_000));

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new Error('Sandbox command aborted');

const safeProviderCause = (
  error: unknown
): { name: string; code?: string; statusCode?: number } | undefined => {
  if (!(error instanceof Error)) return undefined;
  const metadata = error as Error & {
    code?: unknown;
    statusCode?: unknown;
  };
  return {
    name: error.name,
    ...(typeof metadata.code === 'string' && { code: metadata.code }),
    ...(typeof metadata.statusCode === 'number' && {
      statusCode: metadata.statusCode
    })
  };
};

export class DaytonaProvider implements SandboxProvider {
  readonly kind = 'daytona';
  private readonly operationTimeoutMs: number;

  constructor(private readonly options: DaytonaProviderOptions) {
    this.operationTimeoutMs = options.operationTimeoutMs ?? 60_000;
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
        networkPolicy: true,
        checkpoints: false,
        reconnectAcrossProcessRestart: true
      }
    };
  }

  async create(spec: SandboxSpec): Promise<SandboxRef> {
    this.assertSupported(spec);
    const hash = specHash(spec);
    const existing = await this.findByProvisioningKey(spec.provisioningKey);
    if (existing) {
      if (existing.labels[SPEC_HASH_LABEL] !== hash) {
        throw new SandboxError(
          'SANDBOX_OWNERSHIP_MISMATCH',
          'Provisioning key belongs to a different Sandbox specification'
        );
      }
      return refOf(existing);
    }

    const params: CreateSandboxFromImageParams = {
      image: spec.runtime.image,
      public: false,
      labels: {
        ...spec.labels,
        'managed-by': 'open-v0',
        'workspace-id': spec.ownership.workspaceId,
        'project-id': spec.ownership.projectId,
        'branch-id': spec.ownership.branchId,
        ...(spec.ownership.runId && { 'run-id': spec.ownership.runId }),
        ...(spec.ownership.snapshotId && {
          'snapshot-id': spec.ownership.snapshotId
        }),
        [PROVISIONING_KEY_LABEL]: spec.provisioningKey,
        [SPEC_HASH_LABEL]: hash
      },
      resources: {
        cpu: spec.resources.cpu,
        memory: spec.resources.memoryMiB / 1_024,
        disk: spec.resources.diskMiB / 1_024
      },
      autoStopInterval: spec.lifecycle.autoStopSeconds === undefined
        ? 0
        : Math.max(1, Math.ceil(spec.lifecycle.autoStopSeconds / 60)),
      autoDeleteInterval: Math.max(
        1,
        Math.ceil(spec.lifecycle.autoDeleteSeconds / 60)
      ),
      ttlMinutes: Math.max(1, Math.ceil(spec.lifecycle.leaseSeconds / 60)),
      ...this.networkSettings(spec.networkPolicy)
    };

    try {
      const sandbox = await this.options.client.create(params, {
        timeout: timeoutSeconds(this.operationTimeoutMs)
      });
      await this.ensureWorkspace(sandbox);
      return refOf(sandbox);
    } catch (error) {
      throw new SandboxCreateError(
        'SANDBOX_PROVISION_FAILED',
        'Daytona Sandbox creation failed',
        !isCreateRejected(error),
        isCreateRejected(error) ? 'not-created' : 'unknown',
        safeProviderCause(error)
      );
    }
  }

  async connect(ref: SandboxRef): Promise<SandboxHandle> {
    this.assertRef(ref);
    const sandbox = await this.get(ref);
    return {
      ref: { ...ref },
      waitUntilReady: async ({ timeoutMs }) => {
        try {
          await sandbox.refreshData();
          if (sandbox.state === 'started') return;
          if (
            sandbox.state === 'stopped' ||
            sandbox.state === 'paused' ||
            sandbox.state === 'archived'
          ) {
            await sandbox.start(timeoutSeconds(timeoutMs));
          } else {
            await sandbox.waitUntilStarted(timeoutSeconds(timeoutMs));
          }
          await this.ensureWorkspace(sandbox);
        } catch (error) {
          throw new SandboxError(
            'SANDBOX_NOT_READY',
            'Daytona Sandbox did not become ready',
            true,
            safeProviderCause(error)
          );
        }
      },
      files: {
        writeFiles: async (files) => {
          const normalized = files.map((file) => ({
            source: Buffer.from(file.content),
            destination: absolutePath(file.path)
          }));
          await this.ensureDirectories(
            sandbox,
            normalized.map((file) => file.destination)
          );
          await sandbox.fs.uploadFiles(
            normalized,
            timeoutSeconds(this.operationTimeoutMs)
          );
        },
        readFile: async (path) =>
          new Uint8Array(
            await sandbox.fs.downloadFile(
              absolutePath(path),
              timeoutSeconds(this.operationTimeoutMs)
            )
          ),
        listFiles: async (directory) =>
          this.listFilesRecursively(sandbox, absolutePath(directory)),
        exists: async (path) => {
          try {
            await sandbox.fs.getFileDetails(absolutePath(path));
            return true;
          } catch (error) {
            if (isNotFound(error)) return false;
            throw error;
          }
        }
      },
      processes: {
        run: async (command, signal) =>
          this.runCommand(sandbox, command, signal),
        stopAll: async () => {
          await this.stopSandbox(sandbox);
        }
      },
      lifecycle: {
        heartbeat: async () => {
          await sandbox.refreshActivity();
        },
        stop: async () => {
          await this.stopSandbox(sandbox);
        }
      }
    };
  }

  async inspect(ref: SandboxRef): Promise<SandboxInspection> {
    this.assertRef(ref);
    try {
      const sandbox = await this.options.client.get(ref.externalId);
      return this.inspectionOf(sandbox);
    } catch (error) {
      if (isNotFound(error)) {
        return {
          ref: { ...ref },
          status: 'missing',
          provisioningKey: '',
          createdAt: new Date(0),
          labels: {}
        };
      }
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Daytona Sandbox inspection failed',
        true,
        safeProviderCause(error)
      );
    }
  }

  async list(filter: SandboxListFilter): Promise<SandboxRef[]> {
    const labels = {
      ...(filter.labels ?? {}),
      ...(filter.provisioningKey && {
        [PROVISIONING_KEY_LABEL]: filter.provisioningKey
      })
    };
    try {
      const sandboxes: DaytonaSandboxLike[] = [];
      for await (const sandbox of this.options.client.list({ labels })) {
        if (
          filter.provisioningKey !== undefined &&
          sandbox.labels[PROVISIONING_KEY_LABEL] !== filter.provisioningKey
        ) {
          continue;
        }
        if (
          !Object.entries(filter.labels ?? {}).every(
            ([key, value]) => sandbox.labels[key] === value
          )
        ) {
          continue;
        }
        sandboxes.push(sandbox);
      }
      return sandboxes
        .sort((left, right) =>
          (left.createdAt ?? '').localeCompare(right.createdAt ?? '') ||
          left.id.localeCompare(right.id)
        )
        .map(refOf);
    } catch (error) {
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Daytona Sandbox listing failed',
        true,
        safeProviderCause(error)
      );
    }
  }

  async destroy(
    ref: SandboxRef,
    options?: { wait?: boolean }
  ): Promise<SandboxDestroyReceipt> {
    this.assertRef(ref);
    let sandbox: DaytonaSandboxLike;
    try {
      sandbox = await this.options.client.get(ref.externalId);
    } catch (error) {
      if (isNotFound(error)) {
        return { accepted: true, missing: true, pending: false };
      }
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Daytona Sandbox lookup failed during destruction',
        true,
        safeProviderCause(error)
      );
    }

    const wait = options?.wait ?? true;
    try {
      await this.options.client.delete(
        sandbox,
        timeoutSeconds(this.operationTimeoutMs),
        wait
      );
      return { accepted: true, missing: false, pending: !wait };
    } catch (error) {
      if (isNotFound(error)) {
        return { accepted: true, missing: true, pending: false };
      }
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Daytona Sandbox destruction failed',
        true,
        safeProviderCause(error)
      );
    }
  }

  private async get(ref: SandboxRef): Promise<DaytonaSandboxLike> {
    try {
      return await this.options.client.get(ref.externalId);
    } catch (error) {
      if (isNotFound(error)) {
        throw new SandboxError(
          'SANDBOX_NOT_FOUND',
          'Daytona Sandbox resource not found'
        );
      }
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Daytona Sandbox connection failed',
        true,
        safeProviderCause(error)
      );
    }
  }

  private async findByProvisioningKey(
    key: string
  ): Promise<DaytonaSandboxLike | undefined> {
    const matches: DaytonaSandboxLike[] = [];
    try {
      for await (const sandbox of this.options.client.list({
        labels: { [PROVISIONING_KEY_LABEL]: key }
      })) {
        if (sandbox.labels[PROVISIONING_KEY_LABEL] === key) {
          matches.push(sandbox);
        }
      }
    } catch (error) {
      throw new SandboxCreateError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Daytona Sandbox lookup failed before creation',
        true,
        'not-created',
        safeProviderCause(error)
      );
    }
    return matches.sort((left, right) =>
      (left.createdAt ?? '').localeCompare(right.createdAt ?? '') ||
      left.id.localeCompare(right.id)
    )[0];
  }

  private inspectionOf(sandbox: DaytonaSandboxLike): SandboxInspection {
    return {
      ref: refOf(sandbox),
      status: mapStatus(sandbox.state),
      provisioningKey: sandbox.labels[PROVISIONING_KEY_LABEL] ?? '',
      createdAt: sandbox.createdAt ? new Date(sandbox.createdAt) : new Date(),
      labels: originalLabels(sandbox.labels)
    };
  }

  private assertSupported(spec: SandboxSpec): void {
    if (spec.ownership.purpose !== 'build') {
      throw new SandboxError(
        'SANDBOX_CAPABILITY_MISSING',
        'DaytonaProvider currently supports Build Sandboxes only'
      );
    }
    if (
      spec.runtime.workingDirectory !== WORKSPACE_ROOT ||
      !Number.isFinite(spec.resources.cpu) ||
      spec.resources.cpu <= 0 ||
      !Number.isFinite(spec.resources.memoryMiB) ||
      spec.resources.memoryMiB <= 0 ||
      !Number.isFinite(spec.resources.diskMiB) ||
      spec.resources.diskMiB <= 0
    ) {
      throw new SandboxError(
        'SANDBOX_POLICY_DENIED',
        'Daytona Sandbox specification is invalid'
      );
    }
  }

  private assertRef(ref: SandboxRef): void {
    if (ref.provider !== this.kind) {
      throw new SandboxError(
        'SANDBOX_OWNERSHIP_MISMATCH',
        'Sandbox reference belongs to a different provider'
      );
    }
  }

  private networkSettings(
    policy: NetworkPolicy
  ): Pick<
    CreateSandboxFromImageParams,
    'networkBlockAll' | 'networkAllowList' | 'domainAllowList'
  > {
    return {
      networkBlockAll: policy.defaultAction === 'deny',
      ...(policy.allowedCidrs.length > 0 && {
        networkAllowList: policy.allowedCidrs.join(',')
      }),
      ...(policy.allowedDomains.length > 0 && {
        domainAllowList: policy.allowedDomains.join(',')
      })
    };
  }

  private async ensureWorkspace(sandbox: DaytonaSandboxLike): Promise<void> {
    try {
      const details = await sandbox.fs.getFileDetails(WORKSPACE_ROOT);
      if (!details.isDir) {
        throw new SandboxError(
          'SANDBOX_POLICY_DENIED',
          'Daytona workspace path is not a directory'
        );
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await sandbox.fs.createFolder(WORKSPACE_ROOT, '755');
    }
  }

  private async ensureDirectories(
    sandbox: DaytonaSandboxLike,
    paths: string[]
  ): Promise<void> {
    const directories = new Set<string>([WORKSPACE_ROOT]);
    for (const path of paths) {
      const segments = path.split('/').slice(1, -1);
      let current = '';
      for (const segment of segments) {
        current += `/${segment}`;
        directories.add(current);
      }
    }
    for (const directory of [...directories].sort(
      (left, right) => left.length - right.length
    )) {
      try {
        const details = await sandbox.fs.getFileDetails(directory);
        if (!details.isDir) {
          throw new SandboxError(
            'SANDBOX_POLICY_DENIED',
            'Daytona upload parent is not a directory'
          );
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
        await sandbox.fs.createFolder(directory, '755');
      }
    }
  }

  private async listFilesRecursively(
    sandbox: DaytonaSandboxLike,
    root: string
  ): Promise<string[]> {
    const files: string[] = [];
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_LIST_DEPTH) {
        throw new SandboxError(
          'SANDBOX_SOURCE_UNAVAILABLE',
          'Daytona directory tree exceeds the supported depth'
        );
      }
      // Some self-hosted Toolbox versions ignore the SDK depth option and
      // omit FileInfo.path. Traverse one level at a time using the stable
      // name/isDir fields so nested build assets are never silently dropped.
      const entries = await sandbox.fs.listFiles(directory);
      for (const entry of entries) {
        const name = entry.name.replaceAll('\\', '/');
        if (
          !name ||
          name === '.' ||
          name === '..' ||
          name.includes('/') ||
          name.includes('\0')
        ) {
          throw new SandboxError(
            'SANDBOX_OWNERSHIP_MISMATCH',
            'Daytona returned an unsafe directory entry'
          );
        }
        const path = `${directory}/${name}`;
        if (entry.isDir) {
          await visit(path, depth + 1);
        } else {
          files.push(relativePath(path));
        }
      }
    };
    await visit(root, 1);
    return files.sort();
  }

  private async runCommand(
    sandbox: DaytonaSandboxLike,
    command: SandboxCommand,
    signal?: AbortSignal
  ): Promise<SandboxCommandResult> {
    let commandCwdAllowed = command.cwd === WORKSPACE_ROOT;
    if (command.cwd.startsWith(`${WORKSPACE_ROOT}/`)) {
      const relativeCwd = normalizeSandboxRelativePath(
        command.cwd.slice(`${WORKSPACE_ROOT}/`.length)
      );
      commandCwdAllowed =
        command.cwd === `${WORKSPACE_ROOT}/${relativeCwd}`;
    }
    if (
      !command.executable ||
      !commandCwdAllowed ||
      !Number.isSafeInteger(command.timeoutMs) ||
      command.timeoutMs <= 0 ||
      !Number.isSafeInteger(command.maxOutputBytes) ||
      command.maxOutputBytes <= 0
    ) {
      throw new SandboxError(
        'SANDBOX_POLICY_DENIED',
        'Sandbox command violates the Daytona execution policy'
      );
    }
    if (signal?.aborted) throw abortReason(signal);

    const startedAt = Date.now();
    const execution = sandbox.process.executeCommand(
      commandLine(command),
      command.cwd,
      command.env,
      timeoutSeconds(command.timeoutMs)
    );
    let onAbort: (() => void) | undefined;
    const aborted = signal
      ? new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            void this.stopSandbox(sandbox).catch(() => undefined);
            reject(abortReason(signal));
          };
          signal.addEventListener('abort', onAbort, { once: true });
        })
      : undefined;

    try {
      const result = await (aborted
        ? Promise.race([execution, aborted])
        : execution);
      const stdout = truncateUtf8(result.result ?? '', command.maxOutputBytes);
      return {
        exitCode: result.exitCode,
        stdout: stdout.value,
        stderr: '',
        durationMs: Date.now() - startedAt,
        timedOut: false,
        outputTruncated: stdout.truncated
      };
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (isCommandTimeout(error)) {
        return {
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: Date.now() - startedAt,
          timedOut: true,
          outputTruncated: false
        };
      }
      throw new SandboxError(
        'SANDBOX_PROVIDER_UNAVAILABLE',
        'Daytona command execution failed',
        true,
        safeProviderCause(error)
      );
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  }

  private async stopSandbox(sandbox: DaytonaSandboxLike): Promise<void> {
    await sandbox.stop(timeoutSeconds(this.operationTimeoutMs), true);
  }
}
