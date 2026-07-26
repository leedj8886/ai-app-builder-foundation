import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { ValidationCandidate } from '../models/ValidationCandidate';
import { getAgentConfig } from './config';
import { loadAgentContext } from './contextBuilder';
import { mergeProjectPackageJson } from './dependencies';
import { emitAgentEvent } from './eventBus';
import { applyFileOperations } from './fileOperations';
import { diagnosticFingerprint } from './validation/classify';
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
import { commitBranchHead } from '../branches/branchService';
import { ProjectBranch } from '../models/ProjectBranch';
import { getArtifactService } from '../artifacts/runtime';
import { ArtifactError, type ArtifactProjectFile } from '../artifacts/types';
import { ArtifactManifest } from '../models/ArtifactManifest';

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

const artifactFiles = (files: ProjectFile[]) => files.map(file => ({
  path: file.path,
  content: file.content,
  language: file.language,
  ...(file.generatedByRunId && {
    generatedByRunId: file.generatedByRunId.toString()
  })
}));

const domainFiles = (files: ArtifactProjectFile[]): ProjectFile[] => files.map(file => ({
  path: file.path,
  content: file.content,
  language: file.language,
  ...(file.generatedByRunId && Types.ObjectId.isValid(file.generatedByRunId) && {
    generatedByRunId: new Types.ObjectId(file.generatedByRunId)
  })
}));

const assertArtifactMatch = async <T extends { artifactId: string }>(
  record: T | null,
  artifactId: string,
  scope: {
    workspaceId: Types.ObjectId;
    projectId: Types.ObjectId;
    branchId: Types.ObjectId;
    userId: Types.ObjectId;
  },
  kind: 'project_snapshot' | 'validation_candidate'
): Promise<T> => {
  const owned = record as T & {
    workspaceId?: Types.ObjectId;
    projectId?: Types.ObjectId;
    branchId?: Types.ObjectId;
    userId?: Types.ObjectId;
  } | null;
  if (
    !owned ||
    owned.artifactId !== artifactId ||
    !owned.workspaceId?.equals(scope.workspaceId) ||
    !owned.projectId?.equals(scope.projectId) ||
    !owned.branchId?.equals(scope.branchId) ||
    !owned.userId?.equals(scope.userId)
  ) {
    throw new ArtifactError(
      'ARTIFACT_IDEMPOTENCY_CONFLICT',
      'Domain record does not reference its idempotent artifact'
    );
  }
  const manifest = await ArtifactManifest.exists({
    artifactId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind
  });
  if (!manifest) {
    throw new ArtifactError(
      'ARTIFACT_IDEMPOTENCY_CONFLICT',
      'Domain record does not reference an owned artifact manifest'
    );
  }
  return owned;
};

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error as Error & { code?: number }).code === 11000;

