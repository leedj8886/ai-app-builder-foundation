import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhaseOneWorkerEvents,
  runAgentGeneration,
  runAgentGenerationWithValidation
} from './orchestrator';
import { AgentContext, ModelClient } from './types';
import { createProjectTemplateFiles } from './projectTemplate';

test('buildPhaseOneWorkerEvents returns fake processing steps', () => {
  const events = buildPhaseOneWorkerEvents();

  assert.deepEqual(events, [
    { type: 'run.started', message: 'Agent run started' },
    { type: 'agent.step', message: 'Phase 1 worker received the run' },
    { type: 'run.completed', message: 'Phase 1 fake worker completed the run' }
  ]);
});

test('runAgentGeneration plans before generating and applies file operations', async () => {
  const calls: string[] = [];
  const events: Array<{ type: string; payload?: unknown }> = [];
  const context: AgentContext = {
    prompt: 'Add a task filter',
    mode: 'edit',
    project: {
      name: 'Tasks',
      framework: 'react',
      styling: 'tailwind',
      uiLibrary: 'none'
    },
    messages: [],
    files: [{ path: 'src/App.tsx', content: 'export default function App() { return null; }' }]
  };
  const plan = {
    summary: 'Add filtering',
    steps: [{
      title: 'Update task UI',
      intent: 'Add filter controls',
      filesLikelyTouched: ['src/App.tsx']
    }],
    assumptions: []
  };
  const modelClient: ModelClient = {
    generatePlan: async input => {
      calls.push('plan');
      assert.equal(input.context, context);
      return {
        value: plan,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
      };
    },
    generateFiles: async input => {
      calls.push('generate');
      assert.equal(input.plan, plan);
      return {
        value: {
          message: 'Added task filtering',
          operations: [{
            type: 'update',
            path: 'src/App.tsx',
            content: 'export default function App() { return <main>Filtered</main>; }'
          }],
          dependencies: { react: '^18.3.0' },
          devDependencies: {}
        },
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
      };
    },
    repairFiles: async () => {
      throw new Error('repair should not run');
    }
  };

  const result = await runAgentGeneration({
    context,
    baseFiles: [{
      path: 'src/App.tsx',
      content: 'export default function App() { return null; }',
      language: 'tsx'
    }],
    modelClient,
    onEvent: event => {
      events.push(event);
    }
  });

  assert.deepEqual(calls, ['plan', 'generate']);
  assert.equal(result.files.find(file => file.path === 'src/App.tsx')?.content.includes('Filtered'), true);
  assert.ok(result.files.find(file => file.path === 'package.json'));
  assert.equal(result.packageJson.dependencies.react, '^18.3.0');
  assert.deepEqual(result.usage, {
    inputTokens: 30,
    outputTokens: 15,
    totalTokens: 45
  });
  assert.deepEqual(events.map(event => event.type), [
    'agent.step',
    'agent.plan',
    'agent.step',
    'file.changed'
  ]);
  assert.deepEqual(events[1].payload, plan);
});

test('Create generation keeps required template files when the model only updates App', async () => {
  const templateFiles = createProjectTemplateFiles();
  const context: AgentContext = {
    prompt: 'Build a contact form',
    mode: 'create',
    project: {
      name: 'Contact',
      framework: 'react',
      styling: 'tailwind',
      uiLibrary: 'none'
    },
    messages: [],
    files: templateFiles.map(file => ({
      path: file.path,
      content: file.content
    }))
  };
  const modelClient: ModelClient = {
    generatePlan: async () => ({
      value: {
        summary: 'Build contact form',
        steps: [{
          title: 'Update App',
          intent: 'Render the form',
          filesLikelyTouched: ['src/App.tsx']
        }],
        assumptions: []
      }
    }),
    generateFiles: async () => ({
      value: {
        message: 'Created contact form',
        operations: [{
          type: 'update',
          path: 'src/App.tsx',
          content: 'export default function App() { return <main>Contact</main>; }'
        }],
        dependencies: {},
        devDependencies: {}
      }
    }),
    repairFiles: async () => {
      throw new Error('repair should not run');
    }
  };

  const result = await runAgentGeneration({
    context,
    baseFiles: templateFiles,
    modelClient,
    onEvent: async () => undefined
  });

  assert.deepEqual(
    result.files.map(file => file.path),
    ['index.html', 'package.json', 'src/App.tsx', 'src/index.css', 'src/main.tsx']
  );
  assert.match(
    result.files.find(file => file.path === 'src/App.tsx')?.content ?? '',
    /Contact/
  );
});

