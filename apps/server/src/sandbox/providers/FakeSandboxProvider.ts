import { SandboxCreateError, SandboxError } from '../errors';
import { normalizeSandboxRelativePath } from '../path';
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

export interface FakeSandboxResource {
  ref: SandboxRef;
  spec: SandboxSpec;
  status: SandboxInspection['status'];
  createdAt: Date;
  files: ReadonlyMap<string, Uint8Array>;
  commands: readonly SandboxCommand[];
}

interface MutableFakeSandboxResource {
  ref: SandboxRef;
  spec: SandboxSpec;
  fingerprint: string;
  status: SandboxInspection['status'];
  createdAt: Date;
  files: Map<string, Uint8Array>;
  commands: SandboxCommand[];
  readiness: 'ready' | 'timeout';
  pendingDestroyAttempts: number;
}

interface NextCreateFailure {
  outcome: 'not-created' | 'unknown';
  createResourceBeforeThrow: boolean;
}

const refKey = (ref: SandboxRef): string => `${ref.provider}:${ref.externalId}`;
const fingerprint = (spec: SandboxSpec): string => JSON.stringify(spec);

export class FakeSandboxState {
  private readonly entries = new Map<string, MutableFakeSandboxResource>();
  private sequence = 0;
  private nextCreateFailure?: NextCreateFailure;
  private readonly commandResults: SandboxCommandResult[] = [];
  private buildOutput = new Map<string, Uint8Array>();
  private readonly readinessTimeoutValues: number[] = [];
  private heartbeatCalls = 0;
  private blockNextCommand = false;

  failNextCreate(input: NextCreateFailure): void {
    this.nextCreateFailure = input;
  }

  setNextCommandResult(result: SandboxCommandResult): void {
    this.commandResults.length = 0;
    this.commandResults.push(structuredClone(result));
  }

  enqueueCommandResult(result: SandboxCommandResult): void {
    this.commandResults.push(structuredClone(result));
  }

  setBuildOutput(
    files: Array<{ path: string; content: string | Uint8Array }>
  ): void {
    this.buildOutput = new Map(files.map(file => [
      normalizeSandboxRelativePath(`dist/${file.path}`),
      typeof file.content === 'string'
        ? new TextEncoder().encode(file.content)
        : new Uint8Array(file.content)
    ]));
  }

  applyBuildOutput(resource: MutableFakeSandboxResource): void {
    for (const [path, content] of this.buildOutput) {
      resource.files.set(path, new Uint8Array(content));
    }
  }

  takeCommandResult(): SandboxCommandResult | undefined {
    return this.commandResults.shift();
  }

  recordReadinessTimeout(timeoutMs: number): void {
    this.readinessTimeoutValues.push(timeoutMs);
  }

  readinessTimeouts(): readonly number[] {
    return [...this.readinessTimeoutValues];
  }

  recordHeartbeat(): void {
    this.heartbeatCalls += 1;
  }

  heartbeatCount(): number {
    return this.heartbeatCalls;
  }

  blockNextCommandUntilAbort(): void {
    this.blockNextCommand = true;
  }

  takeBlockedCommand(): boolean {
    const blocked = this.blockNextCommand;
    this.blockNextCommand = false;
    return blocked;
  }

  setReadiness(ref: SandboxRef, value: 'ready' | 'timeout'): void {
    this.require(ref).readiness = value;
  }

  setMissing(ref: SandboxRef): void {
    this.require(ref).status = 'missing';
  }

  delayDestroy(ref: SandboxRef, attempts: number): void {
    this.require(ref).pendingDestroyAttempts = attempts;
  }

  seedDuplicate(spec: SandboxSpec): SandboxRef {
    return this.insert(spec).ref;
  }

  advanceDestroy(ref: SandboxRef): void {
    const resource = this.require(ref);
    resource.pendingDestroyAttempts = Math.max(
      0,
      resource.pendingDestroyAttempts - 1
    );
  }

  resources(): ReadonlyArray<FakeSandboxResource> {
    return [...this.entries.values()].map((resource) => ({
      ref: { ...resource.ref },
      spec: structuredClone(resource.spec),
      status: resource.status,
      createdAt: new Date(resource.createdAt),
      files: new Map(
        [...resource.files].map(([path, content]) => [
          path,
          new Uint8Array(content)
        ])
      ),
      commands: resource.commands.map((command) => structuredClone(command))
    }));
  }

  takeCreateFailure(): NextCreateFailure | undefined {
    const failure = this.nextCreateFailure;
    this.nextCreateFailure = undefined;
    return failure;
  }

  insert(spec: SandboxSpec): MutableFakeSandboxResource {
    const ref = {
      provider: 'fake',
      externalId: `fake-${++this.sequence}`
    };
    const resource: MutableFakeSandboxResource = {
      ref,
      spec: structuredClone(spec),
      fingerprint: fingerprint(spec),
      status: 'ready',
      createdAt: new Date(this.sequence),
      files: new Map(),
      commands: [],
      readiness: 'ready',
      pendingDestroyAttempts: 0
    };
    this.entries.set(refKey(ref), resource);
    return resource;
  }

