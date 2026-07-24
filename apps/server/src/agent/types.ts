export const agentRunStatuses = [
  'queued',
  'running',
  'planning',
  'generating',
  'validating',
  'repairing',
  'completed',
  'failed',
  'cancelled'
] as const;

export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const terminalAgentRunStatuses = ['completed', 'failed', 'cancelled'] as const;

export type TerminalAgentRunStatus = (typeof terminalAgentRunStatuses)[number];

export const agentRunModes = ['create', 'edit'] as const;

export type AgentRunMode = (typeof agentRunModes)[number];

export const agentEventTypes = [
  'run.created',
  'run.started',
  'agent.step',
  'agent.plan',
  'file.changed',
  'validation.started',
  'validation.failed',
  'validation.passed',
  'repair.started',
  'run.completed',
  'run.failed',
  'run.cancelled'
] as const;

export type AgentEventType = (typeof agentEventTypes)[number];

export interface AgentRunJobData {
  runId: string;
}

export interface AgentErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export const projectFileLanguages = ['ts', 'tsx', 'css', 'json', 'html', 'md'] as const;

export type ProjectFileLanguage = (typeof projectFileLanguages)[number];

export interface ProjectFile {
  path: string;
  content: string;
  language: ProjectFileLanguage;
  generatedByRunId?: import('mongoose').Types.ObjectId;
}

export interface ProjectSnapshotPackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

export interface ValidationCheckResult {
  name: 'type-check' | 'build';
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ValidationResult {
  status: 'passed' | 'failed' | 'skipped';
  checks: ValidationCheckResult[];
}

export type FileOperation =
  | { type: 'create'; path: string; content: string }
  | { type: 'update'; path: string; content: string }
  | { type: 'delete'; path: string };

export interface GenerationResult {
  message: string;
  operations: FileOperation[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}
