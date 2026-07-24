import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentContext } from './contextBuilder';

const input = {
  prompt: 'Add a task filter',
  mode: 'edit' as const,
  project: {
    name: 'Tasks',
    description: 'A focused task manager',
    settings: {
      framework: 'vue' as const,
      styling: 'css-modules' as const,
      uiLibrary: 'none' as const
    }
  },
  messages: [
    { role: 'user' as const, content: 'Build a task manager' },
    { role: 'assistant' as const, content: 'Created the first version' }
  ],
  files: [
    { path: 'src/App.tsx', content: 'export default function App() { return null; }' },
    { path: 'src/index.css', content: '@tailwind base;' }
  ]
};

test('buildAgentContext includes project chat and small snapshot contents', () => {
  const context = buildAgentContext(input, 10_000);

  assert.equal(context.prompt, 'Add a task filter');
  assert.equal(context.project.name, 'Tasks');
  assert.equal(context.project.framework, 'react');
  assert.equal(context.project.styling, 'tailwind');
  assert.deepEqual(context.messages, input.messages);
  assert.equal(context.files[0].content, input.files[0].content);
});

test('buildAgentContext falls back to a file manifest over the character limit', () => {
  const context = buildAgentContext(input, 120);

  assert.deepEqual(context.files, [
    { path: 'src/App.tsx' },
    { path: 'src/index.css' }
  ]);
});

test('buildAgentContext keeps only the most recent chat messages', () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({
    role: 'user' as const,
    content: `message-${index}`
  }));
  const context = buildAgentContext({ ...input, messages }, 10_000);

  assert.equal(context.messages.length, 20);
  assert.equal(context.messages[0].content, 'message-5');
});

test('buildAgentContext applies the character limit to oversized chat content', () => {
  const context = buildAgentContext({
    ...input,
    messages: [{ role: 'user', content: 'x'.repeat(10_000) }]
  }, 200);

  assert.ok(JSON.stringify(context).length < 500);
  assert.ok((context.messages[0]?.content.length ?? 0) < 200);
  assert.equal(context.files.every(file => file.content === undefined), true);
});
