import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectTemplateFiles } from './projectTemplate';
import { ProjectFile } from './types';
import { createProjectValidator } from './validator';
import { CommandResult, RunCommandInput } from './workspace/runCommand';

const success = (stdout = ''): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  durationMs: 5
});

const projectFiles = (): ProjectFile[] => [
  ...createProjectTemplateFiles(),
  {
    path: 'package.json',
    language: 'json',
    content: JSON.stringify({
      dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
      devDependencies: { vite: '^5.4.0', typescript: '^5.4.0' },
      scripts: { 'type-check': 'tsc --noEmit', build: 'tsc && vite build' }
    })
  }
];

const validation = {
  structureTimeoutMs: 5_000,
  cacheHitTimeoutMs: 15_000,
  installTimeoutMs: 180_000,
  typeCheckTimeoutMs: 60_000,
  buildTimeoutMs: 120_000,
  roundTimeoutMs: 300_000,
  infrastructureRetryDelaysMs: [5, 15],
  npmCacheRoot: '/tmp/npm-cache',
  dependencyCacheRoot: '/tmp/dependency-cache',
  cacheRetentionMs: 1_000,
  cacheMaxBytes: 1_000,
  maxOutputChars: 2_000
};

const cacheMiss = {
  prepare: async (input: {
    fingerprint: string;
    workspacePath: string;
    install(stagingPath: string): Promise<void>;
  }) => {
    await input.install('/tmp/cache-stage');
    return {
      cache: 'miss' as const,
      nodeModulesPath: '/tmp/cache/node_modules'
    };
  }
};

test('project validator runs structure install type-check and build phases', async () => {
  const commands: RunCommandInput[] = [];
  let cleaned = false;
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    validation,
    dependencyCache: cacheMiss,
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
    files: projectFiles()
  });

  assert.deepEqual(commands.map(command => [command.executable, ...command.args]), [
    ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
    ['npm', 'run', 'type-check'],
    ['npm', 'run', 'build', '--', '--base=./']
  ]);
  assert.equal(result.status, 'passed');
  assert.deepEqual(
    result.checks.map(check => check.name),
    ['structure', 'install', 'type-check', 'build']
  );
  assert.equal(cleaned, true);
});

test('project validator stops before npm on structural failure', async () => {
  let calls = 0;
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    validation,
    dependencyCache: cacheMiss,
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {}
    }),
    commandRunner: async () => {
      calls += 1;
      return success();
    }
  });

  const result = await validator.validate({
    runId: 'run-1',
    files: projectFiles().filter(file => file.path !== 'src/main.tsx')
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'CODE_ERROR');
  assert.equal(calls, 0);
});

test('project validator stops before npm on styling contract failure', async () => {
  let calls = 0;
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    validation,
    commandRunner: async () => {
      calls += 1;
      return success();
    }
  });
  const result = await validator.validate({
    runId: 'run-styling',
    files: projectFiles().filter(file =>
      !['tailwind.config.js', 'postcss.config.cjs'].includes(file.path)
    )
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'STYLING_CONFIGURATION_ERROR');
  assert.equal(
    result.checks.at(-1)?.stylingIssues?.[0]?.code,
    'MISSING_CONFIGURATION'
  );
  assert.equal(calls, 0);
});

test('project validator reports ineffective styling build evidence', async () => {
  const progress: Array<{ category?: string; stylingIssues?: unknown[] }> = [];
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    validation,
    dependencyCache: {
      prepare: async () => ({
        cache: 'hit',
        nodeModulesPath: '/tmp/cache/node_modules'
      })
    },
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {}
    }),
    commandRunner: async () => success(),
    cssEvidenceReader: async () => [{
      path: 'dist/app.css',
      content: '@tailwind utilities;'
    }]
  });

  const result = await validator.validate({
    runId: 'run-styling-build',
    files: projectFiles(),
    onProgress: event => {
      progress.push(event);
    }
  });

  assert.equal(result.category, 'STYLING_CONFIGURATION_ERROR');
  assert.equal(
    result.checks.at(-1)?.stylingIssues?.[0]?.code,
    'UNEXPANDED_DIRECTIVE'
  );
  assert.equal(progress.at(-1)?.category, 'STYLING_CONFIGURATION_ERROR');
  assert.equal(progress.at(-1)?.stylingIssues?.length, 1);
});

test('project validator retries infrastructure install failures and cleans up', async () => {
  let calls = 0;
  let cleaned = false;
  const retryingCache = {
    prepare: async (input: {
      fingerprint: string;
      workspacePath: string;
      install(stagingPath: string): Promise<void>;
    }) => {
      await input.install('/tmp/cache-stage');
      return {
        cache: 'miss' as const,
        nodeModulesPath: '/tmp/cache/node_modules'
      };
    }
  };
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    validation,
    dependencyCache: retryingCache,
    retryDelay: async () => {},
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {
        cleaned = true;
      }
    }),
    commandRunner: async () => {
      calls += 1;
      return {
        exitCode: 124,
        stdout: '',
        stderr: 'Command timed out after 180000ms',
        durationMs: 180_000
      };
    }
  });

  const result = await validator.validate({
    runId: 'run-1',
    files: projectFiles()
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'INFRA_ERROR');
  assert.equal(result.retryable, true);
  assert.equal(calls, 3);
  assert.equal(
    result.checks.filter(check => check.status === 'retrying').length,
    2
  );
  assert.equal(cleaned, true);
});

test('project validator uses cache hit without running install', async () => {
  const commands: RunCommandInput[] = [];
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    validation,
    dependencyCache: {
      prepare: async () => ({
        cache: 'hit',
        nodeModulesPath: '/tmp/cache/node_modules'
      })
    },
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {}
    }),
    commandRunner: async input => {
      commands.push(input);
      return success();
    }
  });

  const result = await validator.validate({
    runId: 'run-1',
    files: projectFiles()
  });

  assert.deepEqual(commands.map(command => command.args), [
    ['run', 'type-check'],
    ['run', 'build', '--', '--base=./']
  ]);
  assert.equal(result.checks[1]?.cache, 'hit');
});

test('project validator runs both code checks and reports code failure', async () => {
  const results = [
    success(),
    { ...success(), exitCode: 2, stderr: 'type error' },
    success('built')
  ];
  const validator = createProjectValidator({
    workspaceRoot: '/tmp/unused',
    validation,
    dependencyCache: cacheMiss,
    createWorkspace: async () => ({
      path: '/tmp/workspace',
      cleanup: async () => {}
    }),
    commandRunner: async () => results.shift()!
  });

  const result = await validator.validate({
    runId: 'run-1',
    files: projectFiles()
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'CODE_ERROR');
  assert.equal(result.checks.at(-2)?.exitCode, 2);
  assert.equal(result.checks.at(-1)?.exitCode, 0);
});
