import type { ArtifactService } from '../artifacts/artifactService';
import type { SandboxLeaseDocument } from '../models/SandboxLease';
import { SandboxError } from '../sandbox/errors';
import type { SandboxService } from '../sandbox/SandboxService';
import type {
  ResourceProfile,
  SandboxOwnership
} from '../sandbox/types';
import { classifyValidationFailure } from './validation/classify';
import {
  resolveValidationStages,
  type ValidationStageDefinition
} from './validation/stages';
import { adaptersFor } from './styling/registry';
import {
  abortReason,
  throwIfAborted
} from './runCancellation';
import { resolveStylingCapabilities } from './styling/resolveCapabilities';
import type {
  ProjectFile,
  ProjectSnapshotPackageJson,
  ValidationCheckResult,
  ValidationErrorCategory,
  ValidationResult
} from './types';
import type {
  ProjectValidator,
  ValidateProjectInput
} from './validator';
import {
  normalizeProjectProfileRef,
  resolveProjectProfile
} from './profiles/registry';
import type {
  ValidationDatabase,
  ValidationDatabaseLease
} from './validation/database';
import {
  redactValidationSecrets,
  validationDatabaseEnvironment
} from './validation/database';

interface CreateSandboxProjectValidatorOptions {
  service: SandboxService;
  artifactService: ArtifactService;
  provider: string;
  image: string;
  resources: ResourceProfile;
  verification: 'verified' | 'simulated';
  validationDatabase?: ValidationDatabase;
}

const packageJsonFrom = (
  files: ProjectFile[]
): ProjectSnapshotPackageJson => {
  const file = files.find((candidate) => candidate.path === 'package.json');
  if (!file) throw new Error('package.json is required for Sandbox validation');
  const parsed = JSON.parse(file.content) as Partial<ProjectSnapshotPackageJson>;
  if (
    !parsed.dependencies ||
    !parsed.devDependencies ||
    !parsed.scripts
  ) {
    throw new Error('package.json is incomplete for Sandbox validation');
  }
  return {
    dependencies: parsed.dependencies,
    devDependencies: parsed.devDependencies,
    scripts: parsed.scripts
  };
};

const artifactFiles = (
  files: ProjectFile[]
) => files.map((file) => ({
  path: file.path,
  content: file.content,
  language: file.language,
  ...(file.generatedByRunId && {
    generatedByRunId: file.generatedByRunId.toString()
  })
}));

