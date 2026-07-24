import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhaseOneWorkerEvents,
  runAgentGeneration
} from './orchestrator';
import { AgentContext, ModelClient } from './types';

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
