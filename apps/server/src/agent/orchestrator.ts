import { AgentRun } from '../models/AgentRun';
import { emitAgentEvent } from './eventBus';
import { AgentEventType, AgentRunJobData } from './types';

interface PhaseOneWorkerEvent {
  type: AgentEventType;
  message: string;
}

export const buildPhaseOneWorkerEvents = (): PhaseOneWorkerEvent[] => [
  { type: 'run.started', message: 'Agent run started' },
  { type: 'agent.step', message: 'Phase 1 worker received the run' },
  { type: 'run.completed', message: 'Phase 1 fake worker completed the run' }
];

export const processAgentRun = async (job: AgentRunJobData): Promise<void> => {
  const run = await AgentRun.findById(job.runId);

  if (!run) {
    throw new Error(`AgentRun not found: ${job.runId}`);
  }

  run.status = 'running';
  run.startedAt = new Date();
  await run.save();

  const [startedEvent, stepEvent, completedEvent] = buildPhaseOneWorkerEvents();

  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: startedEvent.type,
    message: startedEvent.message
  });

  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: stepEvent.type,
    message: stepEvent.message,
    payload: { phase: 'phase-1' }
  });

  run.status = 'completed';
  run.completedAt = new Date();
  await run.save();

  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: completedEvent.type,
    message: completedEvent.message
  });
};
