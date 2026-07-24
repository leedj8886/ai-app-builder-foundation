import { AgentRun } from '../models/AgentRun';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { emitAgentEvent } from './eventBus';
import { applyFileOperations } from './fileOperations';
import { buildPhaseTwoGeneration } from './snapshotGenerator';
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

export const buildPhaseTwoWorkerEvents = (): PhaseOneWorkerEvent[] => [
  { type: 'run.started', message: 'Agent run started' },
  { type: 'agent.step', message: 'Generating structured file operations' },
  { type: 'agent.step', message: 'Persisting project snapshot' },
  { type: 'run.completed', message: 'Agent run completed with a project snapshot' }
];

export const processAgentRun = async (job: AgentRunJobData): Promise<void> => {
  const run = await AgentRun.findById(job.runId);

  if (!run) {
    throw new Error(`AgentRun not found: ${job.runId}`);
  }

  run.status = 'running';
  run.startedAt = new Date();
  await run.save();

  const [startedEvent, generateEvent, persistEvent, completedEvent] = buildPhaseTwoWorkerEvents();

  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: startedEvent.type,
    message: startedEvent.message
  });

  run.status = 'generating';
  await run.save();

  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: generateEvent.type,
    message: generateEvent.message,
    payload: { phase: 'phase-2' }
  });

  const baseSnapshot = run.baseSnapshotId
    ? await ProjectSnapshot.findOne({
        _id: run.baseSnapshotId,
        projectId: run.projectId,
        userId: run.userId
      })
    : null;
  const generation = buildPhaseTwoGeneration(run.prompt);
  const files = applyFileOperations(
    baseSnapshot?.files ?? [],
    generation.operations,
    run._id
  );

  for (const operation of generation.operations) {
    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'file.changed',
      message: `${operation.type} ${operation.path}`,
      payload: {
        operation: operation.type,
        path: operation.path
      }
    });
  }

  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: persistEvent.type,
    message: persistEvent.message,
    payload: { fileCount: files.length }
  });

  const snapshot = await ProjectSnapshot.create({
    userId: run.userId,
    projectId: run.projectId,
    sourceRunId: run._id,
    parentSnapshotId: baseSnapshot?._id,
    files,
    packageJson: {
      dependencies: generation.dependencies,
      devDependencies: generation.devDependencies,
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        'type-check': 'tsc --noEmit'
      }
    },
    validation: {
      status: 'skipped',
      checks: []
    },
    summary: generation.message
  });

  run.status = 'completed';
  run.resultSnapshotId = snapshot._id;
  run.completedAt = new Date();
  await run.save();

  await emitAgentEvent({
    runId: run._id,
    userId: run.userId,
    projectId: run.projectId,
    type: completedEvent.type,
    message: completedEvent.message,
    payload: {
      snapshotId: snapshot._id.toString(),
      fileCount: files.length
    }
  });
};