export const createRunSnapshot = async (
  run: InstanceType<typeof AgentRun>,
  input: {
    parentSnapshotId?: Types.ObjectId;
    files: ProjectFile[];
    packageJson: ProjectSnapshotPackageJson;
    validation: import('./types').ValidationResult;
    summary: string;
  }
) => {
  if (!run.workspaceId || !run.branchId) {
    throw new Error('AgentRun is missing artifact ownership');
  }
  const artifact = await getArtifactService().writeBundle({
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    createdByRunId: run._id,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${run._id.toString()}`,
    bundle: {
      version: 1,
      files: artifactFiles(input.files),
      packageJson: input.packageJson
    }
  });
  let snapshot;
  try {
    snapshot = await ProjectSnapshot.findOneAndUpdate(
      { sourceRunId: run._id },
      {
        $setOnInsert: {
          workspaceId: run.workspaceId,
          branchId: run.branchId,
          userId: run.userId,
          projectId: run.projectId,
          sourceRunId: run._id,
          parentSnapshotId: input.parentSnapshotId,
          artifactId: artifact.artifactId,
          validation: input.validation,
          summary: input.summary
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    snapshot = await ProjectSnapshot.findOne({ sourceRunId: run._id });
  }
  return assertArtifactMatch(snapshot, artifact.artifactId, {
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    branchId: run.branchId,
    userId: run.userId
  }, 'project_snapshot');
};

export const createRunCandidate = async (
  run: InstanceType<typeof AgentRun>,
  input: {
    files: ProjectFile[];
    packageJson: ProjectSnapshotPackageJson;
    summary: string;
  }
) => {
  if (!run.workspaceId || !run.branchId) {
    throw new Error('AgentRun is missing artifact ownership');
  }
  const artifact = await getArtifactService().writeBundle({
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    createdByRunId: run._id,
    kind: 'validation_candidate',
    idempotencyKey: `candidate:${run._id.toString()}`,
    bundle: {
      version: 1,
      files: artifactFiles(input.files),
      packageJson: input.packageJson
    }
  });
  let candidate;
  try {
    candidate = await ValidationCandidate.findOneAndUpdate(
      { sourceRunId: run._id },
      {
        $setOnInsert: {
          workspaceId: run.workspaceId,
          branchId: run.branchId,
          userId: run.userId,
          projectId: run.projectId,
          sourceRunId: run._id,
          artifactId: artifact.artifactId,
          summary: input.summary,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000)
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    candidate = await ValidationCandidate.findOne({ sourceRunId: run._id });
  }
  return assertArtifactMatch(candidate, artifact.artifactId, {
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    branchId: run.branchId,
    userId: run.userId
  }, 'validation_candidate');
};

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

const hasEffectiveFileChanges = (
  baseFiles: ProjectFile[],
  operations: Parameters<typeof applyFileOperations>[1]
): boolean => {
  const baseFilesByPath = new Map(
    baseFiles.map(file => [file.path.replace(/\\/g, '/'), file.content])
  );

  return operations.some(operation => {
    const operationPath = operation.path.replace(/\\/g, '/');
    const existingContent = baseFilesByPath.get(operationPath);

    if (operation.type === 'delete') {
      return existingContent !== undefined;
    }

    return existingContent !== operation.content;
  });
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
  if (
    input.context.mode === 'edit' &&
    !hasEffectiveFileChanges(input.baseFiles, generated.value.operations)
  ) {
    throw Object.assign(
      new Error('The model did not produce any effective file changes'),
      { code: 'NO_EFFECTIVE_CHANGES' }
    );
  }
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
  const seenDiagnostics = new Set<string>();

  while (true) {
    await input.onEvent({
      type: 'validation.started',
      message: 'Validating generated project',
      payload: { phase: 'validating', attempt: repairAttempts }
    });
    const validation = await input.validator.validate({
      runId: `${input.runId}-${repairAttempts}`,
      files,
      onProgress: async progress => {
        await input.onEvent({
          type: 'validation.step',
          message: progress.message,
          payload: progress
        });
      }
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

    if (validation.category === 'INFRA_ERROR') {
      throw Object.assign(
        new Error('Validation environment is temporarily unavailable'),
        {
          code: 'VALIDATION_INFRA_ERROR',
          details: validation,
          candidate: { files, packageJson, summary }
        }
      );
    }

    const failureFingerprint = diagnosticFingerprint(validation);
    if (seenDiagnostics.has(failureFingerprint)) {
      throw Object.assign(
        new Error('Validation repair repeated the same failure'),
        {
          code: 'REPEATED_VALIDATION_FAILURE',
          details: validation
        }
      );
    }
    seenDiagnostics.add(failureFingerprint);

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
    const repairInput = {
      context: input.context,
      plan: generated.plan,
      attempt: repairAttempts,
      files,
      validation
    };
    const repaired = validation.category === 'DEPENDENCY_ERROR'
      ? await (
        input.modelClient.repairDependencies ??
        input.modelClient.repairFiles
      )(repairInput)
      : await input.modelClient.repairFiles(repairInput);
    const currentPackageJson = packageJson;
    packageJson = mergeProjectPackageJson(packageJson, repaired.value);
    const dependencyChanged =
      JSON.stringify(packageJson) !== JSON.stringify(currentPackageJson);
    const filesBeforeRepair = new Map(
      files.map(file => [file.path, file.content])
    );
    files = applyFileOperations(
      files,
      repaired.value.operations,
      input.generatedByRunId
    );
    const fileChanged = files.some(
      file => filesBeforeRepair.get(file.path) !== file.content
    ) || [...filesBeforeRepair].some(
      ([filePath]) => !files.some(file => file.path === filePath)
    );
    if (!dependencyChanged && !fileChanged) {
      throw Object.assign(
        new Error('The model did not produce any effective repair changes'),
        { code: 'NO_EFFECTIVE_CHANGES' }
      );
    }
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
    'INVALID_CHAT_BRANCH',
    'BRANCH_EXECUTION_LOST',
    'INVALID_BASE_SNAPSHOT',
    'INVALID_MODEL_OUTPUT',
    'MODEL_REQUEST_FAILED',
    'MODEL_CONFIGURATION_ERROR',
    'NO_EFFECTIVE_CHANGES',
    'REPEATED_VALIDATION_FAILURE',
    'VALIDATION_INFRA_ERROR',
    'VALIDATION_FAILED',
    'VALIDATION_CANDIDATE_NOT_FOUND',
    'VALIDATION_CANDIDATE_EXPIRED',
    'ARTIFACT_STORE_UNAVAILABLE',
    'ARTIFACT_WRITE_FAILED',
    'ARTIFACT_NOT_FOUND',
    'ARTIFACT_CORRUPT',
    'ARTIFACT_FORMAT_UNSUPPORTED',
    'ARTIFACT_LIMIT_EXCEEDED',
    'ARTIFACT_INVALID_PATH',
    'ARTIFACT_INVALID_BUNDLE',
    'ARTIFACT_IDEMPOTENCY_CONFLICT'
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

const completeRunWithSnapshot = async (
  run: InstanceType<typeof AgentRun>,
  snapshot: InstanceType<typeof ProjectSnapshot>,
  fields: Record<string, unknown> = {}
): Promise<'completed' | 'completed_with_conflict'> => {
  if (!run.branchId || run.baseHeadVersion === undefined) {
    throw Object.assign(new Error('AgentRun is missing Branch baseline'), {
      code: 'INVALID_BRANCH_BASELINE'
    });
  }
  const committed = await commitBranchHead({
    branchId: run.branchId,
    expectedHeadVersion: run.baseHeadVersion,
    snapshotId: snapshot._id
  });
  const status = committed.outcome === 'conflict'
    ? 'completed_with_conflict'
    : 'completed';
  await transitionRun(run, 'persisting', status, {
    resultSnapshotId: snapshot._id,
    completedAt: new Date(),
    ...fields
  });

  if (committed.outcome === 'advanced') {
    const branch = await ProjectBranch.findById(run.branchId).select('name');
    if (branch?.name === 'main') {
      await Project.updateOne(
        { _id: run.projectId, userId: run.userId },
        {
          $set: {
            activeSnapshotId: snapshot._id,
            activeSnapshotRevision: committed.headVersion
          }
        }
      );
    }
  }

  return status;
};

interface BranchExecutionContext {
  assertHeld(): Promise<void>;
}

export const processAgentRun = async (
  job: AgentRunJobData,
  modelClient: ModelClient,
  validator: ProjectValidator,
  execution?: BranchExecutionContext
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

    const status = await completeRunWithSnapshot(run, pendingSnapshot);
    const manifest = await ArtifactManifest.findOne({
      artifactId: pendingSnapshot.artifactId,
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      kind: 'project_snapshot'
    }).select('fileCount').lean();
    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'run.completed',
      message: 'Agent run completed with a project snapshot',
      payload: {
        snapshotId: pendingSnapshot._id.toString(),
        fileCount: manifest?.fileCount ?? 0,
        branchId: run.branchId?.toString(),
        branchAdvanced: status === 'completed',
        conflict: status === 'completed_with_conflict'
      }
    });
    return;
  }

  if (
    run.status === 'completed' ||
    run.status === 'completed_with_conflict'
  ) {
    const completedEvent = await AgentEvent.exists({
      runId: run._id,
      type: 'run.completed'
    });

    if (!completedEvent && run.resultSnapshotId) {
      const snapshot = await ProjectSnapshot.findById(run.resultSnapshotId)
        .select('artifactId');
      const manifest = snapshot
        ? await ArtifactManifest.findOne({
            artifactId: snapshot.artifactId,
            workspaceId: run.workspaceId,
            projectId: run.projectId,
            kind: 'project_snapshot'
          })
          .select('fileCount').lean()
        : null;
      await emitAgentEvent({
        runId: run._id,
        userId: run.userId,
        projectId: run.projectId,
        type: 'run.completed',
        message: 'Agent run completed with a project snapshot',
        payload: {
          snapshotId: run.resultSnapshotId.toString(),
          fileCount: manifest?.fileCount ?? 0,
          branchId: run.branchId?.toString(),
          branchAdvanced: run.status === 'completed',
          conflict: run.status === 'completed_with_conflict'
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
    const baseBundle = baseSnapshot
      ? await getArtifactService().readOwnedBundle({
          artifactId: baseSnapshot.artifactId,
          workspaceId: run.workspaceId!,
          projectId: run.projectId,
          kind: 'project_snapshot'
        })
      : null;
    const basePackageJson = baseBundle?.packageJson;
    const baseFiles = resolveProjectBaseFiles(
      baseBundle
        ? domainFiles(baseBundle.files)
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

    await execution?.assertHeld();
    await transitionRun(run, 'validating', 'persisting');
    const snapshot = await createRunSnapshot(run, {
      parentSnapshotId: baseSnapshot?._id,
      files: generation.files,
      packageJson: generation.packageJson,
      validation: generation.validation,
      summary: generation.summary
    });

    const status = await completeRunWithSnapshot(run, snapshot, {
      usage: generation.usage
    });

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
          fileCount: generation.files.length,
          branchId: run.branchId?.toString(),
          branchAdvanced: status === 'completed',
          conflict: status === 'completed_with_conflict'
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

    if (['COMPLETION_EVENT_FAILED'].includes(
      (error as { code?: string }).code ?? ''
    )) {
      throw error;
    }

    let effectiveError = error;
    let publicError = publicAgentError(effectiveError);
    const failedCandidate = (
      error as {
        code?: string;
        candidate?: {
          files: ProjectFile[];
          packageJson: ProjectSnapshotPackageJson;
          summary: string;
        };
      }
    ).candidate;
    let candidate: InstanceType<typeof ValidationCandidate> | null = null;
    if (
      publicError.code === 'VALIDATION_INFRA_ERROR' &&
      failedCandidate
    ) {
      try {
        candidate = await createRunCandidate(run, failedCandidate);
      } catch (candidateError) {
        effectiveError = candidateError;
        publicError = publicAgentError(candidateError);
      }
    }
    const result = await AgentRun.updateOne(
      {
        _id: run._id,
        status: { $nin: ['completed', 'failed', 'cancelled'] }
      },
      {
        $set: {
          status: 'failed',
          error: publicError,
          ...(candidate && {
            validationCandidateId: candidate._id,
            retryable: true
          }),
          ...(!candidate && { retryable: false }),
          completedAt: new Date()
        }
      }
    );

    if (result.modifiedCount !== 1) {
      if (candidate) {
        await ValidationCandidate.deleteOne({ _id: candidate._id });
      }
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

export const processValidationCandidate = async (
  jobData: AgentRunJobData,
  validator: ProjectValidator,
  execution?: BranchExecutionContext
): Promise<void> => {
  if (!jobData.candidateId) {
    throw new Error('Retry-validation job requires a candidate id');
  }
  const run = await AgentRun.findById(jobData.runId);
  if (!run || run.status !== 'queued') return;
  if (
    !run.validationCandidateId?.equals(jobData.candidateId) ||
    !run.retryOfRunId
  ) {
    throw new Error('Validation candidate not found');
  }
  try {
    const candidate = await ValidationCandidate.findOne({
      _id: run.validationCandidateId,
      userId: run.userId,
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      branchId: run.branchId,
      sourceRunId: run.retryOfRunId
    });
    if (!candidate) {
      throw Object.assign(new Error('Validation candidate is unavailable'), {
        code: 'VALIDATION_CANDIDATE_NOT_FOUND'
      });
    }
    if (candidate.expiresAt <= new Date()) {
      throw Object.assign(new Error('Validation candidate has expired'), {
        code: 'VALIDATION_CANDIDATE_EXPIRED'
      });
    }
    const candidateBundle = await getArtifactService().readOwnedBundle({
      artifactId: candidate.artifactId,
      workspaceId: run.workspaceId!,
      projectId: run.projectId,
      kind: 'validation_candidate'
    });
    const candidateFiles = domainFiles(candidateBundle.files);
    await transitionRun(run, 'queued', 'running', { startedAt: new Date() });
    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'run.started',
      message: 'Validation retry started'
    });
    await transitionRun(run, 'running', 'validating');
    const validation = await validator.validate({
      runId: `${run._id.toString()}-retry`,
      files: candidateFiles,
      onProgress: async progress => {
        await emitAgentEvent({
          runId: run._id,
          userId: run.userId,
          projectId: run.projectId,
          type: 'validation.step',
          message: progress.message,
          payload: progress
        });
      }
    });

    if (validation.status !== 'passed') {
      const code = validation.category === 'INFRA_ERROR'
        ? 'VALIDATION_INFRA_ERROR'
        : 'VALIDATION_FAILED';
      throw Object.assign(new Error(
        validation.category === 'INFRA_ERROR'
          ? 'Validation environment is temporarily unavailable'
          : 'Stored candidate failed validation'
      ), { code, details: validation });
    }

    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'validation.passed',
      message: 'Project validation passed',
      payload: validation
    });
    await execution?.assertHeld();
    await transitionRun(run, 'validating', 'persisting');
    const snapshot = await createRunSnapshot(run, {
      parentSnapshotId: run.baseSnapshotId,
      files: candidateFiles,
      packageJson: candidateBundle.packageJson,
      validation,
      summary: candidate.summary
    });
    const status = await completeRunWithSnapshot(run, snapshot, {
      retryable: false
    });
    await ValidationCandidate.deleteOne({ _id: candidate._id });
    await emitAgentEvent({
      runId: run._id,
      userId: run.userId,
      projectId: run.projectId,
      type: 'run.completed',
      message: 'Agent run completed with a project snapshot',
      payload: {
        snapshotId: snapshot._id.toString(),
        fileCount: candidateBundle.files.length,
        branchId: run.branchId?.toString(),
        branchAdvanced: status === 'completed',
        conflict: status === 'completed_with_conflict'
      }
    });
  } catch (error) {
    const publicError = publicAgentError(error);
    const retryable =
      publicError.code === 'VALIDATION_INFRA_ERROR' ||
      publicError.code === 'ARTIFACT_STORE_UNAVAILABLE' ||
      (
        publicError.code === 'ARTIFACT_WRITE_FAILED' &&
        error instanceof ArtifactError &&
        error.retryable
      );
    await AgentRun.updateOne(
      {
        _id: run._id,
        status: {
          $nin: [
            'completed',
            'completed_with_conflict',
            'failed',
            'cancelled'
          ]
        }
      },
      {
        $set: {
          status: 'failed',
          error: publicError,
          retryable,
          completedAt: new Date()
        }
      }
    );
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
