import {
  AgentRunStatus,
  terminalAgentRunStatuses
} from './types';

const allowedTransitions: Record<AgentRunStatus, AgentRunStatus[]> = {
  waiting_for_capacity: ['queued', 'cancelled'],
  queued: ['waiting_for_capacity', 'running', 'cancelled'],
  running: ['planning', 'validating', 'cancelled', 'failed'],
  planning: ['generating', 'cancelled', 'failed'],
  generating: ['validating', 'cancelled', 'failed'],
  validating: ['repairing', 'persisting', 'failed', 'cancelled'],
  repairing: ['generating', 'failed', 'cancelled'],
  persisting: ['completed', 'completed_with_conflict', 'failed'],
  completed: [],
  completed_with_conflict: [],
  failed: [],
  cancelled: []
};

export const isTerminalAgentRunStatus = (status: AgentRunStatus): boolean =>
  terminalAgentRunStatuses.includes(status as never);

export const canTransitionAgentRun = (
  from: AgentRunStatus,
  to: AgentRunStatus
): boolean => allowedTransitions[from].includes(to);

export const assertAgentRunTransition = (
  from: AgentRunStatus,
  to: AgentRunStatus
): void => {
  if (!canTransitionAgentRun(from, to)) {
    throw new Error(`Invalid AgentRun status transition: ${from} -> ${to}`);
  }
};
