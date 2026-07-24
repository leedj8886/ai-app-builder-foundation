import path from 'node:path';
import { ProjectFile, ValidationCheckResult, ValidationResult } from './types';
import {
  createValidationWorkspace,
  ValidationWorkspace
} from './workspace/createWorkspace';
import {
  CommandResult,
  runCommand,
  RunCommandInput
} from './workspace/runCommand';

export interface ValidateProjectInput {
  runId: string;
  files: ProjectFile[];
}

export interface ProjectValidator {
  validate(input: ValidateProjectInput): Promise<ValidationResult>;
}

interface CreateProjectValidatorOptions {
  workspaceRoot: string;
  commandTimeoutMs: number;
  maxOutputChars: number;
  createWorkspace?: (
    input: { root: string; runId: string; files: ProjectFile[] }
  ) => Promise<ValidationWorkspace>;
  commandRunner?: (input: RunCommandInput) => Promise<CommandResult>;
}

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const toCheck = (
  name: ValidationCheckResult['name'],
  args: string[],
  result: CommandResult
): ValidationCheckResult => ({
  name,
  command: [npmExecutable, ...args].join(' '),
  ...result
});

export const createProjectValidator = (
  options: CreateProjectValidatorOptions
): ProjectValidator => {
  const workspaceFactory = options.createWorkspace ?? createValidationWorkspace;
  const commandRunner = options.commandRunner ?? runCommand;

  return {
    validate: async input => {
      const workspace = await workspaceFactory({
        root: options.workspaceRoot,
        runId: input.runId,
        files: input.files
      });
      const execute = (args: string[]) => commandRunner({
        executable: npmExecutable,
        args,
        cwd: workspace.path,
        timeoutMs: options.commandTimeoutMs,
        maxOutputChars: options.maxOutputChars,
        env: {
          PATH: process.env.PATH ?? '',
          npm_config_cache: path.join(workspace.path, '.npm-cache')
        }
      });

      try {
        const installed = await execute([
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund'
        ]);

        if (installed.exitCode !== 0) {
          return {
            status: 'failed',
            checks: [toCheck(
              'install',
              ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
              installed
            )]
          };
        }

        const typeCheckArgs = ['run', 'type-check'];
        const buildArgs = ['run', 'build'];
        const typeCheck = await execute(typeCheckArgs);
        const build = await execute(buildArgs);
        const checks = [
          toCheck('type-check', typeCheckArgs, typeCheck),
          toCheck('build', buildArgs, build)
        ];

        return {
          status: checks.every(check => check.exitCode === 0)
            ? 'passed'
            : 'failed',
          checks
        };
      } finally {
        await workspace.cleanup();
      }
    }
  };
};
