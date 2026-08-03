import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECOVERY_DEMO_FAULT_MARKER,
  withControlledRecoveryDemoFault
} from './recoveryDemoModelClient';
import type { ModelClient } from './types';

const modelClient = (): ModelClient => ({
  generatePlan: async () => ({
    value: {
      summary: 'Plan',
      steps: [{
        title: 'Build UI',
        intent: 'Create the application',
        filesLikelyTouched: ['src/App.tsx']
      }],
      assumptions: []
    }
  }),
  generateFiles: async () => ({
    value: {
      message: 'Created app',
      operations: [{
        type: 'update',
        path: 'src/App.tsx',
        content: 'export default function App() { return <main />; }\n'
      }],
      dependencies: {},
      devDependencies: {}
    }
  }),
  repairFiles: async () => ({
    value: {
      message: 'Removed controlled fault',
      operations: [{
        type: 'update',
        path: 'src/App.tsx',
        content: 'export default function App() { return <main />; }\n'
      }],
      dependencies: {},
      devDependencies: {}
    }
  })
});

test('controlled recovery wrapper is disabled by default', () => {
  const client = modelClient();
  assert.equal(withControlledRecoveryDemoFault(client, false), client);
});

test('controlled recovery wrapper injects one real TypeScript failure', async () => {
  const client = withControlledRecoveryDemoFault(modelClient(), true);
  const result = await client.generateFiles({
    context: {
      prompt: 'Build a dashboard',
      mode: 'create',
      project: {
        name: 'Dashboard',
        framework: 'react',
        styling: 'tailwind',
        uiLibrary: 'none'
      },
      messages: [],
      files: []
    },
    plan: {
      summary: 'Plan',
      steps: [{
        title: 'Build UI',
        intent: 'Create the application',
        filesLikelyTouched: ['src/App.tsx']
      }],
      assumptions: []
    }
  });

  assert.equal(result.value.operations.length, 1);
  const operation = result.value.operations[0];
  assert.notEqual(operation.type, 'delete');
  if (operation.type !== 'delete') {
    assert.match(operation.content, new RegExp(RECOVERY_DEMO_FAULT_MARKER));
    assert.match(operation.content, /never = 'trigger a real type-check failure'/);
  }
});

test('controlled recovery wrapper delegates repair unchanged', async () => {
  const client = withControlledRecoveryDemoFault(modelClient(), true);
  const result = await client.repairFiles({
    context: {
      prompt: 'Build a dashboard',
      mode: 'create',
      project: {
        name: 'Dashboard',
        framework: 'react',
        styling: 'tailwind',
        uiLibrary: 'none'
      },
      messages: [],
      files: []
    },
    plan: {
      summary: 'Plan',
      steps: [{
        title: 'Build UI',
        intent: 'Create the application',
        filesLikelyTouched: ['src/App.tsx']
      }],
      assumptions: []
    },
    attempt: 1,
    files: [],
    validation: { status: 'failed', checks: [] }
  });

  assert.equal(result.value.message, 'Removed controlled fault');
  assert.doesNotMatch(
    result.value.operations[0].type === 'delete'
      ? ''
      : result.value.operations[0].content,
    new RegExp(RECOVERY_DEMO_FAULT_MARKER)
  );
});
