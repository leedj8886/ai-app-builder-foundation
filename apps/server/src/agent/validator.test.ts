import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectValidator } from './validator';
import { CommandResult, RunCommandInput } from './workspace/runCommand';

const success = (stdout = ''): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  durationMs: 5
});

test('project validator runs only the fixed install type-check and build commands', async () => {
  const commands: RunCommandInput[] = [];
  let cleaned = false;
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    commandTimeoutMs: 1_000,
    maxOutputChars: 2_000,
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {
        cleaned = true;
      }
    }),
    commandRunner: async input => {
      commands.push(input);
      return success(input.args.join(' '));
    }
  });

  const result = await validator.validate({
    runId: 'run-1',
    files: []
  });

  assert.deepEqual(commands.map(command => [command.executable, ...command.args]), [
    ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
    ['npm', 'run', 'type-check'],
    ['npm', 'run', 'build']
  ]);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.checks.map(check => check.name), ['type-check', 'build']);
  assert.equal(cleaned, true);
});

test('project validator stops after install failure and still cleans up', async () => {
  let calls = 0;
  let cleaned = false;
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    commandTimeoutMs: 1_000,
    maxOutputChars: 100,
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {
        cleaned = true;
      }
    }),
    commandRunner: async () => {
      calls += 1;
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'install failed',
        durationMs: 5
      };
    }
  });

  const result = await validator.validate({ runId: 'run-1', files: [] });

  assert.equal(result.status, 'failed');
  assert.equal(result.checks[0].name, 'install');
  assert.equal(result.checks[0].stderr, 'install failed');
  assert.equal(calls, 1);
  assert.equal(cleaned, true);
});

test('project validator runs both checks and reports any failed check', async () => {
  const results = [
    success(),
    { ...success(), exitCode: 2, stderr: 'type error' },
    success('built')
  ];
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    commandTimeoutMs: 1_000,
    maxOutputChars: 100,
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {}
    }),
    commandRunner: async () => results.shift()!
  });

  const result = await validator.validate({ runId: 'run-1', files: [] });

  assert.equal(result.status, 'failed');
  assert.equal(result.checks[0].exitCode, 2);
  assert.equal(result.checks[1].exitCode, 0);
});
