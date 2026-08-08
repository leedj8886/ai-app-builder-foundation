export const agentRunStatuses = [
  'waiting_for_capacity',
  'queued',
  'running',
  'planning',
  'generating',
  'validating',
  'repairing',
  'persisting',
  'completed',
  'completed_with_conflict',
  'failed',
  'cancelled'
] as const;

export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const terminalAgentRunStatuses = [
  'completed',
  'completed_with_conflict',
  'failed',
  'cancelled'
] as const;

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
  'validation.step',
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
  kind?: 'generate' | 'retry-validation';
  candidateId?: string;
}

export interface AgentErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export const projectFileLanguages = [
  'ts',
  'tsx',
  'js',
  'css',
  'json',
  'html',
  'md',
  'prisma',
  'sql'
] as const;

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

export const validationPhases = [
  'structure',
  'dependencies',
  'prisma',
  'migration',
  'api-test',
  'type-check',
  'build',
  'runtime-smoke'
] as const;

export type ValidationPhase = (typeof validationPhases)[number];

export const validationStageIds = [
  'structure',
  'install',
  'prisma-validate',
  'prisma-generate',
  'migration-history',
  'migration-replay',
  'type-check',
  'nest-type-check',
  'api-test',
  'build',
  'web-api-build',
  'runtime-smoke'
] as const;

export type ValidationStageId = (typeof validationStageIds)[number];

export const validationErrorCategories = [
  'CODE_ERROR',
  'DEPENDENCY_ERROR',
  'INFRA_ERROR',
  'STYLING_CONFIGURATION_ERROR'
] as const;

export type ValidationErrorCategory =
  (typeof validationErrorCategories)[number];

export interface ValidationCheckResult {
  name: ValidationStageId;
  phase?: ValidationPhase;
  status?: 'passed' | 'failed' | 'retrying' | 'skipped';
  category?: ValidationErrorCategory;
  command?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  cache?: 'hit' | 'miss' | 'not-applicable';
  attempt?: number;
  stylingIssues?: import('./styling/types').StylingIssue[];
}

export interface ValidationResult {
  status: 'passed' | 'failed' | 'skipped';
  verification?: 'verified' | 'simulated';
  previewArtifactId?: string;
  checks: ValidationCheckResult[];
  category?: ValidationErrorCategory;
  retryable?: boolean;
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

export interface AgentPlanStep {
  title: string;
  intent: string;
  filesLikelyTouched: string[];
}

export interface AgentPlan {
  summary: string;
  steps: AgentPlanStep[];
  assumptions: string[];
}

export interface AgentContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentContextFile {
  path: string;
  content?: string;
}

export interface AgentAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  content: string;
}

export interface AgentContextAttachment extends AgentAttachment {
  content: string;
}

export interface AgentContext {
  prompt: string;
  mode: AgentRunMode;
  project: {
    name: string;
    description?: string;
    profile?: import('./profiles/types').ProfileRef;
    capabilities?: string[];
    editablePaths?: string[];
    platformManagedPaths?: string[];
    generationInstructions?: string;
    framework?: 'react';
    styling?: 'tailwind';
    uiLibrary?: string;
  };
  messages: AgentContextMessage[];
  attachments?: AgentContextAttachment[];
  files: AgentContextFile[];
}

export interface PlanInput {
  context: AgentContext;
}

export interface GenerateInput {
  context: AgentContext;
  plan: AgentPlan;
}

export interface RepairInput {
  context: AgentContext;
  plan: AgentPlan;
  attempt: number;
  files: ProjectFile[];
  validation: ValidationResult;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelResult<T> {
  value: T;
  usage?: ModelUsage;
}

export interface ModelClient {
  generatePlan(input: PlanInput): Promise<ModelResult<AgentPlan>>;
  generateFiles(input: GenerateInput): Promise<ModelResult<GenerationResult>>;
  repairFiles(input: RepairInput): Promise<ModelResult<GenerationResult>>;
  repairDependencies?(
    input: RepairInput
  ): Promise<ModelResult<GenerationResult>>;
}
