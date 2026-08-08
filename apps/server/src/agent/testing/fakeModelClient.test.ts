import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentContext, AgentPlan, FileOperation } from '../types';
import { createFakeModelClient } from './fakeModelClient';

const plan: AgentPlan = {
  summary: 'Update the app',
  steps: [{
    title: 'Update App',
    intent: 'Apply the requested edit',
    filesLikelyTouched: ['src/App.tsx']
  }],
  assumptions: []
};

const context = (
  mode: AgentContext['mode'],
  appContent?: string
): AgentContext => ({
  prompt: mode === 'create' ? 'Create an app' : 'Edit the app',
  mode,
  project: {
    name: 'Test app',
    framework: 'react',
    styling: 'tailwind',
    uiLibrary: 'none'
  },
  messages: [],
  files: appContent === undefined
    ? []
    : [{ path: 'src/App.tsx', content: appContent }]
});

const hasFileContent = (
  operation: FileOperation
): operation is Extract<FileOperation, { content: string }> =>
  operation.type !== 'delete';

test('fake model produces an effective App update for Edit mode', async () => {
  const client = createFakeModelClient();
  const created = await client.generateFiles({
    context: context('create'),
    plan
  });
  const createdApp = created.value.operations.filter(hasFileContent).find(
    operation => operation.path === 'src/App.tsx'
  );
  assert.ok(createdApp);

  const edited = await client.generateFiles({
    context: context('edit', createdApp.content),
    plan
  });
  const editedApp = edited.value.operations.filter(hasFileContent).find(
    operation => operation.path === 'src/App.tsx'
  );
  assert.ok(editedApp);
  assert.notEqual(editedApp.content, createdApp.content);
});

test('fake model produces a bounded full-stack Todo candidate', async () => {
  const client = createFakeModelClient();
  const fullstackContext: AgentContext = {
    ...context('create'),
    project: {
      name: 'Todos',
      profile: { id: 'fullstack-nestjs-prisma-postgres', version: 1 }
    }
  };
  const planned = await client.generatePlan({ context: fullstackContext });
  const generated = await client.generateFiles({
    context: fullstackContext,
    plan: planned.value
  });

  assert.ok(generated.value.operations.some(operation =>
    operation.path === 'apps/api/src/modules/todo/todo.controller.ts'
  ));
  assert.ok(generated.value.operations.some(operation =>
    operation.path === 'apps/api/src/modules/todo/todo.controller.ts'
      && hasFileContent(operation)
      && operation.content.includes('@Inject(TodoService)')
  ));
  assert.ok(generated.value.operations.some(operation =>
    operation.path === 'apps/api/src/modules/todo/todo.service.ts'
      && hasFileContent(operation)
      && operation.content.includes('@Inject(PrismaService)')
  ));
  assert.ok(generated.value.operations.some(operation =>
    operation.path === 'prisma/schema.prisma'
  ));
  assert.ok(generated.value.operations.some(operation =>
    operation.path.endsWith('/migration.sql')
  ));
  assert.equal(generated.value.operations.some(operation =>
    operation.path === 'apps/api/src/main.ts'
  ), false);
});
