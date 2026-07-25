import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateChatTitle,
  generateCode,
  AIServiceDependencies
} from './aiService';

const createDependencies = (
  responses: string[]
): {
  dependencies: AIServiceDependencies;
  requests: Array<Record<string, unknown>>;
} => {
  const requests: Array<Record<string, unknown>> = [];

  return {
    requests,
    dependencies: {
      model: 'deepseek-v4-flash',
      createCompletion: async request => {
        requests.push(request);
        return {
          choices: [{
            message: { content: responses.shift() || '' }
          }]
        };
      }
    }
  };
};

test('generateCode uses the configured DeepSeek model', async () => {
  const { dependencies, requests } = createDependencies([
    '```tsx:src/App.tsx\nexport default function App() { return <main />; }\n```'
  ]);

  const result = await generateCode(
    [{
      id: 'message-1',
      role: 'user',
      content: 'Build an app',
      createdAt: new Date()
    }],
    {},
    dependencies
  );

  assert.equal(requests[0].model, 'deepseek-v4-flash');
  assert.equal(result.codeBlocks[0].fileName, 'src/App.tsx');
});

test('generateChatTitle uses the configured DeepSeek model', async () => {
  const { dependencies, requests } = createDependencies(['Task Dashboard']);

  const title = await generateChatTitle('Build tasks', dependencies);

  assert.equal(title, 'Task Dashboard');
  assert.equal(requests[0].model, 'deepseek-v4-flash');
});

test('generateChatTitle preserves the fallback on provider failure', async () => {
  const title = await generateChatTitle('Build tasks', {
    model: 'deepseek-v4-flash',
    createCompletion: async () => {
      throw new Error('provider detail');
    }
  });

  assert.equal(title, 'New Chat');
});
