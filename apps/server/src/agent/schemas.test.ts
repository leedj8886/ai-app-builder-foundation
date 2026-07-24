import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentPlanSchema,
  createAgentRunRequestSchema,
  generationResultSchema,
  objectIdParamSchema,
  streamTokenRequestSchema
} from './schemas';

test('createAgentRunRequestSchema defaults mode to create', () => {
  const parsed = createAgentRunRequestSchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    prompt: 'Build a dashboard'
  });

  assert.equal(parsed.mode, 'create');
});

test('createAgentRunRequestSchema rejects blank prompts', () => {
  assert.throws(() => {
    createAgentRunRequestSchema.parse({
      projectId: '64b7f5086f1f8e9f0f000001',
      prompt: '   '
    });
  });
});

test('objectIdParamSchema rejects invalid ObjectId strings', () => {
  assert.throws(() => {
    objectIdParamSchema('runId').parse({ runId: 'not-an-id' });
  });
});

test('streamTokenRequestSchema accepts run and event ids', () => {
  const parsed = streamTokenRequestSchema.parse({
    runId: '64b7f5086f1f8e9f0f000001',
    lastEventId: '12'
  });

  assert.equal(parsed.lastEventId, 12);
});

test('agentPlanSchema accepts a structured implementation plan', () => {
  const parsed = agentPlanSchema.parse({
    summary: 'Build a task dashboard',
    steps: [{
      title: 'Create dashboard',
      intent: 'Render task metrics and a task list',
      filesLikelyTouched: ['src/App.tsx', 'src/index.css']
    }],
    assumptions: ['Use in-memory demo data']
  });

  assert.equal(parsed.steps[0].title, 'Create dashboard');
});

test('agentPlanSchema rejects blank plan steps', () => {
  assert.throws(() => agentPlanSchema.parse({
    summary: 'Build an app',
    steps: [{
      title: ' ',
      intent: 'Render the app',
      filesLikelyTouched: ['src/App.tsx']
    }],
    assumptions: []
  }));
});

test('generationResultSchema accepts safe structured file operations', () => {
  const parsed = generationResultSchema.parse({
    message: 'Created the app',
    operations: [
      { type: 'create', path: 'src/App.tsx', content: 'export default function App() {}' },
      { type: 'delete', path: 'README.md' }
    ],
    dependencies: { react: '^18.2.0' },
    devDependencies: { typescript: '^5.4.0' }
  });

  assert.equal(parsed.operations.length, 2);
});

test('generationResultSchema rejects unsafe or incomplete operations', () => {
  const base = {
    message: 'Created the app',
    dependencies: {},
    devDependencies: {}
  };

  assert.throws(() => generationResultSchema.parse({
    ...base,
    operations: [{ type: 'create', path: '/tmp/App.tsx', content: '' }]
  }));
  assert.throws(() => generationResultSchema.parse({
    ...base,
    operations: [{ type: 'create', path: 'src/logo.png', content: '' }]
  }));
  assert.throws(() => generationResultSchema.parse({
    ...base,
    operations: [{ type: 'create', path: 'src/App.tsx' }]
  }));
  assert.throws(() => generationResultSchema.parse({
    ...base,
    operations: [],
    dependencies: []
  }));
});
