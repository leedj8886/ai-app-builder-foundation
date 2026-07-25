import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { getAgentConfig } from './config';
import { loadAgentContext } from './contextBuilder';
import { mergeProjectPackageJson } from './dependencies';
import { emitAgentEvent } from './eventBus';
import { applyFileOperations } from './fileOperations';
import { resolveProjectBaseFiles } from './projectTemplate';
import { assertAgentRunTransition } from './stateMachine';
import {
  AgentContext,
  AgentPlan,
  AgentEventType,
  AgentRunJobData,
  ModelClient,
  ModelUsage,
  ProjectFile,
  ProjectSnapshotPackageJson
} from './types';
import { ProjectValidator } from './validator';

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
  plan: AgentPlan;
}

interface RunAgentGenerationWithValidationInput extends RunAgentGenerationInput {
  validator: ProjectValidator;
  runId: string;
  maxRepairAttempts: number;
}

interface ValidatedAgentGenerationResult extends RunAgentGenerationResult {
  validation: import('./types').ValidationResult;
  repairAttempts: number;
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
    usage: combineUsage(planned.usage, generated.usage),
    plan: planned.value
  };
};

const writeServerPackageJson = (
  files: ProjectFile[],
  packageJson: ProjectSnapshotPackageJson,
  generatedByRunId?: Types.ObjectId
): ProjectFile[] => applyFileOperations(files, [{
  type: files.some(file => file.path === 'package.json') ? 'update' : 'create',
  path: 'package.json',
  content: `${JSON.stringify(packageJson, null, 2)}\n`
}], generatedByRunId);

export const runAgentGenerationWithValidation = async (
  input: RunAgentGenerationWithValidationInput
): Promise<ValidatedAgentGenerationResult> => {
  const generated = await runAgentGeneration(input);
  let files = generated.files;
  let packageJson = generated.packageJson;
  let summary = generated.summary;
  let usage = generated.usage;
  let repairAttempts = 0;

  while (true) {
    await input.onEvent({
      type: 'validation.started',
      message: 'Validating generated project',
      payload: { phase: 'validating', attempt: repairAttempts }
    });
    const validation = await input.validator.validate({
      runId: `${input.runId}-${repairAttempts}`,
      files
    });

    if (validation.status === 'passed') {
      await input.onEvent({
        type: 'validation.passed',
        message: 'Project validation passed',
        payload: validation
      });
      return {
        files,
        packageJson,
        summary,
        usage,
        plan: generated.plan,
        validation,
        repairAttempts
      };
    }

    await input.onEvent({
      type: 'validation.failed',
      message: 'Project validation failed',
      payload: validation
    });

    if (repairAttempts >= input.maxRepairAttempts) {
      throw Object.assign(new Error('Generated project failed validation'), {
        code: 'VALIDATION_FAILED',
        details: validation
      });
    }

    repairAttempts += 1;
    await input.onEvent({
      type: 'repair.started',
      message: `Repair attempt ${repairAttempts} started`,
      payload: { phase: 'repairing', attempt: repairAttempts }
    });
    const repaired = await input.modelClient.repairFiles({
      context: input.context,
      plan: generated.plan,
      attempt: repairAttempts,
      files,
      validation
    });
    packageJson = mergeProjectPackageJson(packageJson, repaired.value);
    files = applyFileOperations(
      files,
      repaired.value.operations,
      input.generatedByRunId
    );
    files = writeServerPackageJson(
      files,
      packageJson,
      input.generatedByRunId
    );
    summary = repaired.value.message;
    usage = combineUsage(usage, repaired.usage);

    await input.onEvent({
      type: 'agent.step',
      message: `Applied repair attempt ${repairAttempts}`,
      payload: { phase: 'generating', attempt: repairAttempts }
    });
    for (const operation of repaired.value.operations) {
      await input.onEvent({
        type: 'file.changed',
        message: `${operation.type} ${operation.path}`,
        payload: {
          operation: operation.type,
          path: operation.path,
          repairAttempt: repairAttempts
        }
      });
    }
  }
};

