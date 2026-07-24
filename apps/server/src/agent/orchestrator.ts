import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { getAgentConfig } from './config';
import { loadAgentContext } from './contextBuilder';
import { mergeProjectPackageJson } from './dependencies';
import { emitAgentEvent } from './eventBus';
import { applyFileOperations } from './fileOperations';
import { assertAgentRunTransition } from './stateMachine';
import {
  AgentContext,
  AgentEventType,
  AgentRunJobData,
  ModelClient,
  ModelUsage,
  ProjectFile,
  ProjectSnapshotPackageJson
} from './types';

interface WorkerEvent {
  type: AgentEventType;
  message: string;
  payload?: unknown;
}

interface RunAgentGenerationInput {
  context: AgentContext;
  baseFiles: ProjectFile[];
  basePackageJson?: ProjectSnapshotPackageJson;
  generatedByRunId?: Types.ObjectId;
  modelClient: ModelClient;
  onEvent(event: WorkerEvent): void | Promise<void>;
}

interface RunAgentGenerationResult {
  files: ProjectFile[];
  packageJson: ProjectSnapshotPackageJson;
  summary: string;
  usage?: ModelUsage;
}

export const buildPhaseOneWorkerEvents = (): WorkerEvent[] => [
  { type: 'run.started', message: 'Agent run started' },
  { type: 'agent.step', message: 'Phase 1 worker received the run' },
  { type: 'run.completed', message: 'Phase 1 fake worker completed the run' }
];

const combineUsage = (
  first: ModelUsage | undefined,
  second: ModelUsage | undefined
): ModelUsage | undefined => {
  if (!first && !second) {
    return undefined;
  }

  const sum = (
    left: number | undefined,
    right: number | undefined
  ): number | undefined => left === undefined && right === undefined
    ? undefined
    : (left ?? 0) + (right ?? 0);

  return {
    inputTokens: sum(first?.inputTokens, second?.inputTokens),
    outputTokens: sum(first?.outputTokens, second?.outputTokens),
    totalTokens: sum(first?.totalTokens, second?.totalTokens)
  };
};

export const runAgentGeneration = async (
  input: RunAgentGenerationInput
): Promise<RunAgentGenerationResult> => {
  await input.onEvent({
    type: 'agent.step',
    message: 'Planning project changes',
    payload: { phase: 'planning' }
  });
  const planned = await input.modelClient.generatePlan({
    context: input.context
  });
  await input.onEvent({
    type: 'agent.plan',
    message: planned.value.summary,
    payload: planned.value
  });

  await input.onEvent({
    type: 'agent.step',
    message: 'Generating React TypeScript files',
    payload: { phase: 'generating' }
  });
  const generated = await input.modelClient.generateFiles({
    context: input.context,
    plan: planned.value
  });
  const packageJson = mergeProjectPackageJson(
    input.basePackageJson,
    generated.value
  );
  let files = applyFileOperations(
    input.baseFiles,
    generated.value.operations,
    input.generatedByRunId
  );
  files = applyFileOperations(files, [{
    type: files.some(file => file.path === 'package.json') ? 'update' : 'create',
    path: 'package.json',
    content: `${JSON.stringify(packageJson, null, 2)}\n`
  }], input.generatedByRunId);

  for (const operation of generated.value.operations) {
    await input.onEvent({
      type: 'file.changed',
      message: `${operation.type} ${operation.path}`,
      payload: {
        operation: operation.type,
        path: operation.path
      }
    });
  }

  return {
    files,
    packageJson,
    summary: generated.value.message,
    usage: combineUsage(planned.usage, generated.usage)
  };
};

const publicAgentError = (
  error: unknown
): { code: string; message: string } => {
  const candidate = error as { code?: unknown; message?: unknown };
  const knownCodes = new Set([
    'PROJECT_NOT_FOUND',
    'INVALID_BASE_SNAPSHOT',
    'INVALID_MODEL_OUTPUT',
    'MODEL_REQUEST_FAILED',
    'MODEL_CONFIGURATION_ERROR'
  ]);
  const code = typeof candidate.code === 'string' && knownCodes.has(candidate.code)
    ? candidate.code
    : 'AGENT_RUN_FAILED';

  return {
    code,
    message: code === 'AGENT_RUN_FAILED'
      ? 'Agent run failed'
      : typeof candidate.message === 'string'
        ? candidate.message
        : 'Agent run failed'
  };
};

