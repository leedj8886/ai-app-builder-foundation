import {
  Worker,
  type ConnectionOptions,
  type Job
} from 'bullmq';
import {
  processAgentRun,
  processValidationCandidate
} from './orchestrator';
import { agentRunJobName, retryValidationJobName } from './queue';
import type { AgentRunJobData, ModelClient } from './types';
import type { ProjectValidator } from './validator';

export interface AgentJobProcessorDependencies {
  modelClient: ModelClient;
  validator: ProjectValidator;
  processRun?: typeof processAgentRun;
  processValidation?: typeof processValidationCandidate;
}

export const createAgentJobProcessor = (
  dependencies: AgentJobProcessorDependencies
) => async (
  job: Pick<Job<AgentRunJobData>, 'name' | 'data'>
): Promise<void> => {
  if (job.name === retryValidationJobName) {
    await (
      dependencies.processValidation ??
      processValidationCandidate
    )(job.data, dependencies.validator);
    return;
  }

  if (job.name !== agentRunJobName) {
    throw new Error(`Unsupported job name: ${job.name}`);
  }

  await (dependencies.processRun ?? processAgentRun)(
    job.data,
    dependencies.modelClient,
    dependencies.validator
  );
};

export interface CreateAgentWorkerOptions extends AgentJobProcessorDependencies {
  connection: ConnectionOptions;
  queueName: string;
  concurrency?: number;
}

export const createAgentWorker = (
  options: CreateAgentWorkerOptions
): Worker<AgentRunJobData> => new Worker<AgentRunJobData>(
  options.queueName,
  createAgentJobProcessor(options),
  {
    connection: options.connection,
    concurrency: options.concurrency ?? 2
  }
);
