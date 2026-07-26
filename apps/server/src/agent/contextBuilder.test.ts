import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentContext, loadAgentContext } from './contextBuilder';
import { createProjectTemplateFiles } from './projectTemplate';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import {
  getArtifactService,
  setArtifactServiceForTests
} from '../artifacts/runtime';
import type { ArtifactService } from '../artifacts/artifactService';
import type { IAgentRun } from '../models/AgentRun';
import { Types } from 'mongoose';

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

test('buildAgentContext includes the Create template file contents', () => {
  const templateFiles = createProjectTemplateFiles();
  const context = buildAgentContext({
    ...input,
    mode: 'create',
    files: templateFiles.map(file => ({
      path: file.path,
      content: file.content
    }))
  }, 20_000);

  assert.deepEqual(
    context.files.map(file => file.path),
    [
      'index.html',
      'postcss.config.cjs',
      'src/App.tsx',
      'src/index.css',
      'src/main.tsx',
      'tailwind.config.js',
      'tsconfig.json'
    ]
  );
  assert.equal(
    context.files.find(file => file.path === 'index.html')?.content?.includes('/src/main.tsx'),
    true
  );
});

test('loadAgentContext hydrates edit files through the base artifact', async () => {
  const projectFindOne = Project.findOne;
  const snapshotFindOne = ProjectSnapshot.findOne;
  const realService = getArtifactService();
  const artifactId = 'a'.repeat(32);
  const ids = {
    userId: new Types.ObjectId(),
    workspaceId: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    snapshotId: new Types.ObjectId()
  };
  Project.findOne = (async () => ({
    name: 'Artifact project',
    description: 'Hydrated context',
    settings: { framework: 'react', styling: 'tailwind', uiLibrary: 'none' }
  })) as typeof Project.findOne;
  ProjectSnapshot.findOne = (async () => ({
    artifactId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId
  })) as typeof ProjectSnapshot.findOne;
  setArtifactServiceForTests({
    readOwnedBundle: async (
      request: Parameters<ArtifactService['readOwnedBundle']>[0]
    ) => {
      assert.equal(request.artifactId, artifactId);
      assert.equal(request.workspaceId.toString(), ids.workspaceId.toString());
      assert.equal(request.projectId.toString(), ids.projectId.toString());
      assert.equal(request.kind, 'project_snapshot');
      return {
        version: 1 as const,
        files: [{
          path: 'src/App.tsx',
          content: 'export default function App() { return <main>Artifact</main>; }',
          language: 'tsx' as const
        }],
        packageJson: {
          dependencies: {},
          devDependencies: {},
          scripts: {}
        }
      };
    }
  } as unknown as ArtifactService);

  try {
    const context = await loadAgentContext({
      ...ids,
      _id: new Types.ObjectId(),
      prompt: 'Edit from artifact',
      mode: 'edit',
      baseSnapshotId: ids.snapshotId
    } as unknown as IAgentRun, 20_000);
    assert.equal(
      context.files.find(file => file.path === 'src/App.tsx')?.content,
      'export default function App() { return <main>Artifact</main>; }'
    );
  } finally {
    Project.findOne = projectFindOne;
    ProjectSnapshot.findOne = snapshotFindOne;
    setArtifactServiceForTests(realService);
  }
});