const ownershipFor = (
  scope: NonNullable<ValidateProjectInput['sandboxScope']>
): SandboxOwnership => ({
  workspaceId: scope.workspaceId.toString(),
  projectId: scope.projectId.toString(),
  branchId: scope.branchId.toString(),
  runId: scope.runId.toString(),
  purpose: 'build'
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const infrastructureResult = (
  checks: ValidationCheckResult[],
  verification: ValidationResult['verification'],
  stage: Pick<ValidationStageDefinition, 'id' | 'phase'>,
  error: unknown,
  databaseLease?: ValidationDatabaseLease
): ValidationResult => {
  checks.push({
    name: stage.id,
    phase: stage.phase,
    status: 'failed',
    category: 'INFRA_ERROR',
    stdout: '',
    stderr: redactValidationSecrets(errorMessage(error), databaseLease),
    durationMs: 0,
    cache: stage.id === 'install' ? 'miss' : 'not-applicable',
    attempt: 0
  });
  return {
    status: 'failed',
    verification,
    checks,
    category: 'INFRA_ERROR',
    retryable: error instanceof SandboxError ? error.retryable : true
  };
};

export const createSandboxProjectValidator = (
  options: CreateSandboxProjectValidatorOptions
): ProjectValidator => ({
  validate: async (input): Promise<ValidationResult> => {
    throwIfAborted(input.signal);
    const profile = resolveProjectProfile(normalizeProjectProfileRef(
      input.profile ?? input.sandboxScope?.profile
    ));
    const stages = resolveValidationStages(profile.validationPipeline());
    const structureStage = stages.find(stage => stage.kind === 'structure');
    if (!structureStage) {
      throw new Error('Project Profile validation pipeline requires a structure stage');
    }
    const checks: ValidationCheckResult[] = [];
    const structureStartedAt = Date.now();
    const structure = profile.validateStructure(input.files);
    checks.push({
      name: 'structure',
      phase: 'structure',
      status: structure.status,
      ...(structure.category && { category: structure.category }),
      stdout: structure.stdout,
      stderr: structure.stderr,
      durationMs: Date.now() - structureStartedAt,
      cache: 'not-applicable',
      attempt: 0
    });
    await input.onProgress?.({
      phase: 'structure',
      status: structure.status,
      category: structure.category,
      attempt: 0,
      cache: 'not-applicable',
      message: structure.status === 'passed'
        ? 'Project structure checked'
        : structure.stderr
    });
    if (structure.status === 'failed') {
      return {
        status: 'failed',
        verification: options.verification,
        checks,
        category: structure.category,
        retryable: false
      };
    }

    const stylingIssues = adaptersFor(
      resolveStylingCapabilities(input.files)
    ).flatMap((adapter) => adapter.validateSource(input.files));
    if (stylingIssues.length > 0) {
      const message = stylingIssues.map((issue) => issue.message).join('\n');
      checks.push({
        name: 'structure',
        phase: 'structure',
        status: 'failed',
        category: 'STYLING_CONFIGURATION_ERROR',
        stdout: '',
        stderr: message,
        durationMs: 0,
        cache: 'not-applicable',
        attempt: 0,
        stylingIssues
      });
      await input.onProgress?.({
        phase: 'structure',
        status: 'failed',
        category: 'STYLING_CONFIGURATION_ERROR',
        attempt: 0,
        cache: 'not-applicable',
        stylingIssues,
        message
      });
      return {
        status: 'failed',
        verification: options.verification,
        checks,
        category: 'STYLING_CONFIGURATION_ERROR',
        retryable: false
      };
    }

    const scope = input.sandboxScope;
    if (!scope) {
      return infrastructureResult(
        checks,
        options.verification,
        structureStage,
        new Error('Sandbox validation ownership scope is required')
      );
    }

    let lease: SandboxLeaseDocument | undefined;
    let databaseLease: ValidationDatabaseLease | undefined;
    let currentStage = stages.find(stage => stage.kind !== 'structure') ?? structureStage;
    let result: ValidationResult | undefined;
    let cancellationError: unknown;
    const ownership = ownershipFor(scope);

    try {
      throwIfAborted(input.signal);
      const artifact = await options.artifactService.writeBundle({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        createdByRunId: scope.runId,
        kind: 'validation_candidate',
        idempotencyKey:
          `sandbox-validation:${scope.runId.toString()}:${scope.attempt}`,
        bundle: scope.profile
          ? {
              version: 2,
              profile: normalizeProjectProfileRef(scope.profile),
              files: artifactFiles(input.files),
              packageJson: packageJsonFrom(input.files)
            }
          : {
              version: 1,
              files: artifactFiles(input.files),
              packageJson: packageJsonFrom(input.files)
            }
      });
      lease = await options.service.createBuildSandbox({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        branchId: scope.branchId,
        requestedByUserId: scope.requestedByUserId,
        runId: scope.runId,
        sourceArtifact: {
          artifactId: artifact.artifactId,
          kind: 'validation_candidate'
        },
        provider: options.provider,
        image: options.image,
        attempt: scope.attempt,
        resources: options.resources
      });

      for (const stage of stages.filter(candidate => candidate.kind !== 'structure')) {
        throwIfAborted(input.signal);
        if (!stage.sandboxCommand) {
          throw new Error(`Validation stage ${stage.id} has no Sandbox command`);
        }
        currentStage = stage;
        if (stage.database && !databaseLease) {
          if (!options.validationDatabase) {
            throw new Error('Server Profile validation database is unavailable');
          }
          databaseLease = await options.validationDatabase.create({
            runId: input.runId,
            signal: input.signal
          });
        }
        const databaseEnvironment = databaseLease && stage.database
          ? validationDatabaseEnvironment(databaseLease)
          : undefined;
        const commandResult = await options.service.runBuildCommand({
          leaseId: lease._id,
          expectedOwnership: ownership,
          command: stage.sandboxCommand,
          environment: databaseEnvironment && stage.database === 'primary'
            ? { DATABASE_URL: databaseEnvironment.DATABASE_URL }
            : databaseEnvironment,
          signal: input.signal
        });
        const stdout = redactValidationSecrets(
          commandResult.stdout,
          databaseLease
        );
        const stderr = redactValidationSecrets(
          commandResult.stderr,
          databaseLease
        );
        const category: ValidationErrorCategory | undefined =
          commandResult.exitCode === 0
            ? undefined
            : classifyValidationFailure({
              phase: stage.phase,
              exitCode: commandResult.exitCode ?? undefined,
              stdout,
              stderr
            });
        const check: ValidationCheckResult = {
          name: stage.id,
          phase: stage.phase,
          status: commandResult.exitCode === 0 ? 'passed' : 'failed',
          ...(category && { category }),
          command: stage.id === 'install'
            ? 'npm install'
            : `npm ${stage.localArgs?.join(' ') ?? stage.id}`,
          exitCode: commandResult.exitCode ?? undefined,
          stdout,
          stderr,
          durationMs: commandResult.durationMs,
          cache: stage.id === 'install' ? 'miss' : 'not-applicable',
          attempt: 0
        };
        checks.push(check);
        await input.onProgress?.({
          phase: stage.phase,
          status: check.status!,
          category,
          attempt: 0,
          cache: check.cache,
          message: commandResult.exitCode === 0
            ? `${stage.id} passed`
            : stderr || `${stage.id} failed`
        });
        if (category) {
          result = {
            status: 'failed',
            verification: options.verification,
            checks,
            category,
            retryable: category === 'INFRA_ERROR'
          };
          break;
        }
      }
      let previewArtifactId: string | undefined;
      if (
        !result &&
        options.verification === 'verified' &&
        profile.runtimeDescriptor().kind === 'static-artifact'
      ) {
        throwIfAborted(input.signal);
        currentStage = stages.find(stage => stage.phase === 'build') ?? currentStage;
        const previewBundle = await options.service.exportBuildOutput({
          leaseId: lease._id,
          expectedOwnership: ownership
        });
        const previewArtifact = await options.artifactService.writePreviewBundle({
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          createdByRunId: scope.runId,
          kind: 'preview_build',
          idempotencyKey:
            `sandbox-preview:${scope.runId.toString()}:${scope.attempt}`,
          bundle: previewBundle
        });
        previewArtifactId = previewArtifact.artifactId;
      }
      result ??= {
        status: 'passed',
        verification: options.verification,
        ...(previewArtifactId && { previewArtifactId }),
        checks
      };
    } catch (error) {
      if (input.signal?.aborted) {
        cancellationError = abortReason(input.signal);
      } else {
        result = infrastructureResult(
          checks,
          options.verification,
          currentStage,
          error,
          databaseLease
        );
        await input.onProgress?.({
          phase: currentStage.phase,
          status: 'failed',
          category: 'INFRA_ERROR',
          attempt: 0,
          cache: currentStage.id === 'install' ? 'miss' : 'not-applicable',
          message: redactValidationSecrets(errorMessage(error), databaseLease)
        });
      }
    }

    if (lease) {
      try {
        await options.service.terminate({
          leaseId: lease._id,
          expectedOwnership: ownership
        });
      } catch (error) {
        if (!cancellationError) {
          result = infrastructureResult(
            checks,
            options.verification,
            currentStage,
            error,
            databaseLease
          );
          await input.onProgress?.({
            phase: currentStage.phase,
            status: 'failed',
            category: 'INFRA_ERROR',
            attempt: 0,
            cache: currentStage.id === 'install' ? 'miss' : 'not-applicable',
            message: `Sandbox cleanup failed: ${errorMessage(error)}`
          });
        }
      }
    }

    if (databaseLease) {
      try {
        await databaseLease.destroy();
      } catch {
        if (!cancellationError) {
          result = infrastructureResult(
            checks,
            options.verification,
            currentStage,
            new Error('Validation database cleanup failed')
          );
          await input.onProgress?.({
            phase: currentStage.phase,
            status: 'failed',
            category: 'INFRA_ERROR',
            attempt: 0,
            cache: 'not-applicable',
            message: 'Validation database cleanup failed'
          });
        }
      }
    }

    if (cancellationError) throw cancellationError;
    return result!;
  }
});
