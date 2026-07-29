export type SandboxPurpose = 'build' | 'preview';

export type SandboxLeaseState =
  | 'reserved'
  | 'provisioning'
  | 'ready'
  | 'running'
  | 'terminating'
  | 'terminated'
  | 'failed'
  | 'lost';

export interface ResourceProfile {
  cpu: number;
  memoryMiB: number;
  diskMiB: number;
}

export interface SandboxOwnership {
  workspaceId: string;
  projectId: string;
  branchId: string;
  runId?: string;
  snapshotId?: string;
  purpose: SandboxPurpose;
}

export interface NetworkPolicy {
  defaultAction: 'deny' | 'allow';
  allowedDomains: string[];
  allowedCidrs: string[];
}

export interface SandboxSpec {
  provisioningKey: string;
  ownership: SandboxOwnership;
  runtime: { image: string; workingDirectory: string };
  resources: ResourceProfile;
  networkPolicy: NetworkPolicy;
  lifecycle: {
    leaseSeconds: number;
    autoStopSeconds?: number;
    autoDeleteSeconds: number;
  };
  labels: Record<string, string>;
}

export interface SandboxRef {
  provider: string;
  externalId: string;
}

export interface SandboxCommand {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputTruncated: boolean;
}

export interface SandboxProviderDescriptor {
  protocolVersion: 'sandbox-provider/v1';
  kind: string;
  capabilities: {
    files: true;
    processes: true;
    lifecycle: true;
    preview: boolean;
    networkPolicy: boolean;
    checkpoints: boolean;
    reconnectAcrossProcessRestart: boolean;
  };
}

export interface SandboxInspection {
  ref: SandboxRef;
  status: 'creating' | 'ready' | 'running' | 'stopped' | 'missing' | 'error';
  provisioningKey: string;
  createdAt: Date;
  labels: Record<string, string>;
}

export interface SandboxListFilter {
  provisioningKey?: string;
  labels?: Record<string, string>;
}

export interface SandboxDestroyReceipt {
  accepted: boolean;
  missing: boolean;
  pending: boolean;
}

export interface SandboxFileSystem {
  writeFiles(files: Array<{ path: string; content: Uint8Array }>): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  listFiles(directory: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

export interface SandboxProcesses {
  run(
    command: SandboxCommand,
    signal?: AbortSignal
  ): Promise<SandboxCommandResult>;
  stopAll(): Promise<void>;
}

export interface SandboxLifecycle {
  heartbeat(): Promise<void>;
  stop(): Promise<void>;
}

export interface SandboxPreview {
  start(port: number): Promise<{ internalEndpoint: string }>;
}

export interface SandboxNetworkControl {
  apply(policy: NetworkPolicy): Promise<void>;
}

export interface SandboxCheckpoints {
  create(name: string): Promise<{ checkpointId: string }>;
}

export interface SandboxHandle {
  readonly ref: SandboxRef;
  waitUntilReady(input: { timeoutMs: number }): Promise<void>;
  files: SandboxFileSystem;
  processes: SandboxProcesses;
  lifecycle: SandboxLifecycle;
  preview?: SandboxPreview;
  network?: SandboxNetworkControl;
  checkpoints?: SandboxCheckpoints;
}
