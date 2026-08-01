import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Types } from 'mongoose';
import { ValidationConfig } from './config';
import {
  ProjectFile,
  ValidationCheckResult,
  ValidationErrorCategory,
  ValidationPhase,
  ValidationResult
} from './types';
import {
  createValidationWorkspace,
  ValidationWorkspace
} from './workspace/createWorkspace';
import {
  CommandResult,
  pickValidationEnvironment,
  runCommand,
  RunCommandInput
} from './workspace/runCommand';
import { classifyValidationFailure } from './validation/classify';
import {
  createDependencyCache,
  DependencyCache
} from './validation/dependencyCache';
import { dependencyFingerprint } from './validation/dependencyFingerprint';
import { runWithInfrastructureRetry } from './validation/retry';
import { validateProjectStructure } from './validation/structure';
import { resolveStylingCapabilities } from './styling/resolveCapabilities';
import { adaptersFor } from './styling/registry';
import { readCssBuildEvidence } from './styling/buildEvidence';
import type { StylingIssue } from './styling/types';
import type { ArtifactService } from '../artifacts/artifactService';
import { readPreviewDirectory } from '../artifacts/readPreviewDirectory';
import { throwIfAborted } from './runCancellation';

export interface ValidationProgressEvent {
  phase: ValidationPhase;
  status: ValidationCheckResult['status'];
  category?: ValidationErrorCategory;
  attempt: number;
  retryDelayMs?: number;
  cache?: ValidationCheckResult['cache'];
  stylingIssues?: StylingIssue[];
  message: string;
}

export interface ValidateProjectInput {
  runId: string;
  files: ProjectFile[];
  signal?: AbortSignal;
  sandboxScope?: {
    workspaceId: Types.ObjectId;
    projectId: Types.ObjectId;
    branchId: Types.ObjectId;
    requestedByUserId: Types.ObjectId;
    runId: Types.ObjectId;
    attempt: number;
  };
  onProgress?: (
    event: ValidationProgressEvent
  ) => void | Promise<void>;
}

export interface ProjectValidator {
  validate(input: ValidateProjectInput): Promise<ValidationResult>;
}

interface CreateProjectValidatorOptions {
  workspaceRoot: string;
  validation?: ValidationConfig;
  commandTimeoutMs?: number;
  maxOutputChars?: number;
  createWorkspace?: (
    input: { root: string; runId: string; files: ProjectFile[] }
  ) => Promise<ValidationWorkspace>;
  commandRunner?: (input: RunCommandInput) => Promise<CommandResult>;
  dependencyCache?: DependencyCache;
  retryDelay?: (durationMs: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  cssEvidenceReader?: typeof readCssBuildEvidence;
  artifactService?: ArtifactService;
}

interface InstallationError extends Error {
  category: ValidationErrorCategory;
  result: CommandResult;
  args: string[];
}

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const fallbackValidation = (
  options: CreateProjectValidatorOptions
): ValidationConfig => ({
  structureTimeoutMs: 5_000,
  cacheHitTimeoutMs: 15_000,
  installTimeoutMs: options.commandTimeoutMs ?? 120_000,
  typeCheckTimeoutMs: options.commandTimeoutMs ?? 120_000,
  buildTimeoutMs: options.commandTimeoutMs ?? 120_000,
  roundTimeoutMs: 300_000,
  infrastructureRetryDelaysMs: [5_000, 15_000],
  npmCacheRoot: path.join(options.workspaceRoot, '.npm-cache'),
  dependencyCacheRoot: path.join(options.workspaceRoot, '.dependency-cache'),
  cacheRetentionMs: 7 * 24 * 60 * 60 * 1_000,
  cacheMaxBytes: 10 * 1024 * 1024 * 1024,
  maxOutputChars: options.maxOutputChars ?? 12_000
});

const toCheck = (
  input: {
    name: ValidationCheckResult['name'];
    phase: ValidationPhase;
    status: NonNullable<ValidationCheckResult['status']>;
    result: CommandResult;
    args?: string[];
    category?: ValidationErrorCategory;
    cache?: ValidationCheckResult['cache'];
    attempt?: number;
  }
): ValidationCheckResult => ({
  name: input.name,
  phase: input.phase,
  status: input.status,
  ...(input.args && { command: [npmExecutable, ...input.args].join(' ') }),
  ...input.result,
  ...(input.category && { category: input.category }),
  cache: input.cache ?? 'not-applicable',
  attempt: input.attempt ?? 0
});

const packageData = (files: ProjectFile[]): {
  packageContent: string;
  lockfile?: ProjectFile;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} => {
  const packageFile = files.find(file => file.path === 'package.json')!;
  const parsed = JSON.parse(packageFile.content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    packageContent: packageFile.content,
    lockfile: files.find(file => file.path === 'package-lock.json'),
    dependencies: parsed.dependencies ?? {},
    devDependencies: parsed.devDependencies ?? {}
  };
};

const npmVersionFromEnvironment = (env: NodeJS.ProcessEnv): string =>
  env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1] ?? 'unknown';