  findByProvisioningKey(key: string): MutableFakeSandboxResource[] {
    return [...this.entries.values()].filter(
      (resource) =>
        resource.status !== 'missing' &&
        resource.spec.provisioningKey === key
    );
  }

  get(ref: SandboxRef): MutableFakeSandboxResource | undefined {
    return this.entries.get(refKey(ref));
  }

  require(ref: SandboxRef): MutableFakeSandboxResource {
    const resource = this.get(ref);
    if (!resource || resource.status === 'missing') {
      throw new SandboxError('SANDBOX_NOT_FOUND', 'Sandbox resource not found');
    }
    return resource;
  }
}

export class FakeSandboxProvider implements SandboxProvider {
  readonly kind = 'fake';

  constructor(private readonly state: FakeSandboxState) {}

  async describe(): Promise<SandboxProviderDescriptor> {
    return {
      protocolVersion: 'sandbox-provider/v1',
      kind: this.kind,
      capabilities: {
        files: true,
        processes: true,
        lifecycle: true,
        preview: true,
        networkPolicy: true,
        checkpoints: false,
        reconnectAcrossProcessRestart: true
      }
    };
  }

  async create(spec: SandboxSpec): Promise<SandboxRef> {
    const existing = this.state.findByProvisioningKey(spec.provisioningKey)[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint(spec)) {
        throw new SandboxError(
          'SANDBOX_OWNERSHIP_MISMATCH',
          'Provisioning key belongs to a different Sandbox specification'
        );
      }
      return { ...existing.ref };
    }

    const failure = this.state.takeCreateFailure();
    if (failure && !failure.createResourceBeforeThrow) {
      throw new SandboxCreateError(
        'SANDBOX_PROVISION_FAILED',
        'Sandbox creation failed',
        true,
        failure.outcome
      );
    }

    const resource = this.state.insert(spec);
    if (failure) {
      throw new SandboxCreateError(
        'SANDBOX_PROVISION_FAILED',
        'Sandbox creation result is unknown',
        true,
        failure.outcome
      );
    }
    return { ...resource.ref };
  }

  async connect(ref: SandboxRef): Promise<SandboxHandle> {
    this.assertRef(ref);
    const resource = this.state.require(ref);
    const ensurePresent = () => this.state.require(ref);

    return {
      ref: { ...resource.ref },
      waitUntilReady: async ({ timeoutMs }) => {
        this.state.recordReadinessTimeout(timeoutMs);
        const current = ensurePresent();
        if (current.readiness === 'timeout') {
          throw new SandboxError(
            'SANDBOX_NOT_READY',
            'Sandbox readiness timed out',
            true
          );
        }
      },
      files: {
        writeFiles: async (files) => {
          const current = ensurePresent();
          for (const file of files) {
            current.files.set(
              normalizeSandboxRelativePath(file.path),
              new Uint8Array(file.content)
            );
          }
        },
        readFile: async (path) => {
          const content = ensurePresent().files.get(
            normalizeSandboxRelativePath(path)
          );
          if (!content) {
            throw new SandboxError(
              'SANDBOX_NOT_FOUND',
              'Sandbox file not found'
            );
          }
          return new Uint8Array(content);
        },
        listFiles: async (directory) => {
          const prefix = `${normalizeSandboxRelativePath(directory)}/`;
          return [...ensurePresent().files.keys()]
            .filter(path => path.startsWith(prefix))
            .sort();
        },
        exists: async (path) =>
          ensurePresent().files.has(normalizeSandboxRelativePath(path))
      },
      processes: {
        run: async (command, signal): Promise<SandboxCommandResult> => {
          const current = ensurePresent();
          current.commands.push(structuredClone(command));
          if (this.state.takeBlockedCommand()) {
            await new Promise<void>((resolve) => {
              if (signal?.aborted) return resolve();
              signal?.addEventListener('abort', () => resolve(), {
                once: true
              });
            });
          }
          const result = this.state.takeCommandResult();
          if (
            command.args.includes('build') &&
            (result?.exitCode ?? 0) === 0
          ) {
            this.state.applyBuildOutput(current);
          }
          return result ?? {
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 0,
            timedOut: false,
            outputTruncated: false
          };
        },
        stopAll: async () => undefined
      },
      lifecycle: {
        heartbeat: async () => {
          ensurePresent();
          this.state.recordHeartbeat();
        },
        stop: async () => {
          ensurePresent().status = 'stopped';
        }
      }
    };
  }

  async inspect(ref: SandboxRef): Promise<SandboxInspection> {
    this.assertRef(ref);
    const resource = this.state.get(ref);
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
    return this.state
      .resources()
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
    this.assertRef(ref);
    const resource = this.state.get(ref);
    if (!resource || resource.status === 'missing') {
      return { accepted: true, missing: true, pending: false };
    }
    if (resource.pendingDestroyAttempts > 0) {
      return { accepted: true, missing: false, pending: true };
    }
    resource.status = 'missing';
    return { accepted: true, missing: false, pending: false };
  }

  private assertRef(ref: SandboxRef): void {
    if (ref.provider !== this.kind) {
      throw new SandboxError(
        'SANDBOX_OWNERSHIP_MISMATCH',
        'Sandbox reference belongs to a different provider'
      );
    }
  }
}