test('runAgentGenerationWithValidation repairs once and then passes', async () => {
  let repairCalls = 0;
  let validationCalls = 0;
  const events: string[] = [];
  const context: AgentContext = {
    prompt: 'Build an app',
    mode: 'create',
    project: {
      name: 'App',
      framework: 'react',
      styling: 'tailwind',
      uiLibrary: 'none'
    },
    messages: [],
    files: []
  };
  const modelClient: ModelClient = {
    generatePlan: async () => ({
      value: {
        summary: 'Build app',
        steps: [{
          title: 'Create app',
          intent: 'Render app',
          filesLikelyTouched: ['src/App.tsx']
        }],
        assumptions: []
      },
      usage: { totalTokens: 10 }
    }),
    generateFiles: async () => ({
      value: {
        message: 'Created app',
        operations: [{
          type: 'create',
          path: 'src/App.tsx',
          content: 'const value: string = 1;'
        }],
        dependencies: {},
        devDependencies: {}
      },
      usage: { totalTokens: 20 }
    }),
    repairFiles: async input => {
      repairCalls += 1;
      assert.equal(input.attempt, 1);
      assert.equal(input.validation.status, 'failed');
      return {
        value: {
          message: 'Fixed app',
          operations: [{
            type: 'update',
            path: 'src/App.tsx',
            content: 'const value: string = "fixed";'
          }],
          dependencies: {},
          devDependencies: {}
        },
        usage: { totalTokens: 5 }
      };
    }
  };
  const failedValidation = {
    status: 'failed' as const,
    checks: [{
      name: 'type-check' as const,
      command: 'npm run type-check',
      exitCode: 2,
      stdout: '',
      stderr: 'type error',
      durationMs: 5
    }]
  };
  const passedValidation = {
    status: 'passed' as const,
    checks: [{
      name: 'type-check' as const,
      command: 'npm run type-check',
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 5
    }]
  };

  const result = await runAgentGenerationWithValidation({
    context,
    baseFiles: [],
    modelClient,
    validator: {
      validate: async () => {
        validationCalls += 1;
        return validationCalls === 1 ? failedValidation : passedValidation;
      }
    },
    runId: 'run-1',
    maxRepairAttempts: 2,
    onEvent: event => {
      events.push(event.type);
    }
  });

  assert.equal(repairCalls, 1);
  assert.equal(validationCalls, 2);
  assert.equal(result.validation.status, 'passed');
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.usage?.totalTokens, 35);
  assert.match(
    result.files.find(file => file.path === 'src/App.tsx')?.content ?? '',
    /fixed/
  );
  assert.deepEqual(events.slice(-7), [
    'validation.started',
    'validation.failed',
    'repair.started',
    'agent.step',
    'file.changed',
    'validation.started',
    'validation.passed'
  ]);
});

test('runAgentGenerationWithValidation does not repair a passing candidate', async () => {
  let repairs = 0;
  const result = await runAgentGenerationWithValidation({
    context: {
      prompt: 'Build app',
      mode: 'create',
      project: {
        name: 'App',
        framework: 'react',
        styling: 'tailwind',
        uiLibrary: 'none'
      },
      messages: [],
      files: []
    },
    baseFiles: [],
    modelClient: {
      generatePlan: async () => ({
        value: {
          summary: 'Build app',
          steps: [{
            title: 'Create app',
            intent: 'Render app',
            filesLikelyTouched: ['src/App.tsx']
          }],
          assumptions: []
        }
      }),
      generateFiles: async () => ({
        value: {
          message: 'Created app',
          operations: [],
          dependencies: {},
          devDependencies: {}
        }
      }),
      repairFiles: async () => {
        repairs += 1;
        throw new Error('repair should not run');
      }
    },
    validator: {
      validate: async () => ({
        status: 'passed',
        checks: []
      })
    },
    runId: 'run-1',
    maxRepairAttempts: 2,
    onEvent: () => {}
  });

  assert.equal(result.validation.status, 'passed');
  assert.equal(result.repairAttempts, 0);
  assert.equal(repairs, 0);
});

test('runAgentGenerationWithValidation fails after exhausting repairs', async () => {
  let repairs = 0;
  let validations = 0;
  const modelClient: ModelClient = {
    generatePlan: async () => ({
      value: {
        summary: 'Build app',
        steps: [{
          title: 'Create app',
          intent: 'Render app',
          filesLikelyTouched: ['src/App.tsx']
        }],
        assumptions: []
      }
    }),
    generateFiles: async () => ({
      value: {
        message: 'Created app',
        operations: [],
        dependencies: {},
        devDependencies: {}
      }
    }),
    repairFiles: async () => {
      repairs += 1;
      return {
        value: {
          message: 'Tried repair',
          operations: [],
          dependencies: {},
          devDependencies: {}
        }
      };
    }
  };
  const validation = {
    status: 'failed' as const,
    checks: [{
      name: 'build' as const,
      command: 'npm run build',
      exitCode: 1,
      stdout: '',
      stderr: 'build failed',
      durationMs: 5
    }]
  };

  await assert.rejects(
    () => runAgentGenerationWithValidation({
      context: {
        prompt: 'Build app',
        mode: 'create',
        project: {
          name: 'App',
          framework: 'react',
          styling: 'tailwind',
          uiLibrary: 'none'
        },
        messages: [],
        files: []
      },
      baseFiles: [],
      modelClient,
      validator: {
        validate: async () => {
          validations += 1;
          return validation;
        }
      },
      runId: 'run-1',
      maxRepairAttempts: 2,
      onEvent: () => {}
    }),
    (error: Error & { code?: string }) => error.code === 'VALIDATION_FAILED'
  );

  assert.equal(repairs, 2);
  assert.equal(validations, 3);
});
