import {
  DelayedError,
  Worker,
  type ConnectionOptions,
  type Job
} from 'bullmq';
import {
  processAgentRun,
  processValidationCandidate
} from './orchestrator';
import { agentRunJobName, retryValidationJobName } from './queue';
import type {
  AgentRunJobData,
  AgentRunStatus,
  ModelClient
} from './types';
import type { ProjectValidator } from './validator';
import {
  acquireBranchExecution,
  type BranchExecutionGuard
} from '../branches/branchExecution';
import { AgentRun } from '../models/AgentRun';
import { BranchExecutionLease } from '../models/BranchExecutionLease';
import { ProjectBranch } from '../models/ProjectBranch';
import { isTerminalAgentRunStatus } from './stateMachine';

export interface AgentJobProcessorDependencies {
  modelClient: ModelClient;
  resolveModelClient?: (runId: string) => Promise<ModelClient>;
  validator: ProjectValidator;
  processRun?: typeof processAgentRun;
  processValidation?: typeof processValidationCandidate;
  acquireBranchExecution?: (
    runId: string
  ) => Promise<BranchExecutionGuard | null>;
  loadRunStatus?: (
    runId: string
  ) => Promise<AgentRunStatus | undefined>;
  markRunWaiting?: (runId: string) => Promise<void>;
  branchRetryDelayMs?: number;
}

type AgentProcessorJob =
  Pick<Job<AgentRunJobData>, 'name' | 'data'> &
  Partial<Pick<Job<AgentRunJobData>, 'moveToDelayed'>>;

export const createAgentJobProcessor = (
  dependencies: AgentJobProcessorDependencies
) => async (
  job: AgentProcessorJob,
  token?: string
): Promise<void> => {
  if (
    job.name !== agentRunJobName &&
    job.name !== retryValidationJobName
  ) {
    throw new Error(`Unsupported job name: ${job.name}`);
  }

  const loadRunStatus = dependencies.loadRunStatus ??
    (async (runId: string) => (
      await AgentRun.findById(runId).select('status')
    )?.status);
  const initialStatus = await loadRunStatus(job.data.runId);
  if (!initialStatus || isTerminalAgentRunStatus(initialStatus)) {
    return;
  }

  const acquire = dependencies.acquireBranchExecution ??
    acquireBranchExecution;
  const execution = await acquire(job.data.runId);
  if (!execution) {
    const markRunWaiting = dependencies.markRunWaiting ??
      (async (runId: string) => {
        await AgentRun.updateOne(
          {
            _id: runId,
            status: { $in: ['queued', 'waiting_for_capacity'] }
          },
          { $set: { status: 'waiting_for_capacity' } }
        );
      });
    await markRunWaiting(job.data.runId);
    if (!job.moveToDelayed) {
      throw new Error('BullMQ job cannot be delayed');
    }
    await job.moveToDelayed(
      Date.now() + (dependencies.branchRetryDelayMs ?? 2_000),
      token
    );
    throw new DelayedError();
  }

  if (
    initialStatus === 'waiting_for_capacity' &&
    job.name === agentRunJobName
  ) {
    const waitingRun = await AgentRun.findById(job.data.runId)
      .select('branchId');
    const branch = await ProjectBranch.findById(waitingRun?.branchId)
      .select('headSnapshotId headVersion');
    if (!branch) {
      await execution.release();
      throw new Error(`ProjectBranch not found for Run ${job.data.runId}`);
    }
    const rebased = await AgentRun.updateOne(
      { _id: job.data.runId, status: 'waiting_for_capacity' },
      {
        $set: {
          status: 'queued',
          baseSnapshotId: branch.headSnapshotId,
          baseHeadVersion: branch.headVersion,
          baseSnapshotRevision: branch.headVersion
        }
      }
    );
    if (rebased.modifiedCount !== 1) {
      await execution.release();
      return;
    }
    await BranchExecutionLease.updateOne(
      { branchId: waitingRun?.branchId, runId: job.data.runId },
      { $set: { baseHeadVersion: branch.headVersion } }
    );
  } else if (initialStatus === 'waiting_for_capacity') {
    await AgentRun.updateOne(
      { _id: job.data.runId, status: 'waiting_for_capacity' },
      { $set: { status: 'queued' } }
    );
  }

  try {
    if (job.name === retryValidationJobName) {
      await (
        dependencies.processValidation ??
        processValidationCandidate
      )(job.data, dependencies.validator, execution);
      return;
    }
    const modelClient = dependencies.resolveModelClient && initialStatus !== 'persisting'
      ? await dependencies.resolveModelClient(job.data.runId)
      : dependencies.modelClient;
    await (dependencies.processRun ?? processAgentRun)(
      job.data,
      modelClient,
      dependencies.validator,
      execution
    );
  } finally {
    await execution.release();
  }
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
