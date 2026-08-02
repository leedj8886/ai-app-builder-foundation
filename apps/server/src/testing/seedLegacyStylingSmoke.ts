import { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../utils/db';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { Chat } from '../models/Chat';
import { AgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { getArtifactService } from '../artifacts/runtime';
import { ensureMainBranch } from '../branches/branchService';
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';

export const legacyStylingSmoke = {
  email: 'legacy-styling@ai-app-builder.local',
  password: 'legacy-styling-password',
  chatId: '64b7f5086f1f8e9f0f000101'
} as const;

const ids = {
  chat: new Types.ObjectId(legacyStylingSmoke.chatId),
  user: new Types.ObjectId('64b7f5086f1f8e9f0f000102'),
  project: new Types.ObjectId('64b7f5086f1f8e9f0f000103'),
  run: new Types.ObjectId('64b7f5086f1f8e9f0f000104'),
  snapshot: new Types.ObjectId('64b7f5086f1f8e9f0f000105')
} as const;

const packageJson = {
  dependencies: {
    react: '^18.3.1',
    'react-dom': '^18.3.1'
  },
  devDependencies: {
    '@types/react': '^18.3.12',
    '@types/react-dom': '^18.3.1',
    '@vitejs/plugin-react': '^4.3.4',
    autoprefixer: '^10.4.20',
    postcss: '^8.4.49',
    tailwindcss: '^3.4.17',
    typescript: '^5.6.3',
    vite: '^6.0.1'
  },
  scripts: {
    build: 'vite build',
    'type-check': 'tsc --noEmit'
  }
};

export const seedLegacyStylingSmokeData = async (): Promise<void> => {
    await User.create({
      _id: ids.user,
      email: legacyStylingSmoke.email,
      password: legacyStylingSmoke.password,
      name: 'Legacy Styling Smoke'
    });
    const { workspace } = await ensureDefaultWorkspaceForUser(ids.user);
    const project = await Project.create({
      _id: ids.project,
      workspaceId: workspace._id,
      userId: ids.user,
      name: 'Legacy Tailwind Preview',
      settings: {
        framework: 'react',
        styling: 'tailwind',
        uiLibrary: 'none'
      }
    });
    const branch = await ensureMainBranch(project);
    await Chat.create({
      _id: ids.chat,
      userId: ids.user,
      projectId: ids.project,
      branchId: branch._id,
      title: 'Legacy Tailwind Snapshot',
      messages: [
        {
          id: 'legacy-user-message',
          role: 'user',
          content: 'Change the background to light blue'
        },
        {
          id: 'legacy-assistant-message',
          role: 'assistant',
          content: 'Changed the background to light blue'
        }
      ]
    });
    await AgentRun.create({
      _id: ids.run,
      userId: ids.user,
      workspaceId: workspace._id,
      projectId: ids.project,
      branchId: branch._id,
      chatId: ids.chat,
      prompt: 'Change the background to light blue',
      status: 'completed',
      mode: 'edit',
      baseSnapshotRevision: 0,
      baseHeadVersion: 0,
      resultSnapshotId: ids.snapshot,
      attempt: 0,
      maxRepairAttempts: 2,
      model: 'smoke-fixture',
      startedAt: new Date(),
      completedAt: new Date()
    });
    const artifact = await getArtifactService().writeBundle({
      workspaceId: workspace._id,
      projectId: ids.project,
      createdByRunId: ids.run,
      kind: 'project_snapshot',
      idempotencyKey: `legacy-styling-source:${ids.run.toHexString()}`,
      bundle: {
        version: 1,
        files: [
          {
            path: 'index.html',
            language: 'html',
            content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>'
          },
          {
            path: 'src/App.tsx',
            language: 'tsx',
            content:
              'export default function App() { return <main data-testid="tailwind-background" className="min-h-screen bg-blue-100">Generated app</main>; }\n'
          },
          {
            path: 'src/index.css',
            language: 'css',
            content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n'
          },
          {
            path: 'src/main.tsx',
            language: 'tsx',
            content:
              "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\ncreateRoot(document.getElementById('root')!).render(<App />);\n"
          },
          {
            path: 'tsconfig.json',
            language: 'json',
            content: JSON.stringify({
              compilerOptions: {
                jsx: 'react-jsx',
                module: 'ESNext',
                moduleResolution: 'Bundler',
                target: 'ES2020'
              },
              include: ['src']
            }, null, 2)
          }
        ],
        packageJson
      }
    });
    await ProjectSnapshot.create({
      _id: ids.snapshot,
      workspaceId: workspace._id,
      branchId: branch._id,
      userId: ids.user,
      projectId: ids.project,
      sourceRunId: ids.run,
      artifactId: artifact.artifactId,
      validation: {
        status: 'passed',
        verification: 'verified',
        checks: []
      },
      summary: 'Legacy Snapshot without persisted Tailwind configuration'
    });
    await Promise.all([
      Project.updateOne(
        { _id: ids.project },
        {
          $set: {
            activeSnapshotId: ids.snapshot,
            activeSnapshotRevision: 1
          },
          $addToSet: { chatIds: ids.chat }
        }
      ),
      branch.updateOne({
        $set: {
          headSnapshotId: ids.snapshot,
          headVersion: 1
        }
      })
    ]);
    await AgentEvent.create({
      runId: ids.run,
      userId: ids.user,
      projectId: ids.project,
      type: 'run.completed',
      sequence: 1,
      message: 'Agent run completed',
      payload: { snapshotId: ids.snapshot.toHexString() }
    });
    console.log(JSON.stringify({ seeded: true }));
};

const seed = async (): Promise<void> => {
  if (process.env.SMOKE_LEGACY_STYLING_SEED !== 'true') {
    throw new Error(
      'Refusing to seed without SMOKE_LEGACY_STYLING_SEED=true'
    );
  }

  await connectDB();
  try {
    await seedLegacyStylingSmokeData();
  } finally {
    await disconnectDB();
  }
};

if (require.main === module) {
  void seed().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
