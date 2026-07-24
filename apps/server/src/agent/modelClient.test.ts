import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIModelClient } from './modelClient';
import { AgentContext } from './types';

const context: AgentContext = {
  prompt: 'Build a task dashboard',
  mode: 'create',
  project: {
    name: 'Tasks',
    framework: 'react',
    styling: 'tailwind',
    uiLibrary: 'none'
  },
  messages: [],
  files: []
};

test('OpenAI model client parses plans and normalizes usage', async () => {
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const client = createOpenAIModelClient({
    model: 'test-model',
    createCompletion: async request => {
      requests.push(request);
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: 'Build the dashboard',
              steps: [{
                title: 'Create UI',
                intent: 'Render tasks',
                filesLikelyTouched: ['src/App.tsx']
              }],
              assumptions: []
            })
          }
        }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20
        }
      };
    }
  });

  const result = await client.generatePlan({ context });

  assert.equal(result.value.summary, 'Build the dashboard');
  assert.deepEqual(result.usage, {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20
  });
  assert.match(requests[0].messages[0].content, /React/);
  assert.match(requests[0].messages[0].content, /TypeScript/);
  assert.match(requests[0].messages[0].content, /Tailwind/);
});

test('OpenAI model client parses structured file generation', async () => {
  const client = createOpenAIModelClient({
    model: 'test-model',
    createCompletion: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            message: 'Created app',
            operations: [{
              type: 'create',
              path: 'src/App.tsx',
              content: 'export default function App() { return <main />; }'
            }],
            dependencies: { react: '^18.2.0' },
            devDependencies: { typescript: '^5.4.0' }
          })
        }
      }]
    })
  });

  const plan = {
    summary: 'Build the dashboard',
    steps: [{
      title: 'Create UI',
      intent: 'Render tasks',
      filesLikelyTouched: ['src/App.tsx']
    }],
    assumptions: []
  };
  const result = await client.generateFiles({ context, plan });

  assert.equal(result.value.operations[0].path, 'src/App.tsx');
});

test('OpenAI model client reports invalid model output after one retry', async () => {
  let attempts = 0;
  const client = createOpenAIModelClient({
    model: 'test-model',
    createCompletion: async () => {
      attempts += 1;
      return { choices: [{ message: { content: '{not json' } }] };
    }
  });

  await assert.rejects(
    () => client.generatePlan({ context }),
    (error: Error & { code?: string }) => error.code === 'INVALID_MODEL_OUTPUT'
  );
  assert.equal(attempts, 2);
});

test('OpenAI model client maps provider failures without exposing details', async () => {
  const client = createOpenAIModelClient({
    model: 'test-model',
    createCompletion: async () => {
      throw new Error('secret provider response');
    }
  });

  await assert.rejects(
    () => client.generatePlan({ context }),
    (error: Error & { code?: string }) =>
      error.code === 'MODEL_REQUEST_FAILED' &&
      error.message === 'Model request failed'
  );
});

test('OpenAI model client sends structured validation diagnostics for repair', async () => {
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const client = createOpenAIModelClient({
    model: 'test-model',
    createCompletion: async request => {
      requests.push(request);
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              message: 'Fixed type error',
              operations: [{
                type: 'update',
                path: 'src/App.tsx',
                content: 'export default function App() { return <main />; }'
              }],
              dependencies: {},
              devDependencies: {}
            })
          }
        }]
      };
    }
  });
  const plan = {
    summary: 'Build the dashboard',
    steps: [{
      title: 'Create UI',
      intent: 'Render tasks',
      filesLikelyTouched: ['src/App.tsx']
    }],
    assumptions: []
  };

  const result = await client.repairFiles({
    context,
    plan,
    attempt: 1,
    files: [{
      path: 'src/App.tsx',
      content: 'const broken: string = 1;',
      language: 'tsx'
    }],
    validation: {
      status: 'failed',
      checks: [{
        name: 'type-check',
        command: 'npm run type-check',
        exitCode: 2,
        stdout: '',
        stderr: 'Type number is not assignable to string',
        durationMs: 10
      }]
    }
  });

  assert.equal(result.value.message, 'Fixed type error');
  assert.match(requests[0].messages[0].content, /repair/i);
  const userInput = JSON.parse(requests[0].messages[1].content);
  assert.equal(userInput.attempt, 1);
  assert.equal(userInput.validation.checks[0].name, 'type-check');
  assert.equal(userInput.files[0].path, 'src/App.tsx');
});
