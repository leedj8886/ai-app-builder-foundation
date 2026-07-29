import type { Types } from 'mongoose';
import type { ArtifactService } from '../artifacts/artifactService';
import type { SandboxLeaseDocument } from '../models/SandboxLease';
import { SandboxError } from '../sandbox/errors';
import type { SandboxService } from '../sandbox/SandboxService';
import type {
  ResourceProfile,
  SandboxOwnership
} from '../sandbox/types';
import { classifyValidationFailure } from './validation/classify';
import { validateProjectStructure } from './validation/structure';
import { adaptersFor } from './styling/registry';
import { resolveStylingCapabilities } from './styling/resolveCapabilities';
import type {
  ProjectFile,
  ProjectSnapshotPackageJson,
  ValidationCheckResult,
  ValidationErrorCategory,
  ValidationPhase,
  ValidationResult
} from './types';
import type {
  ProjectValidator,
  ValidateProjectInput
} from './validator';

interface CreateSandboxProjectValidatorOptions {
  service: SandboxService;
  artifactService: ArtifactService;
  provider: string;
  image: string;
  resources: ResourceProfile;
  verification: 'verified' | 'simulated';
}

const commandMetadata: Record<
  'install' | 'type-check' | 'build',
  {
    name: ValidationCheckResult['name'];
    phase: ValidationPhase;
  }
> = {
  install: { name: 'install', phase: 'dependencies' },
  'type-check': { name: 'type-check', phase: 'type-check' },
  build: { name: 'build', phase: 'build' }
};

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
  phase: ValidationPhase,
  error: unknown
): ValidationResult => {
  const metadata = phase === 'structure'
    ? { name: 'structure' as const, phase }
    : phase === 'dependencies'
      ? commandMetadata.install
      : phase === 'type-check'
        ? commandMetadata['type-check']
        : commandMetadata.build;
  checks.push({
    ...metadata,
    status: 'failed',
    category: 'INFRA_ERROR',
    stdout: '',
    stderr: errorMessage(error),
    durationMs: 0,
    cache: metadata.name === 'install' ? 'miss' : 'not-applicable',
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
    const checks: ValidationCheckResult[] = [];
    const structureStartedAt = Date.now();
    const structure = validateProjectStructure(input.files);
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
        'structure',
        new Error('Sandbox validation ownership scope is required')
      );
    }

    let lease: SandboxLeaseDocument | undefined;
    let currentPhase: ValidationPhase = 'dependencies';
    let result: ValidationResult | undefined;
    const ownership = ownershipFor(scope);

    try {
      const artifact = await options.artifactService.writeBundle({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        createdByRunId: scope.runId,
        kind: 'validation_candidate',
        idempotencyKey:
          `sandbox-validation:${scope.runId.toString()}:${scope.attempt}`,
        bundle: {
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

      for (const commandName of [
        'install',
        'type-check',
        'build'
      ] as const) {
        const metadata = commandMetadata[commandName];
        currentPhase = metadata.phase;
        const commandResult = await options.service.runBuildCommand({
          leaseId: lease._id,
          expectedOwnership: ownership,
          command: commandName
        });
        const category: ValidationErrorCategory | undefined =
          commandResult.exitCode === 0
            ? undefined
            : classifyValidationFailure({
              phase: metadata.phase,
              exitCode: commandResult.exitCode ?? undefined,
              stdout: commandResult.stdout,
              stderr: commandResult.stderr
            });
        const check: ValidationCheckResult = {
          ...metadata,
          status: commandResult.exitCode === 0 ? 'passed' : 'failed',
          ...(category && { category }),
          command: commandName === 'install'
            ? 'npm install'
            : `npm run ${commandName}`,
          exitCode: commandResult.exitCode ?? undefined,
          stdout: commandResult.stdout,
          stderr: commandResult.stderr,
          durationMs: commandResult.durationMs,
          cache: commandName === 'install' ? 'miss' : 'not-applicable',
          attempt: 0
        };
        checks.push(check);
        await input.onProgress?.({
          phase: metadata.phase,
          status: check.status!,
          category,
          attempt: 0,
          cache: check.cache,
          message: commandResult.exitCode === 0
            ? `${metadata.name} passed`
            : commandResult.stderr || `${metadata.name} failed`
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
      if (!result && options.verification === 'verified') {
        currentPhase = 'build';
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
      result = infrastructureResult(
        checks,
        options.verification,
        currentPhase,
        error
      );
      await input.onProgress?.({
        phase: currentPhase,
        status: 'failed',
        category: 'INFRA_ERROR',
        attempt: 0,
        cache: currentPhase === 'dependencies' ? 'miss' : 'not-applicable',
        message: errorMessage(error)
      });
    }

    if (lease) {
      try {
        await options.service.terminate({
          leaseId: lease._id,
          expectedOwnership: ownership
        });
      } catch (error) {
        result = infrastructureResult(
          checks,
          options.verification,
          currentPhase,
          error
        );
        await input.onProgress?.({
          phase: currentPhase,
          status: 'failed',
          category: 'INFRA_ERROR',
          attempt: 0,
          cache: currentPhase === 'dependencies' ? 'miss' : 'not-applicable',
          message: `Sandbox cleanup failed: ${errorMessage(error)}`
        });
      }
    }

    return result!;
  }
});
