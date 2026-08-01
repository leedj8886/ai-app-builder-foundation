import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentPlanSchema,
  createAgentRunRequestSchema,
  generationResultSchema,
  listAgentRunsQuerySchema,
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

test('createAgentRunRequestSchema accepts a safe model id', () => {
  const parsed = createAgentRunRequestSchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    prompt: 'Build a dashboard',
    modelId: 'quality-model'
  });

  assert.equal(parsed.modelId, 'quality-model');
  assert.throws(() => createAgentRunRequestSchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    prompt: 'Build a dashboard',
    modelId: '../unsafe'
  }));
});

test('createAgentRunRequestSchema accepts bounded text attachments', () => {
  const attachment = {
    id: 'b4c62ae1-ea47-4cba-a8d2-53ef778d18f1',
    name: 'requirements.md',
    mediaType: 'text/markdown',
    size: 18,
    content: '# Product context'
  };
  const parsed = createAgentRunRequestSchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    prompt: 'Build the attached specification',
    attachments: [attachment]
  });

  assert.deepEqual(parsed.attachments, [attachment]);
  assert.throws(() => createAgentRunRequestSchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    prompt: 'Read this file',
    attachments: [{
      ...attachment,
      name: 'archive.zip',
      mediaType: 'application/zip'
    }]
  }));
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

test('listAgentRunsQuerySchema validates project ids and bounds limits', () => {
  const parsed = listAgentRunsQuerySchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    limit: '12'
  });

  assert.equal(parsed.limit, 12);
  assert.throws(() => listAgentRunsQuerySchema.parse({
    projectId: 'not-an-id'
  }));
  assert.throws(() => listAgentRunsQuerySchema.parse({
    projectId: '64b7f5086f1f8e9f0f000001',
    limit: '31'
  }));
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

test('generationResultSchema accepts supported JavaScript configuration files', () => {
  const parsed = generationResultSchema.parse({
    message: 'Updated build configuration',
    operations: [
      { type: 'update', path: 'tailwind.config.js', content: 'export default {}' },
      { type: 'update', path: 'postcss.config.cjs', content: 'module.exports = {}' },
      { type: 'create', path: 'vite.config.mjs', content: 'export default {}' }
    ],
    dependencies: {},
    devDependencies: {}
  });

  assert.deepEqual(
    parsed.operations.map(operation => operation.path),
    ['tailwind.config.js', 'postcss.config.cjs', 'vite.config.mjs']
  );
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