const publicAgentError = (
  error: unknown
): { code: string; message: string; details?: unknown } => {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  const knownCodes = new Set([
    'PROJECT_NOT_FOUND',
    'INVALID_BASE_SNAPSHOT',
    'INVALID_MODEL_OUTPUT',
    'MODEL_REQUEST_FAILED',
    'MODEL_CONFIGURATION_ERROR',
    'VALIDATION_FAILED'
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
        : 'Agent run failed',
    ...(candidate.details !== undefined && { details: candidate.details })
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

const activateSnapshotIfBaseIsCurrent = async (
  run: InstanceType<typeof AgentRun>,
  snapshotId: Types.ObjectId
): Promise<void> => {
  await Project.updateOne(
    {
      _id: run.projectId,
      userId: run.userId,
      $or: [
        { activeSnapshotRevision: run.baseSnapshotRevision },
        ...(run.baseSnapshotRevision === 0
          ? [{ activeSnapshotRevision: { $exists: false } }]
          : [])
      ]
    },
    {
      $set: { activeSnapshotId: snapshotId },
      $inc: { activeSnapshotRevision: 1 }
    }
  );
};

export const processAgentRun = async (
  job: AgentRunJobData,
  modelClient: ModelClient,
  validator: ProjectValidator
): Promise<void> => {
  const run = await AgentRun.findById(job.runId);

  if (!run) {
    throw new Error(`AgentRun not found: ${job.runId}`);
  }

  if (run.status === 'persisting') {
    const pendingSnapshot = await ProjectSnapshot.findOne({
      sourceRunId: run._id,
      userId: run.userId,
      projectId: run.projectId
    });

    if (!pendingSnapshot) {
      await AgentRun.updateOne(
        { _id: run._id, status: 'persisting' },
        {
          $set: {
            status: 'failed',
            error: {
              code: 'WORKSPACE_ERROR',
              message: 'Agent worker stopped before snapshot persistence completed'
            },
            completedAt: new Date()
          }
        }
      );
      return;
    }

    await transitionRun(run, 'persisting', 'completed', {
      resultSnapshotId: pendingSnapshot._id,
      completedAt: new Date()
    });
    await activateSnapshotIfBaseIsCurrent(run, pendingSnapshot._id);
    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'run.completed',
      message: 'Agent run completed with a project snapshot',
      payload: {
        snapshotId: pendingSnapshot._id.toString(),
        fileCount: pendingSnapshot.files.length
      }
    });
    return;
  }

  if (run.status === 'completed') {
    if (run.resultSnapshotId) {
      await activateSnapshotIfBaseIsCurrent(run, run.resultSnapshotId);
    }
    const completedEvent = await AgentEvent.exists({
      runId: run._id,
      type: 'run.completed'
    });

    if (!completedEvent && run.resultSnapshotId) {
      const snapshot = await ProjectSnapshot.findById(run.resultSnapshotId)
        .select('files');
      await emitAgentEvent({
        runId: run._id,
        userId: run.userId,
        projectId: run.projectId,
        type: 'run.completed',
        message: 'Agent run completed with a project snapshot',
        payload: {
          snapshotId: run.resultSnapshotId.toString(),
          fileCount: snapshot?.files.length ?? 0
        }
      });
    }
    return;
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
    const baseFiles = resolveProjectBaseFiles(
      baseSnapshot
        ? baseSnapshot.files.map(file => ({
            path: file.path,
            content: file.content,
            language: file.language,
            generatedByRunId: file.generatedByRunId
          }))
        : undefined
    );

    const generation = await runAgentGenerationWithValidation({
      context,
      baseFiles,
      basePackageJson,
      generatedByRunId: run._id,
      modelClient,
      validator,
      runId: run._id.toString(),
      maxRepairAttempts: run.maxRepairAttempts,
      onEvent: async event => {
        const phase = (event.payload as { phase?: string } | undefined)?.phase;

        if (phase === 'planning') {
          await transitionRun(run, 'running', 'planning');
        } else if (phase === 'generating') {
          await transitionRun(
            run,
            run.status === 'planning' ? 'planning' : 'repairing',
            'generating'
          );
        } else if (phase === 'validating') {
          await transitionRun(run, 'generating', 'validating');
        } else if (phase === 'repairing') {
          const attempt = (event.payload as { attempt?: number }).attempt ?? 0;
          await transitionRun(run, 'validating', 'repairing', { attempt });
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

    await transitionRun(run, 'validating', 'persisting');
    const snapshot = await ProjectSnapshot.create({
        userId: run.userId,
        projectId: run.projectId,
        sourceRunId: run._id,
        parentSnapshotId: baseSnapshot?._id,
        files: generation.files,
        packageJson: generation.packageJson,
        validation: generation.validation,
        summary: generation.summary
      });

    try {
      await transitionRun(run, 'persisting', 'completed', {
        resultSnapshotId: snapshot._id,
        usage: generation.usage,
        completedAt: new Date()
      });
    } catch (error) {
      await ProjectSnapshot.deleteOne({ _id: snapshot._id });
      throw error;
    }
    try {
      await activateSnapshotIfBaseIsCurrent(run, snapshot._id);
    } catch (error) {
      throw Object.assign(new Error('Failed to activate completed project snapshot'), {
        code: 'SNAPSHOT_ACTIVATION_FAILED',
        cause: error
      });
    }

    if (run.chatId) {
      try {
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
      } catch (error) {
        console.error(`Failed to append AgentRun ${run._id.toString()} to chat`, error);
      }
    }

    try {
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
      throw Object.assign(new Error('Failed to persist run completion event'), {
        code: 'COMPLETION_EVENT_FAILED',
        cause: error
      });
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'RUN_CANCELLED') {
      return;
    }

    console.error(`AgentRun ${run._id.toString()} failed`, error);

    if (['COMPLETION_EVENT_FAILED', 'SNAPSHOT_ACTIVATION_FAILED'].includes(
      (error as { code?: string }).code ?? ''
    )) {
      throw error;
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