const transitionRun = async (
  run: InstanceType<typeof AgentRun>,
  expectedStatus: typeof run.status,
  nextStatus: typeof run.status,
  fields: Record<string, unknown> = {}
): Promise<void> => {
  assertAgentRunTransition(expectedStatus, nextStatus);
  const result = await AgentRun.updateOne(
    { _id: run._id, status: expectedStatus },
    { $set: { status: nextStatus, ...fields } }
  );

  if (result.modifiedCount !== 1) {
    const current = await AgentRun.findById(run._id).select('status');

    if (current?.status === 'cancelled') {
      throw Object.assign(new Error('Agent run cancelled'), {
        code: 'RUN_CANCELLED'
      });
    }

    throw new Error(
      `AgentRun status changed before transition: ${expectedStatus} -> ${nextStatus}`
    );
  }

  run.status = nextStatus;
  Object.assign(run, fields);
};

export const processAgentRun = async (
  job: AgentRunJobData,
  modelClient: ModelClient
): Promise<void> => {
  const run = await AgentRun.findById(job.runId);

  if (!run) {
    throw new Error(`AgentRun not found: ${job.runId}`);
  }

  try {
    await transitionRun(run, 'queued', 'running', {
      startedAt: new Date()
    });

    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'run.started',
      message: 'Agent run started'
    });

    const config = getAgentConfig();
    const context = await loadAgentContext(run, config.contextCharLimit);
    const baseSnapshot = run.baseSnapshotId
      ? await ProjectSnapshot.findOne({
          _id: run.baseSnapshotId,
          projectId: run.projectId,
          userId: run.userId
        })
      : null;
    const basePackageJson = baseSnapshot
      ? baseSnapshot.toObject().packageJson
      : undefined;

    const generation = await runAgentGeneration({
      context,
      baseFiles: baseSnapshot?.files ?? [],
      basePackageJson,
      generatedByRunId: run._id,
      modelClient,
      onEvent: async event => {
        const phase = (event.payload as { phase?: string } | undefined)?.phase;

        if (phase === 'planning') {
          await transitionRun(run, 'running', 'planning');
        } else if (phase === 'generating') {
          await transitionRun(run, 'planning', 'generating');
        }

        await emitAgentEvent({
          runId: run._id,
          userId: run.userId,
          projectId: run.projectId,
          type: event.type,
          message: event.message,
          payload: event.payload
        });
      }
    });

    await transitionRun(run, 'generating', 'validating');

    const snapshot = await ProjectSnapshot.create({
      userId: run.userId,
      projectId: run.projectId,
      sourceRunId: run._id,
      parentSnapshotId: baseSnapshot?._id,
      files: generation.files,
      packageJson: generation.packageJson,
      validation: {
        status: 'skipped',
        checks: []
      },
      summary: generation.summary
    });

    if (run.chatId) {
      await Chat.updateOne(
        { _id: run.chatId, userId: run.userId, projectId: run.projectId },
        {
          $push: {
            messages: {
              id: randomUUID(),
              role: 'assistant',
              content: `${generation.summary}\n\nSnapshot: ${snapshot._id.toString()}`,
              createdAt: new Date()
            }
          }
        }
      );
    }

    try {
      await transitionRun(run, 'validating', 'completed', {
        resultSnapshotId: snapshot._id,
        usage: generation.usage,
        completedAt: new Date()
      });
    } catch (error) {
      await ProjectSnapshot.deleteOne({ _id: snapshot._id });
      throw error;
    }

    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'run.completed',
      message: 'Agent run completed with a project snapshot',
      payload: {
        snapshotId: snapshot._id.toString(),
        fileCount: generation.files.length
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'RUN_CANCELLED') {
      return;
    }

    const publicError = publicAgentError(error);
    const result = await AgentRun.updateOne(
      {
        _id: run._id,
        status: { $nin: ['completed', 'failed', 'cancelled'] }
      },
      {
        $set: {
          status: 'failed',
          error: publicError,
          completedAt: new Date()
        }
      }
    );

    if (result.modifiedCount !== 1) {
      return;
    }

    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'run.failed',
      message: publicError.message,
      payload: { code: publicError.code }
    });
  }
};
