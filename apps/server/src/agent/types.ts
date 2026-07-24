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