export const createProjectValidator = (
  options: CreateProjectValidatorOptions
): ProjectValidator => {
  const validation = options.validation ?? fallbackValidation(options);
  const workspaceFactory = options.createWorkspace ?? createValidationWorkspace;
  const commandRunner = options.commandRunner ?? runCommand;
  const dependencyCache = options.dependencyCache ?? createDependencyCache({
    root: validation.dependencyCacheRoot
  });
  const sourceEnvironment = options.env ?? process.env;
  const selectedEnvironment = pickValidationEnvironment(sourceEnvironment);
  const commandEnvironment = {
    ...selectedEnvironment,
    PATH: [path.dirname(process.execPath), selectedEnvironment.PATH]
      .filter((value): value is string => Boolean(value))
      .join(path.delimiter),
    npm_config_cache: validation.npmCacheRoot
  };

  return {
    validate: async input => {
      throwIfAborted(input.signal);
      const checks: ValidationCheckResult[] = [];
      const structureStartedAt = Date.now();
      const structure = validateProjectStructure(input.files);
      const structureCheck: ValidationCheckResult = {
        name: 'structure',
        phase: 'structure',
        status: structure.status,
        ...(structure.category && { category: structure.category }),
        stdout: structure.stdout,
        stderr: structure.stderr,
        durationMs: Date.now() - structureStartedAt,
        cache: 'not-applicable',
        attempt: 0
      };
      checks.push(structureCheck);
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
          verification: 'verified',
          checks,
          category: structure.category,
          retryable: false
        };
      }
      throwIfAborted(input.signal);

      const stylingAdapters = adaptersFor(
        resolveStylingCapabilities(input.files)
      );
      const stylingIssues = stylingAdapters.flatMap(adapter =>
        adapter.validateSource(input.files)
      );
      if (stylingIssues.length > 0) {
        const message = stylingIssues.map(issue => issue.message).join('\n');
        const stylingCheck: ValidationCheckResult = {
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
        };
        checks.push(stylingCheck);
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
          verification: 'verified',
          checks,
          category: 'STYLING_CONFIGURATION_ERROR',
          retryable: false
        };
      }

      const workspace = await workspaceFactory({
        root: options.workspaceRoot,
        runId: input.runId,
        files: input.files
      });
      const execute = (
        args: string[],
        cwd: string,
        timeoutMs: number
      ) => commandRunner({
        executable: npmExecutable,
        args,
        cwd,
        timeoutMs,
        maxOutputChars: validation.maxOutputChars,
        env: commandEnvironment,
        signal: input.signal
      });

      try {
        const packageJson = packageData(input.files);
        const fingerprint = dependencyFingerprint({
          dependencies: packageJson.dependencies,
          devDependencies: packageJson.devDependencies,
          lockfile: packageJson.lockfile?.content,
          nodeVersion: process.version,
          npmVersion: npmVersionFromEnvironment(sourceEnvironment),
          platform: process.platform,
          arch: process.arch
        });
        let installAttempt = 0;
        let prepared: Awaited<ReturnType<DependencyCache['prepare']>>;

        try {
          prepared = await runWithInfrastructureRetry({
            retryDelaysMs: validation.infrastructureRetryDelaysMs,
            delay: options.retryDelay,
            onRetry: async (error, attempt, retryDelayMs) => {
              throwIfAborted(input.signal);
              const candidate = error as InstallationError;
              checks.push(toCheck({
                name: 'install',
                phase: 'dependencies',
                status: 'retrying',
                result: candidate.result,
                args: candidate.args,
                category: 'INFRA_ERROR',
                cache: 'miss',
                attempt
              }));
              await input.onProgress?.({
                phase: 'dependencies',
                status: 'retrying',
                category: 'INFRA_ERROR',
                attempt,
                retryDelayMs,
                cache: 'miss',
                message: `Dependency service unavailable; retrying in ${retryDelayMs}ms`
              });
            },
            operation: async attempt => {
              throwIfAborted(input.signal);
              installAttempt = attempt;
              return dependencyCache.prepare({
                fingerprint,
                workspacePath: workspace.path,
                install: async stagingPath => {
                  await mkdir(stagingPath, { recursive: true });
                  await writeFile(
                    path.join(stagingPath, 'package.json'),
                    packageJson.packageContent
                  );
                  if (packageJson.lockfile) {
                    await writeFile(
                      path.join(stagingPath, packageJson.lockfile.path),
                      packageJson.lockfile.content
                    );
                  }
                  const args = [
                    packageJson.lockfile ? 'ci' : 'install',
                    '--ignore-scripts',
                    '--no-audit',
                    '--no-fund'
                  ];
                  const result = await execute(
                    args,
                    stagingPath,
                    validation.installTimeoutMs
                  );
                  if (result.exitCode !== 0) {
                    const category = classifyValidationFailure({
                      phase: 'dependencies',
                      exitCode: result.exitCode,
                      stdout: result.stdout,
                      stderr: result.stderr
                    });
                    throw Object.assign(
                      new Error(result.stderr || 'Dependency installation failed'),
                      { category, result, args }
                    ) as InstallationError;
                  }
                  checks.push(toCheck({
                    name: 'install',
                    phase: 'dependencies',
                    status: 'passed',
                    result,
                    args,
                    cache: 'miss',
                    attempt
                  }));
                }
              });
            }
          });
        } catch (error) {
          throwIfAborted(input.signal);
          const candidate = error as InstallationError;
          const category = candidate.category ?? 'INFRA_ERROR';
          checks.push(toCheck({
            name: 'install',
            phase: 'dependencies',
            status: 'failed',
            result: candidate.result ?? {
              exitCode: 1,
              stdout: '',
              stderr: candidate.message,
              durationMs: 0
            },
            args: candidate.args,
            category,
            cache: 'miss',
            attempt: installAttempt
          }));
          await input.onProgress?.({
            phase: 'dependencies',
            status: 'failed',
            category,
            attempt: installAttempt,
            cache: 'miss',
            message: candidate.message
          });
          return {
            status: 'failed',
            verification: 'verified',
            checks,
            category,
            retryable: category === 'INFRA_ERROR'
          };
        }

        if (prepared.cache === 'hit') {
          checks.push({
            name: 'install',
            phase: 'dependencies',
            status: 'passed',
            stdout: 'Dependency cache hit',
            stderr: '',
            durationMs: 0,
            cache: 'hit',
            attempt: 0
          });
        }
        await input.onProgress?.({
          phase: 'dependencies',
          status: 'passed',
          attempt: installAttempt,
          cache: prepared.cache,
          message: prepared.cache === 'hit'
            ? 'Dependency cache hit'
            : 'Dependencies installed'
        });
        throwIfAborted(input.signal);

        const codeChecks = await Promise.all([
          {
            name: 'type-check' as const,
            phase: 'type-check' as const,
            args: ['run', 'type-check'],
            timeoutMs: validation.typeCheckTimeoutMs
          },
          {
            name: 'build' as const,
            phase: 'build' as const,
            args: ['run', 'build', '--', '--base=./'],
            timeoutMs: validation.buildTimeoutMs
          }
        ].map(async check => {
          const result = await execute(check.args, workspace.path, check.timeoutMs);
          const category = result.exitCode === 0
            ? undefined
            : classifyValidationFailure({
              phase: check.phase,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr
            });
          const mapped = toCheck({
            ...check,
            status: result.exitCode === 0 ? 'passed' : 'failed',
            result,
            category
          });
          await input.onProgress?.({
            phase: check.phase,
            status: mapped.status,
            category,
            attempt: 0,
            cache: 'not-applicable',
            message: result.exitCode === 0
              ? `${check.name} passed`
              : result.stderr || `${check.name} failed`
          });
          return mapped;
        }));
        checks.push(...codeChecks);
        const failed = codeChecks.find(check => check.status === 'failed');

        if (!failed && (options.cssEvidenceReader || !options.commandRunner)) {
          const cssAssets = await (
            options.cssEvidenceReader ?? readCssBuildEvidence
          )({
            workspacePath: workspace.path,
            maxChars: validation.maxOutputChars * 10
          });
          const buildIssues = stylingAdapters.flatMap(adapter =>
            adapter.validateBuild?.({ files: input.files, cssAssets }) ?? []
          );
          if (buildIssues.length > 0) {
            const message = buildIssues.map(issue => issue.message).join('\n');
            checks.push({
              name: 'build',
              phase: 'build',
              status: 'failed',
              category: 'STYLING_CONFIGURATION_ERROR',
              stdout: '',
              stderr: message,
              durationMs: 0,
              cache: 'not-applicable',
              attempt: 0,
              stylingIssues: buildIssues
            });
            await input.onProgress?.({
              phase: 'build',
              status: 'failed',
              category: 'STYLING_CONFIGURATION_ERROR',
              attempt: 0,
              cache: 'not-applicable',
              stylingIssues: buildIssues,
              message
            });
            return {
              status: 'failed',
              verification: 'verified',
              checks,
              category: 'STYLING_CONFIGURATION_ERROR',
              retryable: false
            };
          }
        }

        if (failed) {
          return {
            status: 'failed',
            verification: 'verified',
            checks,
            category: failed.category ?? 'CODE_ERROR',
            retryable: false
          };
        }

        let previewArtifactId: string | undefined;
        if (options.artifactService && input.sandboxScope) {
          throwIfAborted(input.signal);
          try {
            const bundle = await readPreviewDirectory(workspace.path);
            const previewArtifact = await options.artifactService.writePreviewBundle({
              workspaceId: input.sandboxScope.workspaceId,
              projectId: input.sandboxScope.projectId,
              createdByRunId: input.sandboxScope.runId,
              kind: 'preview_build',
              idempotencyKey:
                `legacy-preview:${input.sandboxScope.runId.toString()}:${input.sandboxScope.attempt}`,
              bundle
            });
            previewArtifactId = previewArtifact.artifactId;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            checks.push({
              name: 'build',
              phase: 'build',
              status: 'failed',
              category: 'INFRA_ERROR',
              stdout: '',
              stderr: message,
              durationMs: 0,
              cache: 'not-applicable',
              attempt: 0
            });
            await input.onProgress?.({
              phase: 'build',
              status: 'failed',
              category: 'INFRA_ERROR',
              attempt: 0,
              cache: 'not-applicable',
              message
            });
            return {
              status: 'failed',
              verification: 'verified',
              checks,
              category: 'INFRA_ERROR',
              retryable: true
            };
          }
        }

        return {
          status: 'passed',
          verification: 'verified',
          ...(previewArtifactId && { previewArtifactId }),
          checks
        };
      } finally {
        await workspace.cleanup();
      }
    }
  };
};
