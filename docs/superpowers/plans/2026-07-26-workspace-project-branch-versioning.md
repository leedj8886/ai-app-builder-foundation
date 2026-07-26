# Workspace and Project Branch Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the Workspace permission boundary and ProjectBranch version line so every Chat and AgentRun resolves an explicit Branch Head, concurrent writes are serialized per Branch, and stale Runs can never silently overwrite a newer Snapshot.

**Architecture:** Add Workspace, WorkspaceMember, ProjectBranch, and BranchExecutionLease as focused Mongoose models. Keep the existing single-organization owner checks, add Workspace membership as a second authorization condition, and route all new Runs through the Chat's Branch or the Project's `main` Branch. Use a persistent Branch lease plus BullMQ `moveToDelayed` for per-Branch serialization, then use `headVersion` compare-and-set as the final correctness guard.

**Tech Stack:** TypeScript, Express, Mongoose/MongoDB, BullMQ 5.81, Redis, Node test runner, Supertest, Testcontainers, React TypeScript.

---

## Scope and Safe Rollout

This plan implements only the first execution slice of the approved Daytona architecture:

- Workspace and membership persistence.
- ProjectBranch and Chat-to-Branch association.
- AgentRun Branch baseline fields.
- One active write Run per Branch.
- Branch Head compare-and-set and conflict completion.
- Migration of current documents into one default Workspace and one `main` Branch per Project.
- Backward-compatible frontend treatment of conflict completion.

It does not implement ArtifactStore, SandboxProvider, SandboxLease, quotas, Daytona, PreviewDeployment, or Preview Gateway.

Use an expand/backfill/enforce rollout:

1. Add new schema paths without making legacy documents unreadable.
2. Make every new write populate the new paths.
3. Run the idempotent migration with API and Worker stopped.
4. Run the migration verification command.
5. Start the new API and Worker.

Do not remove `Project.activeSnapshotId` or `Project.activeSnapshotRevision` in this plan. They remain a temporary compatibility mirror for the existing snapshot UI. AgentRun correctness must use `ProjectBranch.headSnapshotId` and `headVersion`.

## File Map

### New domain files

- `apps/server/src/models/Workspace.ts` — Workspace state and execution-limit defaults.
- `apps/server/src/models/WorkspaceMember.ts` — unique User membership and role.
- `apps/server/src/models/ProjectBranch.ts` — named Project version line and Head.
- `apps/server/src/models/BranchExecutionLease.ts` — one active write Run per Branch.
- `apps/server/src/workspaces/defaultWorkspace.ts` — idempotent default Workspace membership.
- `apps/server/src/workspaces/projectAccess.ts` — owner plus Workspace-member access checks.
- `apps/server/src/branches/branchService.ts` — main Branch creation, Branch resolution, Branch creation, rollback, and CAS.
- `apps/server/src/branches/branchExecution.ts` — Branch lease acquisition, heartbeat, assertion, and release.
- `apps/server/src/migrations/20260726WorkspaceBranches.ts` — idempotent backfill.
- `apps/server/src/migrations/20260726WorkspaceBranches.integration.ts` — migration verification.
- `apps/server/src/migrate.ts` — migration CLI entry point.

### Existing backend files

- `apps/server/src/models/Project.ts` — add `workspaceId`; retain compatibility Snapshot fields.
- `apps/server/src/models/Chat.ts` — add `branchId`.
- `apps/server/src/models/AgentRun.ts` — add Workspace/Branch baseline fields.
- `apps/server/src/agent/types.ts` — add waiting and conflict statuses.
- `apps/server/src/agent/stateMachine.ts` — allow scheduler and conflict transitions.
- `apps/server/src/agent/createWorker.ts` — delay a Job when its Branch lease is busy.
- `apps/server/src/agent/orchestrator.ts` — assert lease ownership and commit Branch Head.
- `apps/server/src/agent/contextBuilder.ts` — enforce Run/Project/Chat Branch consistency.
- `apps/server/src/routes/auth.ts` — attach newly registered users to the default Workspace.
- `apps/server/src/routes/project.ts` — Workspace-aware Project access and Branch endpoints.
- `apps/server/src/routes/chat.ts` — create and return Branch-associated Chats.
- `apps/server/src/routes/agent.ts` — derive Run baseline from Branch Head.
- `apps/server/src/chat/chatList.ts` — return `branchId`.
- `apps/server/src/agent/models.test.ts` — schema and index coverage.
- `apps/server/src/agent/stateMachine.test.ts` — waiting/conflict transition coverage.
- `apps/server/src/agent/createWorker.test.ts` — Branch-busy delayed Job coverage.
- `apps/server/src/integration/agentRoutes.integration.ts` — Workspace, Branch, Chat, Run, and rollback behavior.
- `apps/server/src/integration/agentWorker.integration.ts` — Branch serialization and CAS behavior.
- `apps/server/package.json` — migration commands.
- `README.md` — maintenance-window migration procedure.

### Existing frontend files

- `apps/web/src/services/api.ts` — Workspace/Branch IDs and new statuses.
- `apps/web/src/lib/v0Workspace.ts` — treat conflict completion as a ready Snapshot with a warning.
- `apps/web/src/lib/v0Workspace.test.ts` — conflict completion behavior.
- `apps/web/src/lib/chatTimeline.ts` — terminal and collapsed conflict behavior.
- `apps/web/src/lib/chatTimeline.test.ts` — timeline conflict behavior.
- `apps/web/src/pages/V0Clone.tsx` — refresh timeline for both successful terminal statuses.

## Task 1: Add Workspace and Branch Domain Schemas

**Files:**

- Create: `apps/server/src/models/Workspace.ts`
- Create: `apps/server/src/models/WorkspaceMember.ts`
- Create: `apps/server/src/models/ProjectBranch.ts`
- Create: `apps/server/src/models/BranchExecutionLease.ts`
- Modify: `apps/server/src/models/Project.ts`
- Modify: `apps/server/src/models/Chat.ts`
- Modify: `apps/server/src/models/AgentRun.ts`
- Modify: `apps/server/src/agent/types.ts`
- Modify: `apps/server/src/agent/models.test.ts`
- Modify: `apps/server/src/agent/stateMachine.ts`
- Modify: `apps/server/src/agent/stateMachine.test.ts`

- [ ] **Step 1: Write failing schema and status tests**

Add these imports and assertions to `apps/server/src/agent/models.test.ts`:

```ts
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import { ProjectBranch } from '../models/ProjectBranch';
import { BranchExecutionLease } from '../models/BranchExecutionLease';
import { Chat } from '../models/Chat';

test('Workspace models expose membership and execution boundaries', () => {
  assert.ok(Workspace.schema.path('slug'));
  assert.ok(Workspace.schema.path('createdByUserId'));
  assert.ok(Workspace.schema.path('executionLimits.maxConcurrentBuilds'));
  assert.ok(WorkspaceMember.schema.path('workspaceId'));
  assert.ok(WorkspaceMember.schema.path('userId'));
  assert.ok(WorkspaceMember.schema.path('role'));

  assert.deepEqual(
    WorkspaceMember.schema.indexes().map(([fields]) => fields),
    [
      { workspaceId: 1, userId: 1 },
      { userId: 1, workspaceId: 1 }
    ]
  );
});

test('ProjectBranch stores one version head per named branch', () => {
  assert.ok(ProjectBranch.schema.path('workspaceId'));
  assert.ok(ProjectBranch.schema.path('projectId'));
  assert.ok(ProjectBranch.schema.path('headSnapshotId'));
  assert.ok(ProjectBranch.schema.path('headVersion'));

  assert.deepEqual(
    ProjectBranch.schema.indexes().map(([fields]) => fields),
    [
      { projectId: 1, name: 1 },
      { workspaceId: 1, projectId: 1, updatedAt: -1 }
    ]
  );
});

test('BranchExecutionLease allows only one active writer per Branch', () => {
  assert.ok(BranchExecutionLease.schema.path('branchId'));
  assert.ok(BranchExecutionLease.schema.path('runId'));
  assert.ok(BranchExecutionLease.schema.path('expiresAt'));

  assert.deepEqual(
    BranchExecutionLease.schema.indexes().map(([fields]) => fields),
    [
      { branchId: 1 },
      { expiresAt: 1 }
    ]
  );
});

test('Project Chat and AgentRun expose Workspace and Branch references', () => {
  assert.ok(Project.schema.path('workspaceId'));
  assert.ok(Chat.schema.path('branchId'));
  assert.ok(AgentRun.schema.path('workspaceId'));
  assert.ok(AgentRun.schema.path('branchId'));
  assert.ok(AgentRun.schema.path('baseHeadVersion'));
});
```

Add these cases to `apps/server/src/agent/stateMachine.test.ts`:

```ts
test('waiting Runs can return to queued when their Branch becomes available', () => {
  assert.doesNotThrow(
    () => assertAgentRunTransition('waiting_for_capacity', 'queued')
  );
});

test('persisting Runs may complete with a Branch conflict', () => {
  assert.doesNotThrow(
    () => assertAgentRunTransition('persisting', 'completed_with_conflict')
  );
  assert.equal(
    isTerminalAgentRunStatus('completed_with_conflict'),
    true
  );
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
node --import tsx --test \
  apps/server/src/agent/models.test.ts \
  apps/server/src/agent/stateMachine.test.ts
```

Expected: FAIL because the four models and the two statuses do not exist.

- [ ] **Step 3: Create the Workspace models**

Create `apps/server/src/models/Workspace.ts`:

```ts
import mongoose, { Schema, Types } from 'mongoose';

export interface WorkspaceExecutionLimits {
  maxConcurrentBuilds: number;
  maxRunningPreviews: number;
  maxCpu: number;
  maxMemoryMiB: number;
  maxDiskMiB: number;
  maxBuildsPerHour: number;
  maxBuildMinutesPerDay: number;
  maxArtifactBytes: number;
  maxLogBytesPerCommand: number;
  maxFilesPerSnapshot: number;
}

export interface IWorkspace {
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  createdByUserId: Types.ObjectId;
  executionLimits: WorkspaceExecutionLimits;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>({
  slug: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    required: true,
    default: 'active'
  },
  createdByUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  executionLimits: {
    maxConcurrentBuilds: { type: Number, required: true, default: 8 },
    maxRunningPreviews: { type: Number, required: true, default: 12 },
    maxCpu: { type: Number, required: true, default: 32 },
    maxMemoryMiB: { type: Number, required: true, default: 65_536 },
    maxDiskMiB: { type: Number, required: true, default: 131_072 },
    maxBuildsPerHour: { type: Number, required: true, default: 100 },
    maxBuildMinutesPerDay: { type: Number, required: true, default: 1_000 },
    maxArtifactBytes: {
      type: Number,
      required: true,
      default: 50 * 1024 * 1024 * 1024
    },
    maxLogBytesPerCommand: {
      type: Number,
      required: true,
      default: 5 * 1024 * 1024
    },
    maxFilesPerSnapshot: { type: Number, required: true, default: 5_000 }
  }
}, { timestamps: true });

export const Workspace =
  (mongoose.models.Workspace as mongoose.Model<IWorkspace> | undefined) ||
  mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);
```

Create `apps/server/src/models/WorkspaceMember.ts`:

```ts
import mongoose, { Schema, Types } from 'mongoose';

export interface IWorkspaceMember {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMemberSchema = new Schema<IWorkspaceMember>({
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'member'],
    required: true
  }
}, { timestamps: true });

WorkspaceMemberSchema.index(
  { workspaceId: 1, userId: 1 },
  { unique: true }
);
WorkspaceMemberSchema.index({ userId: 1, workspaceId: 1 });

export const WorkspaceMember =
  (mongoose.models.WorkspaceMember as
    mongoose.Model<IWorkspaceMember> | undefined) ||
  mongoose.model<IWorkspaceMember>(
    'WorkspaceMember',
    WorkspaceMemberSchema
  );
```

- [ ] **Step 4: Create the Branch models**

Create `apps/server/src/models/ProjectBranch.ts`:

```ts
import mongoose, { Schema, Types } from 'mongoose';

export interface IProjectBranch {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  status: 'active' | 'archived';
  headSnapshotId?: Types.ObjectId;
  headVersion: number;
  createdFromSnapshotId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectBranchSchema = new Schema<IProjectBranch>({
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true
  },
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  name: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['active', 'archived'],
    required: true,
    default: 'active'
  },
  headSnapshotId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectSnapshot'
  },
  headVersion: { type: Number, required: true, default: 0 },
  createdFromSnapshotId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectSnapshot'
  }
}, { timestamps: true });

ProjectBranchSchema.index(
  { projectId: 1, name: 1 },
  { unique: true }
);
ProjectBranchSchema.index({
  workspaceId: 1,
  projectId: 1,
  updatedAt: -1
});

export const ProjectBranch =
  (mongoose.models.ProjectBranch as
    mongoose.Model<IProjectBranch> | undefined) ||
  mongoose.model<IProjectBranch>('ProjectBranch', ProjectBranchSchema);
```

Create `apps/server/src/models/BranchExecutionLease.ts`:

```ts
import mongoose, { Schema, Types } from 'mongoose';

export interface IBranchExecutionLease {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  branchId: Types.ObjectId;
  runId: Types.ObjectId;
  baseHeadVersion: number;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
}

const BranchExecutionLeaseSchema =
  new Schema<IBranchExecutionLease>({
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectBranch',
      required: true
    },
    runId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentRun',
      required: true
    },
    baseHeadVersion: { type: Number, required: true },
    acquiredAt: { type: Date, required: true },
    heartbeatAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true }
  }, { timestamps: false });

BranchExecutionLeaseSchema.index({ branchId: 1 }, { unique: true });
BranchExecutionLeaseSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export const BranchExecutionLease =
  (mongoose.models.BranchExecutionLease as
    mongoose.Model<IBranchExecutionLease> | undefined) ||
  mongoose.model<IBranchExecutionLease>(
    'BranchExecutionLease',
    BranchExecutionLeaseSchema
  );
```

- [ ] **Step 5: Expand existing schemas and statuses**

Add optional `workspaceId` to `IProject` and `ProjectSchema` in `apps/server/src/models/Project.ts`:

```ts
workspaceId?: mongoose.Types.ObjectId;
```

```ts
workspaceId: {
  type: Schema.Types.ObjectId,
  ref: 'Workspace'
},
```

Replace the Project index with:

```ts
ProjectSchema.index({ userId: 1, workspaceId: 1, updatedAt: -1 });
```

Update the existing Project index assertion in `models.test.ts` to expect the
new compound index instead of `{ userId: 1, updatedAt: -1 }`.

Add optional `branchId` to `IChat` and `ChatSchema` in `apps/server/src/models/Chat.ts`:

```ts
branchId?: mongoose.Types.ObjectId;
```

```ts
branchId: {
  type: Schema.Types.ObjectId,
  ref: 'ProjectBranch'
},
```

Add:

```ts
ChatSchema.index({ projectId: 1, branchId: 1, updatedAt: -1 });
```

Add optional expand-phase fields to `IAgentRun` and `AgentRunSchema`:

```ts
workspaceId?: Types.ObjectId;
branchId?: Types.ObjectId;
baseHeadVersion?: number;
```

```ts
workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
branchId: { type: Schema.Types.ObjectId, ref: 'ProjectBranch' },
baseHeadVersion: { type: Number },
```

Add the Branch index:

```ts
AgentRunSchema.index({ branchId: 1, createdAt: 1 });
```

Update `agentRunStatuses` and terminal statuses in `apps/server/src/agent/types.ts`:

```ts
export const agentRunStatuses = [
  'waiting_for_capacity',
  'queued',
  'running',
  'planning',
  'generating',
  'validating',
  'repairing',
  'persisting',
  'completed',
  'completed_with_conflict',
  'failed',
  'cancelled'
] as const;

export const terminalAgentRunStatuses = [
  'completed',
  'completed_with_conflict',
  'failed',
  'cancelled'
] as const;
```

Update `allowedTransitions` in `apps/server/src/agent/stateMachine.ts`:

```ts
const allowedTransitions: Record<AgentRunStatus, AgentRunStatus[]> = {
  waiting_for_capacity: ['queued', 'cancelled'],
  queued: ['waiting_for_capacity', 'running', 'cancelled'],
  running: ['planning', 'validating', 'cancelled', 'failed'],
  planning: ['generating', 'cancelled', 'failed'],
  generating: ['validating', 'cancelled', 'failed'],
  validating: ['repairing', 'persisting', 'failed', 'cancelled'],
  repairing: ['generating', 'failed', 'cancelled'],
  persisting: ['completed', 'completed_with_conflict', 'failed'],
  completed: [],
  completed_with_conflict: [],
  failed: [],
  cancelled: []
};
```

- [ ] **Step 6: Run unit tests and type-check**

Run:

```bash
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: all server unit tests pass and TypeScript exits with code 0.

- [ ] **Step 7: Commit the domain expansion**

```bash
git add \
  apps/server/src/models/Workspace.ts \
  apps/server/src/models/WorkspaceMember.ts \
  apps/server/src/models/ProjectBranch.ts \
  apps/server/src/models/BranchExecutionLease.ts \
  apps/server/src/models/Project.ts \
  apps/server/src/models/Chat.ts \
  apps/server/src/models/AgentRun.ts \
  apps/server/src/agent/types.ts \
  apps/server/src/agent/models.test.ts \
  apps/server/src/agent/stateMachine.ts \
  apps/server/src/agent/stateMachine.test.ts
git commit -m "feat: add workspace and project branch models"
```

## Task 2: Bootstrap the Default Workspace and Enforce Project Access

**Files:**

- Create: `apps/server/src/workspaces/defaultWorkspace.ts`
- Create: `apps/server/src/workspaces/projectAccess.ts`
- Create: `apps/server/src/integration/workspaceAccess.integration.ts`
- Modify: `apps/server/src/routes/auth.ts`
- Modify: `apps/server/src/routes/project.ts`

- [ ] **Step 1: Write failing Workspace integration tests**

Create `apps/server/src/integration/workspaceAccess.integration.ts`:

```ts
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app';
import { generateToken } from '../middleware/auth';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';

let environment: IntegrationEnvironment;
const app = createApp();

before(async () => {
  environment = await createIntegrationEnvironment();
});

beforeEach(async () => {
  await environment.reset();
});

after(async () => {
  await environment.close();
});

test('registration creates one default Workspace and an owner membership', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'owner@example.test',
      password: 'password',
      name: 'Owner'
    })
    .expect(201);

  const [workspace, membership] = await Promise.all([
    Workspace.findOne({ slug: 'default' }),
    WorkspaceMember.findOne({ userId: response.body.user.id })
  ]);

  assert.ok(workspace);
  assert.equal(membership?.workspaceId.toString(), workspace._id.toString());
  assert.equal(membership?.role, 'owner');
});

test('later users join the same default Workspace as members', async () => {
  for (const email of ['owner@example.test', 'member@example.test']) {
    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'password', name: 'User' })
      .expect(201);
  }

  assert.equal(await Workspace.countDocuments({ slug: 'default' }), 1);
  assert.deepEqual(
    (await WorkspaceMember.find().sort({ createdAt: 1 }))
      .map(member => member.role),
    ['owner', 'member']
  );
});

test('new Projects carry the authenticated users Workspace', async () => {
  const user = await User.create({
    email: 'project-owner@example.test',
    password: 'password',
    name: 'Owner'
  });
  const token = generateToken(user._id.toString());

  const response = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Workspace project' })
    .expect(201);

  const membership = await WorkspaceMember.findOne({ userId: user._id });
  assert.ok(membership);
  assert.equal(
    response.body.project.workspaceId,
    membership.workspaceId.toString()
  );
});

test('Project access requires both ownership and active membership', async () => {
  const user = await User.create({
    email: 'removed@example.test',
    password: 'password',
    name: 'Removed'
  });
  const token = generateToken(user._id.toString());
  const created = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Private project' })
    .expect(201);

  await WorkspaceMember.deleteOne({ userId: user._id });

  await request(app)
    .get(`/api/projects/${created.body.project._id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(404);
});
```

- [ ] **Step 2: Run the integration file and confirm failure**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/workspaceAccess.integration.ts
```

Expected: FAIL because registration and Project creation do not create Workspace membership.

- [ ] **Step 3: Implement idempotent default Workspace membership**

Create `apps/server/src/workspaces/defaultWorkspace.ts`:

```ts
import { Types } from 'mongoose';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';

export const DEFAULT_WORKSPACE_SLUG = 'default';

export const ensureDefaultWorkspaceForUser = async (
  userId: Types.ObjectId
) => {
  const workspace = await Workspace.findOneAndUpdate(
    { slug: DEFAULT_WORKSPACE_SLUG },
    {
      $setOnInsert: {
        slug: DEFAULT_WORKSPACE_SLUG,
        name: 'Default Workspace',
        status: 'active',
        createdByUserId: userId
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );

  const role = workspace.createdByUserId.equals(userId)
    ? 'owner'
    : 'member';
  const membership = await WorkspaceMember.findOneAndUpdate(
    { workspaceId: workspace._id, userId },
    { $setOnInsert: { role } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return { workspace, membership };
};
```

Create `apps/server/src/workspaces/projectAccess.ts`:

```ts
import { Types } from 'mongoose';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { WorkspaceMember } from '../models/WorkspaceMember';

interface OwnedProjectInput {
  projectId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
}

export const findOwnedWorkspaceProject = async (
  input: OwnedProjectInput
) => {
  const project = await Project.findOne({
    _id: input.projectId,
    userId: input.userId
  });
  if (!project?.workspaceId) return null;

  const membership = await WorkspaceMember.exists({
    workspaceId: project.workspaceId,
    userId: input.userId
  });

  return membership ? project : null;
};

export const workspaceIdsForUser = async (
  userId: string | Types.ObjectId
): Promise<Types.ObjectId[]> => WorkspaceMember.distinct(
  'workspaceId',
  { userId }
);

export const ownedProjectIdsForUser = async (
  userId: string | Types.ObjectId
): Promise<Types.ObjectId[]> => {
  const workspaceIds = await workspaceIdsForUser(userId);
  return Project.distinct('_id', {
    userId,
    workspaceId: { $in: workspaceIds }
  });
};

export const findOwnedWorkspaceChat = async (input: {
  chatId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
}) => {
  const chat = await Chat.findOne({
    _id: input.chatId,
    userId: input.userId
  });
  if (!chat?.projectId) return chat;
  const project = await findOwnedWorkspaceProject({
    projectId: chat.projectId,
    userId: input.userId
  });
  return project ? chat : null;
};
```

- [ ] **Step 4: Wire registration and Project creation**

In `apps/server/src/routes/auth.ts`, import and call the helper immediately after `user.save()`:

```ts
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';
```

```ts
await user.save();
await ensureDefaultWorkspaceForUser(user._id);
```

In `apps/server/src/routes/project.ts`, import:

```ts
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';
import {
  findOwnedWorkspaceProject,
  workspaceIdsForUser
} from '../workspaces/projectAccess';
```

For Project listing, use:

```ts
const workspaceIds = await workspaceIdsForUser(req.userId!);
const projects = await Project.find({
  userId: req.userId,
  workspaceId: { $in: workspaceIds }
})
  .sort({ updatedAt: -1 })
  .populate('chatIds', 'title updatedAt');
```

For Project creation, obtain the Workspace before constructing the Project:

```ts
const { workspace } = await ensureDefaultWorkspaceForUser(req.user!._id);
const project = new Project({
  workspaceId: workspace._id,
  userId: req.userId,
  name,
  description,
  settings: {
    framework: settings?.framework || 'react',
    styling: settings?.styling || 'tailwind',
    uiLibrary: settings?.uiLibrary || 'shadcn'
  },
  chatIds: []
});
```

Replace owner-only Project lookups in this route with:

```ts
const project = await findOwnedWorkspaceProject({
  projectId: req.params.id,
  userId: req.userId!
});
```

For `findOneAndUpdate` or delete operations, first resolve access with the helper, then mutate by the resolved `_id`.

- [ ] **Step 5: Run Workspace integration and server regression tests**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/workspaceAccess.integration.ts
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: Workspace integration and all server unit tests pass.

- [ ] **Step 6: Commit Workspace bootstrapping**

```bash
git add \
  apps/server/src/workspaces/defaultWorkspace.ts \
  apps/server/src/workspaces/projectAccess.ts \
  apps/server/src/integration/workspaceAccess.integration.ts \
  apps/server/src/routes/auth.ts \
  apps/server/src/routes/project.ts
git commit -m "feat: bootstrap workspace membership"
```

## Task 3: Create and Route Project Branches

**Files:**

- Create: `apps/server/src/branches/branchService.ts`
- Modify: `apps/server/src/routes/project.ts`
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/chat/chatList.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`

- [ ] **Step 1: Add failing Branch and Chat integration cases**

Update the shared fixtures in `apps/server/src/integration/agentRoutes.integration.ts` to create a default Workspace and store `workspaceId` on Projects. Then add:

```ts
test('Project creation creates one main Branch', async () => {
  const user = await User.create({
    email: 'branch-owner@example.test',
    password: 'password',
    name: 'Branch owner'
  });
  const token = generateToken(user._id.toString());

  const response = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Branched project' })
    .expect(201);

  const branches = await ProjectBranch.find({
    projectId: response.body.project._id
  });
  assert.equal(branches.length, 1);
  assert.equal(branches[0]?.name, 'main');
  assert.equal(branches[0]?.headVersion, 0);
});

test('Chat creation binds to main or an explicitly selected Branch', async () => {
  const { ownerToken, project } = await fixtures();
  const main = await ensureMainBranch(project);
  const feature = await ProjectBranch.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    name: 'feature',
    headVersion: 0
  });

  const first = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ projectId: project._id, titleSeed: 'Main chat' })
    .expect(201);
  const second = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id,
      branchId: feature._id,
      titleSeed: 'Feature chat'
    })
    .expect(201);

  assert.equal(first.body.chat.branchId, main._id.toString());
  assert.equal(second.body.chat.branchId, feature._id.toString());
});

test('Branch creation can start from a validated Snapshot', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const sourceRun = await createRun(owner._id, project._id);
  const snapshot = await ProjectSnapshot.create({
    userId: owner._id,
    projectId: project._id,
    sourceRunId: sourceRun._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Branch point'
  });

  const response = await request(app)
    .post(`/api/projects/${project._id}/branches`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'experiment', fromSnapshotId: snapshot._id })
    .expect(201);

  assert.equal(response.body.branch.name, 'experiment');
  assert.equal(
    response.body.branch.headSnapshotId,
    snapshot._id.toString()
  );
  assert.equal(response.body.branch.headVersion, 0);
});
```

Add the imports:

```ts
import { ProjectBranch } from '../models/ProjectBranch';
import { ensureMainBranch } from '../branches/branchService';
```

As part of the fixture update, give every directly created Project-associated
Chat in this integration file the appropriate `branchId`. Leave only the test
fixtures that intentionally represent standalone legacy Chats without one.

- [ ] **Step 2: Run the new cases and confirm failure**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern="main Branch|binds to main|start from a validated" \
  apps/server/src/integration/agentRoutes.integration.ts
```

Expected: FAIL because Branch services and endpoints do not exist.

- [ ] **Step 3: Implement Branch creation and resolution**

Create `apps/server/src/branches/branchService.ts`:

```ts
import { Types } from 'mongoose';
import type { IProject } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import { ProjectSnapshot } from '../models/ProjectSnapshot';

export const MAIN_BRANCH_NAME = 'main';

export const ensureMainBranch = async (
  project: IProject
) => {
  if (!project.workspaceId) {
    throw new Error('Project is missing workspaceId');
  }

  return ProjectBranch.findOneAndUpdate(
    { projectId: project._id, name: MAIN_BRANCH_NAME },
    {
      $setOnInsert: {
        workspaceId: project.workspaceId,
        projectId: project._id,
        name: MAIN_BRANCH_NAME,
        status: 'active',
        headSnapshotId: project.activeSnapshotId,
        headVersion: project.activeSnapshotRevision ?? 0,
        createdFromSnapshotId: project.activeSnapshotId
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

export const resolveProjectBranch = async (input: {
  project: IProject;
  branchId?: string | Types.ObjectId;
}) => input.branchId
  ? ProjectBranch.findOne({
      _id: input.branchId,
      workspaceId: input.project.workspaceId,
      projectId: input.project._id,
      status: 'active'
    })
  : ensureMainBranch(input.project);

export const createProjectBranch = async (input: {
  project: IProject;
  name: string;
  fromSnapshotId?: string | Types.ObjectId;
}) => {
  const main = input.fromSnapshotId
    ? null
    : await ensureMainBranch(input.project);
  const sourceSnapshotId = input.fromSnapshotId ?? main?.headSnapshotId;
  const snapshot = sourceSnapshotId
    ? await ProjectSnapshot.findOne({
        _id: sourceSnapshotId,
        projectId: input.project._id,
        userId: input.project.userId,
        'validation.status': { $ne: 'failed' }
      })
    : null;

  if (sourceSnapshotId && !snapshot) {
    throw Object.assign(new Error('Snapshot not found'), {
      statusCode: 404
    });
  }

  return ProjectBranch.create({
    workspaceId: input.project.workspaceId,
    projectId: input.project._id,
    name: input.name,
    status: 'active',
    headSnapshotId: snapshot?._id,
    headVersion: 0,
    createdFromSnapshotId: snapshot?._id
  });
};

export const setBranchHead = async (input: {
  branchId: Types.ObjectId;
  expectedHeadVersion: number;
  snapshotId: Types.ObjectId;
}) => ProjectBranch.findOneAndUpdate(
  {
    _id: input.branchId,
    status: 'active',
    headVersion: input.expectedHeadVersion
  },
  {
    $set: { headSnapshotId: input.snapshotId },
    $inc: { headVersion: 1 }
  },
  { new: true }
);
```

- [ ] **Step 4: Add Project Branch endpoints**

In `apps/server/src/routes/project.ts`, add imports:

```ts
import {
  createProjectBranch,
  ensureMainBranch,
  resolveProjectBranch,
  setBranchHead
} from '../branches/branchService';
import { ProjectBranch } from '../models/ProjectBranch';
```

After saving a new Project:

```ts
await project.save();
await ensureMainBranch(project);
```

Add these routes before the generic update/delete routes:

```ts
router.get('/:id/branches', async (req: AuthRequest, res, next) => {
  try {
    const project = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await ensureMainBranch(project);
    const branches = await ProjectBranch.find({
      workspaceId: project.workspaceId,
      projectId: project._id
    }).sort({ createdAt: 1 });
    res.json({ branches });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/branches', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1).max(80),
      fromSnapshotId: objectIdParamSchema('fromSnapshotId')
        .shape.fromSnapshotId.optional()
    }).parse(req.body);
    const project = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const branch = await createProjectBranch({
      project,
      name: body.name,
      fromSnapshotId: body.fromSnapshotId
    });
    res.status(201).json({ branch });
  } catch (error) {
    next(error);
  }
});
```

Update snapshot listing and rollback to resolve an optional `branchId` from the query/body, defaulting to `main`. `isActive` must compare with `branch.headSnapshotId`. Rollback must call `setBranchHead()` with the Branch's current `headVersion` and return 409 if the CAS loses:

```ts
const branch = await resolveProjectBranch({
  project,
  branchId: typeof req.body?.branchId === 'string'
    ? req.body.branchId
    : undefined
});
if (!branch) {
  res.status(404).json({ error: 'Branch not found' });
  return;
}
const updated = await setBranchHead({
  branchId: branch._id,
  expectedHeadVersion: branch.headVersion,
  snapshotId: snapshot._id
});
if (!updated) {
  res.status(409).json({ error: 'Branch head changed; reload and retry' });
  return;
}
```

Continue mirroring main-Branch rollback into `Project.activeSnapshotId` and `activeSnapshotRevision` until the frontend no longer depends on those fields.

- [ ] **Step 5: Bind Chat creation to a Branch**

In `apps/server/src/routes/chat.ts`, parse optional `branchId`:

```ts
const { projectId, branchId, titleSeed } = z.object({
  projectId: objectIdStringSchema,
  branchId: objectIdStringSchema.optional(),
  titleSeed: z.string().trim().min(1)
}).parse(req.body);
```

Resolve the Project through `findOwnedWorkspaceProject`, then:

```ts
const branch = await resolveProjectBranch({ project, branchId });
if (!branch) {
  res.status(404).json({ error: 'Branch not found' });
  return;
}

const chat = await Chat.create({
  userId: req.userId,
  projectId,
  branchId: branch._id,
  title: toChatTitle(titleSeed),
  messages: []
});
```

Use `ownedProjectIdsForUser()` for Chat listing and
`findOwnedWorkspaceChat()` for single-Chat, timeline, message, title, and
delete operations. Standalone legacy Chats remain owner-readable; a
Project-associated Chat becomes inaccessible as soon as Workspace membership
is removed.

Select and return `branchId` in list/timeline responses. Extend `ChatListSource`, `ChatListItem`, and `projectChatListItem()` in `apps/server/src/chat/chatList.ts`:

```ts
branchId?: { toString(): string } | string;
```

```ts
...(chat.branchId ? { branchId: chat.branchId.toString() } : {}),
```

When attaching an existing Chat through `POST /api/projects/:id/chats`, set its Branch to the Project's main Branch if it has no `branchId`.

- [ ] **Step 6: Run Branch route integration**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentRoutes.integration.ts
npm run type-check --workspace @v0/server
```

Expected: Project creation, Branch creation, Chat binding, rollback, ownership, and prior route tests pass.

- [ ] **Step 7: Commit Branch routing**

```bash
git add \
  apps/server/src/branches/branchService.ts \
  apps/server/src/routes/project.ts \
  apps/server/src/routes/chat.ts \
  apps/server/src/chat/chatList.ts \
  apps/server/src/integration/agentRoutes.integration.ts
git commit -m "feat: route chats through project branches"
```

## Task 4: Derive AgentRun Baselines from Branch Head

**Files:**

- Modify: `apps/server/src/routes/agent.ts`
- Modify: `apps/server/src/agent/contextBuilder.ts`
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/agent/schemas.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`

- [ ] **Step 1: Add failing Run baseline tests**

Add to `apps/server/src/integration/agentRoutes.integration.ts`:

```ts
test('Chat-associated Run captures its Branch Head baseline', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const sourceRun = await createRun(owner._id, project._id);
  const snapshot = await ProjectSnapshot.create({
    userId: owner._id,
    projectId: project._id,
    sourceRunId: sourceRun._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Feature base'
  });
  const branch = await ProjectBranch.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    name: 'feature',
    headSnapshotId: snapshot._id,
    headVersion: 7
  });
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    branchId: branch._id,
    title: 'Feature chat',
    messages: []
  });

  const response = await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id,
      chatId: chat._id,
      prompt: 'Continue the feature',
      mode: 'edit'
    })
    .expect(201);

  assert.equal(response.body.run.workspaceId, project.workspaceId.toString());
  assert.equal(response.body.run.branchId, branch._id.toString());
  assert.equal(response.body.run.baseSnapshotId, snapshot._id.toString());
  assert.equal(response.body.run.baseHeadVersion, 7);
});

test('Run creation rejects a Chat whose Branch is not in the Project', async () => {
  const { ownerToken, owner, project, otherProject } = await fixtures();
  const otherBranch = await ensureMainBranch(otherProject);
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    branchId: otherBranch._id,
    title: 'Invalid branch chat',
    messages: []
  });

  await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id,
      chatId: chat._id,
      prompt: 'Do not run'
    })
    .expect(404);
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern="captures its Branch Head|Branch is not in" \
  apps/server/src/integration/agentRoutes.integration.ts
```

Expected: FAIL because Run creation still uses Project.activeSnapshot.

- [ ] **Step 3: Resolve Branch before creating the Run**

In `apps/server/src/routes/agent.ts`, replace owner-only Project lookup with `findOwnedWorkspaceProject`. Load a Chat only when all of these match:

```ts
const chat = body.chatId
  ? await Chat.findOne({
      _id: body.chatId,
      userId,
      projectId: body.projectId
    })
  : null;
```

Resolve the Branch:

```ts
const branch = await resolveProjectBranch({
  project,
  branchId: chat?.branchId
});
if (!branch || (chat?.branchId && !branch._id.equals(chat.branchId))) {
  res.status(404).json({ error: 'Chat branch not found' });
  return;
}
```

Load only the Branch Head Snapshot:

```ts
const baseSnapshot = branch.headSnapshotId
  ? await ProjectSnapshot.findOne({
      _id: branch.headSnapshotId,
      projectId: project._id,
      userId,
      'validation.status': { $ne: 'failed' }
    })
  : null;
```

Create the Run with:

```ts
workspaceId: project.workspaceId,
branchId: branch._id,
baseSnapshotId: baseSnapshot?._id,
baseHeadVersion: branch.headVersion,
baseSnapshotRevision: branch.headVersion,
```

Keep `baseSnapshotRevision` populated during this compatibility phase, but no new correctness logic may read it.

Validation-retry Runs must copy `workspaceId`, `branchId`, `baseSnapshotId`, and `baseHeadVersion` from the source Run.

Include `workspaceId`, `branchId`, and `baseHeadVersion` in list projections.
Include `waiting_for_capacity` in every non-terminal/active Run filter,
including duplicate validation-retry detection and cancellation.

Add this helper inside `apps/server/src/routes/agent.ts` and call it for Run
detail, SSE, cancellation, and validation retry after loading the Run:

```ts
import type { IAgentRun } from '../models/AgentRun';

const canAccessRunProject = async (
  run: Pick<IAgentRun, 'projectId'>,
  userId: string
): Promise<boolean> => Boolean(await findOwnedWorkspaceProject({
  projectId: run.projectId,
  userId
}));
```

Return 404 when it returns false. The Run list endpoint must first resolve the
Project through `findOwnedWorkspaceProject`; owner-only Run queries are not
enough after Workspace membership is introduced.

Update every direct `AgentRun.create()` fixture in
`apps/server/src/integration/agentRoutes.integration.ts` with its Project's
`workspaceId`, the selected `branchId`, and `baseHeadVersion`. This includes
timeline and validation-retry fixtures, not only the shared `createRun()`
helper.

- [ ] **Step 4: Enforce context consistency**

In `apps/server/src/agent/contextBuilder.ts`, require Project and Chat to match the Run:

```ts
const project = await Project.findOne({
  _id: run.projectId,
  userId: run.userId,
  workspaceId: run.workspaceId
});
```

```ts
const chat = run.chatId
  ? await Chat.findOne({
      _id: run.chatId,
      userId: run.userId,
      projectId: run.projectId,
      branchId: run.branchId
    })
  : null;
```

If `run.chatId` exists but `chat` is null, throw:

```ts
throw agentError(
  'INVALID_CHAT_BRANCH',
  'Chat no longer belongs to the AgentRun branch'
);
```

Add `INVALID_CHAT_BRANCH` to `publicAgentError()`'s known-code set.

- [ ] **Step 5: Run route, context, and type tests**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentRoutes.integration.ts
node --import tsx --test apps/server/src/agent/contextBuilder.test.ts
npm run type-check --workspace @v0/server
```

Expected: Run creation derives its baseline only from Branch Head and all tests pass.

- [ ] **Step 6: Commit Branch-based Run creation**

```bash
git add \
  apps/server/src/routes/agent.ts \
  apps/server/src/agent/contextBuilder.ts \
  apps/server/src/agent/orchestrator.ts \
  apps/server/src/agent/schemas.ts \
  apps/server/src/integration/agentRoutes.integration.ts
git commit -m "feat: base agent runs on branch heads"
```

## Task 5: Serialize Write Runs Per Branch

**Files:**

- Create: `apps/server/src/branches/branchExecution.ts`
- Modify: `apps/server/src/agent/createWorker.ts`
- Modify: `apps/server/src/agent/createWorker.test.ts`
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/integration/agentWorker.integration.ts`

- [ ] **Step 1: Add a failing Worker scheduling test**

Extend `apps/server/src/agent/createWorker.test.ts` with a Job double that exposes `moveToDelayed` and a token. Add:

```ts
import { DelayedError } from 'bullmq';

test('processor delays a Run when another Run owns the Branch lease', async () => {
  const moved: Array<{ timestamp: number; token?: string }> = [];
  let processCalls = 0;
  const processRun = async () => {
    processCalls += 1;
  };
  const processor = createAgentJobProcessor({
    modelClient,
    validator,
    processRun,
    loadRunStatus: async () => 'queued',
    markRunWaiting: async () => undefined,
    acquireBranchExecution: async () => null,
    branchRetryDelayMs: 2_000
  });

  await assert.rejects(
    processor({
      name: agentRunJobName,
      data: { runId: 'run-2' },
      moveToDelayed: async (timestamp, token) => {
        moved.push({ timestamp, token });
      }
    } as never, 'worker-token'),
    DelayedError
  );

  assert.equal(processCalls, 0);
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.token, 'worker-token');
});
```

Add a second test:

```ts
test('processor releases an acquired Branch lease after processing', async () => {
  let released = 0;
  const processor = createAgentJobProcessor({
    modelClient,
    validator,
    loadRunStatus: async () => 'queued',
    processRun: async (_data, _model, _validator, execution) => {
      await execution?.assertHeld();
    },
    acquireBranchExecution: async () => ({
      assertHeld: async () => undefined,
      release: async () => { released += 1; }
    })
  });

  await processor({
    name: agentRunJobName,
    data: { runId: 'run-1' }
  } as never);

  assert.equal(released, 1);
});
```

- [ ] **Step 2: Run the Worker unit file and confirm failure**

Run:

```bash
node --import tsx --test apps/server/src/agent/createWorker.test.ts
```

Expected: FAIL because the processor has no Branch execution dependency.

- [ ] **Step 3: Implement the persistent Branch lease**

Create `apps/server/src/branches/branchExecution.ts`:

```ts
import { Types } from 'mongoose';
import { BranchExecutionLease } from '../models/BranchExecutionLease';
import { AgentRun } from '../models/AgentRun';

const DEFAULT_TTL_MS = 60_000;
const HEARTBEAT_MS = 15_000;

export interface BranchExecutionGuard {
  assertHeld(): Promise<void>;
  release(): Promise<void>;
}

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number }).code === 11_000;

export const acquireBranchExecution = async (
  runId: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<BranchExecutionGuard | null> => {
  const run = await AgentRun.findById(runId);
  if (
    !run ||
    !run.workspaceId ||
    !run.branchId ||
    run.baseHeadVersion === undefined
  ) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  let lease;

  try {
    lease = await BranchExecutionLease.findOneAndUpdate(
      {
        branchId: run.branchId,
        $or: [
          { runId: run._id },
          { expiresAt: { $lte: now } }
        ]
      },
      {
        $set: {
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          branchId: run.branchId,
          runId: run._id,
          baseHeadVersion: run.baseHeadVersion,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }

  if (!lease.runId.equals(run._id)) return null;

  let lost = false;
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing || lost) return;
    renewing = true;
    const nextNow = new Date();
    void BranchExecutionLease.updateOne(
      { _id: lease._id, runId: run._id },
      {
        $set: {
          heartbeatAt: nextNow,
          expiresAt: new Date(nextNow.getTime() + ttlMs)
        }
      }
    ).then(result => {
      if (result.modifiedCount !== 1) lost = true;
    }).catch(() => {
      lost = true;
    }).finally(() => {
      renewing = false;
    });
  }, Math.min(HEARTBEAT_MS, Math.floor(ttlMs / 3)));
  heartbeat.unref();

  return {
    assertHeld: async () => {
      if (lost) {
        throw Object.assign(new Error('Branch execution lease was lost'), {
          code: 'BRANCH_EXECUTION_LOST'
        });
      }
      const held = await BranchExecutionLease.exists({
        _id: lease._id,
        runId: run._id,
        expiresAt: { $gt: new Date() }
      });
      if (!held) {
        lost = true;
        throw Object.assign(new Error('Branch execution lease was lost'), {
          code: 'BRANCH_EXECUTION_LOST'
        });
      }
    },
    release: async () => {
      clearInterval(heartbeat);
      await BranchExecutionLease.deleteOne({
        _id: lease._id,
        runId: run._id
      });
    }
  };
};
```

- [ ] **Step 4: Delay busy Branch Jobs in the BullMQ processor**

Update `apps/server/src/agent/createWorker.ts` imports:

```ts
import {
  DelayedError,
  Worker,
  type ConnectionOptions,
  type Job
} from 'bullmq';
import {
  acquireBranchExecution,
  type BranchExecutionGuard
} from '../branches/branchExecution';
import { BranchExecutionLease } from '../models/BranchExecutionLease';
import { ProjectBranch } from '../models/ProjectBranch';
```

Extend dependencies:

```ts
export interface AgentJobProcessorDependencies {
  modelClient: ModelClient;
  validator: ProjectValidator;
  processRun?: typeof processAgentRun;
  processValidation?: typeof processValidationCandidate;
  acquireBranchExecution?: (
    runId: string
  ) => Promise<BranchExecutionGuard | null>;
  loadRunStatus?: (
    runId: string
  ) => Promise<AgentRunStatus | undefined>;
  markRunWaiting?: (runId: string) => Promise<void>;
  branchRetryDelayMs?: number;
}
```

Replace `createAgentJobProcessor` with a processor that accepts the BullMQ token:

```ts
export const createAgentJobProcessor = (
  dependencies: AgentJobProcessorDependencies
) => async (
  job: Job<AgentRunJobData>,
  token?: string
): Promise<void> => {
  if (
    job.name !== agentRunJobName &&
    job.name !== retryValidationJobName
  ) {
    throw new Error(`Unsupported job name: ${job.name}`);
  }

  const loadRunStatus = dependencies.loadRunStatus ??
    (async (runId: string) => (
      await AgentRun.findById(runId).select('status')
    )?.status);
  const initialStatus = await loadRunStatus(job.data.runId);
  if (!initialStatus || isTerminalAgentRunStatus(initialStatus)) {
    return;
  }

  const acquire = dependencies.acquireBranchExecution ??
    acquireBranchExecution;
  const execution = await acquire(job.data.runId);
  if (!execution) {
    const markRunWaiting = dependencies.markRunWaiting ??
      (async (runId: string) => {
        await AgentRun.updateOne(
          {
            _id: runId,
            status: { $in: ['queued', 'waiting_for_capacity'] }
          },
          { $set: { status: 'waiting_for_capacity' } }
        );
      });
    await markRunWaiting(job.data.runId);
    await job.moveToDelayed(
      Date.now() + (dependencies.branchRetryDelayMs ?? 2_000),
      token
    );
    throw new DelayedError();
  }

  if (
    initialStatus === 'waiting_for_capacity' &&
    job.name === agentRunJobName
  ) {
    const waitingRun = await AgentRun.findById(job.data.runId)
      .select('branchId');
    const branch = await ProjectBranch.findById(waitingRun?.branchId)
      .select('headSnapshotId headVersion');
    if (!branch) {
      await execution.release();
      throw new Error(`ProjectBranch not found for Run ${job.data.runId}`);
    }
    const rebased = await AgentRun.updateOne(
      { _id: job.data.runId, status: 'waiting_for_capacity' },
      {
        $set: {
          status: 'queued',
          baseSnapshotId: branch.headSnapshotId,
          baseHeadVersion: branch.headVersion,
          baseSnapshotRevision: branch.headVersion
        }
      }
    );
    if (rebased.modifiedCount !== 1) {
      await execution.release();
      return;
    }
    await BranchExecutionLease.updateOne(
      { branchId: waitingRun?.branchId, runId: job.data.runId },
      { $set: { baseHeadVersion: branch.headVersion } }
    );
  } else if (initialStatus === 'waiting_for_capacity') {
    await AgentRun.updateOne(
      { _id: job.data.runId, status: 'waiting_for_capacity' },
      { $set: { status: 'queued' } }
    );
  }

  try {
    if (job.name === retryValidationJobName) {
      await (
        dependencies.processValidation ??
        processValidationCandidate
      )(job.data, dependencies.validator, execution);
      return;
    }
    await (dependencies.processRun ?? processAgentRun)(
      job.data,
      dependencies.modelClient,
      dependencies.validator,
      execution
    );
  } finally {
    await execution.release();
  }
};
```

Import `AgentRun` into this file. Keep the Worker `concurrency` option
unchanged so different Branches can still run in parallel. Also import
`AgentRunStatus` from `./types` and `isTerminalAgentRunStatus` from
`./stateMachine`.

Only delayed generation Jobs rebase to the latest Branch Head when they
finally acquire the lease. Validation-retry Jobs retain their original
Candidate baseline so a retry cannot silently validate against different
source code.

BullMQ documents this exact manual-delay pattern: call `moveToDelayed(timestamp, token)` and throw `DelayedError`; special errors do not consume normal attempts.

- [ ] **Step 5: Assert lease ownership before persistence**

In `apps/server/src/agent/orchestrator.ts`, define:

```ts
interface BranchExecutionContext {
  assertHeld(): Promise<void>;
}
```

Add an optional fourth argument to `processAgentRun` and third argument to `processValidationCandidate`:

```ts
execution?: BranchExecutionContext
```

Immediately before transitioning from `validating` to `persisting`, add:

```ts
await execution?.assertHeld();
```

Add `BRANCH_EXECUTION_LOST` to the public error allowlist. A lost lease must fail the Run before it creates or commits a Snapshot.

- [ ] **Step 6: Add Branch serialization integration coverage**

Add to `apps/server/src/integration/agentWorker.integration.ts`:

```ts
test('two Runs on one Branch never execute their models concurrently', async () => {
  const first = await createQueuedRun();
  const branch = await ensureMainBranch(first.project);
  await AgentRun.updateOne(
    { _id: first.run._id },
    {
      $set: {
        workspaceId: first.project.workspaceId,
        branchId: branch._id,
        baseHeadVersion: branch.headVersion
      }
    }
  );
  const secondRun = await AgentRun.create({
    userId: first.user._id,
    workspaceId: first.project.workspaceId,
    projectId: first.project._id,
    branchId: branch._id,
    prompt: 'Second change',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    baseHeadVersion: 0,
    maxRepairAttempts: 2,
    model: 'fake-model'
  });

  let active = 0;
  let maxActive = 0;
  const model = createFakeModelClient();
  const originalPlan = model.generatePlan;
  model.generatePlan = async input => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      return await originalPlan(input);
    } finally {
      active -= 1;
    }
  };

  await Promise.all([
    enqueueAgentRun(first.run._id.toString()),
    enqueueAgentRun(secondRun._id.toString())
  ]);
  await withWorker(model, createPassingValidator(), async () => {
    const completed = await Promise.all([
      waitForTerminalRun(first.run._id.toString()),
      waitForTerminalRun(secondRun._id.toString())
    ]);
    assert.deepEqual(
      completed.map(run => run.status),
      ['completed', 'completed']
    );
  });

  assert.equal(maxActive, 1);
});
```

Update the integration fixture helpers so every directly created Project, Chat, and AgentRun has Workspace and Branch fields.
Update `waitForTerminalRun()` so its terminal list also includes
`completed_with_conflict`.

- [ ] **Step 7: Run Worker tests**

Run:

```bash
node --import tsx --test apps/server/src/agent/createWorker.test.ts
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentWorker.integration.ts
npm run type-check --workspace @v0/server
```

Expected: same-Branch Runs serialize; different existing Worker cases remain green.

- [ ] **Step 8: Commit Branch execution serialization**

```bash
git add \
  apps/server/src/branches/branchExecution.ts \
  apps/server/src/agent/createWorker.ts \
  apps/server/src/agent/createWorker.test.ts \
  apps/server/src/agent/orchestrator.ts \
  apps/server/src/integration/agentWorker.integration.ts
git commit -m "feat: serialize agent runs per branch"
```

## Task 6: Commit Snapshot Results with Branch CAS

**Files:**

- Modify: `apps/server/src/branches/branchService.ts`
- Modify: `apps/server/src/agent/orchestrator.ts`
- Modify: `apps/server/src/integration/agentWorker.integration.ts`

- [ ] **Step 1: Add failing CAS and conflict tests**

Add to `apps/server/src/integration/agentWorker.integration.ts`:

```ts
test('completed Run advances only its Branch Head', async () => {
  const { project, run } = await createQueuedRun();
  const main = await ensureMainBranch(project);
  const other = await ProjectBranch.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    name: 'other',
    headVersion: 0
  });
  await AgentRun.updateOne(
    { _id: run._id },
    {
      $set: {
        workspaceId: project.workspaceId,
        branchId: main._id,
        baseHeadVersion: 0
      }
    }
  );

  await enqueueAgentRun(run._id.toString());
  await withWorker(
    createFakeModelClient(),
    createPassingValidator(),
    async () => {
      await waitForTerminalRun(run._id.toString());
    }
  );

  const [completed, refreshedMain, refreshedOther] = await Promise.all([
    AgentRun.findById(run._id),
    ProjectBranch.findById(main._id),
    ProjectBranch.findById(other._id)
  ]);
  assert.equal(completed?.status, 'completed');
  assert.equal(
    refreshedMain?.headSnapshotId?.toString(),
    completed?.resultSnapshotId?.toString()
  );
  assert.equal(refreshedMain?.headVersion, 1);
  assert.equal(refreshedOther?.headVersion, 0);
});

test('stale Run keeps its Snapshot and completes with conflict', async () => {
  const fixture = await createQueuedRun();
  const branch = await ensureMainBranch(fixture.project);
  const winningSnapshot = await ProjectSnapshot.create({
    userId: fixture.user._id,
    projectId: fixture.project._id,
    sourceRunId: fixture.run._id,
    files: [],
    packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
    validation: { status: 'passed', checks: [] },
    summary: 'Winning snapshot'
  });
  branch.headSnapshotId = winningSnapshot._id;
  branch.headVersion = 1;
  await branch.save();
  await AgentRun.updateOne(
    { _id: fixture.run._id },
    {
      $set: {
        workspaceId: fixture.project.workspaceId,
        branchId: branch._id,
        baseHeadVersion: 0
      }
    }
  );

  await processAgentRun(
    { runId: fixture.run._id.toString() },
    createFakeModelClient(),
    createPassingValidator(),
    { assertHeld: async () => undefined }
  );

  const [run, refreshedBranch, resultSnapshot] = await Promise.all([
    AgentRun.findById(fixture.run._id),
    ProjectBranch.findById(branch._id),
    ProjectSnapshot.findOne({ sourceRunId: fixture.run._id }).sort({
      createdAt: -1
    })
  ]);
  assert.equal(run?.status, 'completed_with_conflict');
  assert.ok(run?.resultSnapshotId);
  assert.ok(resultSnapshot);
  assert.equal(
    refreshedBranch?.headSnapshotId?.toString(),
    winningSnapshot._id.toString()
  );
});
```

- [ ] **Step 2: Run the two cases and confirm failure**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern="advances only its Branch|completes with conflict" \
  apps/server/src/integration/agentWorker.integration.ts
```

Expected: FAIL because the orchestrator still updates Project.activeSnapshot.

- [ ] **Step 3: Add a Branch Head commit result**

In `apps/server/src/branches/branchService.ts`, add:

```ts
export type BranchHeadCommitResult =
  | { outcome: 'advanced'; headVersion: number }
  | { outcome: 'already_advanced'; headVersion: number }
  | { outcome: 'conflict'; headVersion: number };

export const commitBranchHead = async (input: {
  branchId: Types.ObjectId;
  expectedHeadVersion: number;
  snapshotId: Types.ObjectId;
}): Promise<BranchHeadCommitResult> => {
  const advanced = await setBranchHead(input);
  if (advanced) {
    return {
      outcome: 'advanced',
      headVersion: advanced.headVersion
    };
  }

  const current = await ProjectBranch.findById(input.branchId)
    .select('headSnapshotId headVersion');
  if (!current) {
    throw Object.assign(new Error('Project branch not found'), {
      code: 'PROJECT_BRANCH_NOT_FOUND'
    });
  }
  if (current.headSnapshotId?.equals(input.snapshotId)) {
    return {
      outcome: 'already_advanced',
      headVersion: current.headVersion
    };
  }
  return {
    outcome: 'conflict',
    headVersion: current.headVersion
  };
};
```

- [ ] **Step 4: Replace Project activation with Branch commit**

Delete `activateSnapshotIfBaseIsCurrent()` from `apps/server/src/agent/orchestrator.ts`.

Add:

```ts
const completeRunWithSnapshot = async (
  run: InstanceType<typeof AgentRun>,
  snapshot: InstanceType<typeof ProjectSnapshot>,
  fields: Record<string, unknown> = {}
): Promise<'completed' | 'completed_with_conflict'> => {
  if (!run.branchId || run.baseHeadVersion === undefined) {
    throw Object.assign(new Error('AgentRun is missing Branch baseline'), {
      code: 'INVALID_BRANCH_BASELINE'
    });
  }
  const committed = await commitBranchHead({
    branchId: run.branchId,
    expectedHeadVersion: run.baseHeadVersion,
    snapshotId: snapshot._id
  });
  const status = committed.outcome === 'conflict'
    ? 'completed_with_conflict'
    : 'completed';
  await transitionRun(run, 'persisting', status, {
    resultSnapshotId: snapshot._id,
    completedAt: new Date(),
    ...fields
  });
  return status;
};
```

Use this helper in:

- The normal generation flow.
- The `persisting` recovery path.
- Validation-candidate retry completion.

Pass `{ usage: generation.usage }` from the normal generation flow and
`{ retryable: false }` from validation-candidate completion so the existing
metadata behavior is preserved.

Never delete a validated Snapshot because the Branch CAS conflicts. Emit `run.completed` for both statuses with:

```ts
payload: {
  snapshotId: snapshot._id.toString(),
  fileCount: snapshot.files.length,
  branchId: run.branchId.toString(),
  branchAdvanced: status === 'completed',
  conflict: status === 'completed_with_conflict'
}
```

Treat `completed_with_conflict` as terminal in idempotent Worker entry logic. Continue updating the temporary Project active-Snapshot mirror only when the committed Branch is `main` and the CAS outcome is `advanced`; remove that mirror in a later compatibility plan.

- [ ] **Step 5: Run Worker integration and unit tests**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/integration/agentWorker.integration.ts
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: both CAS outcomes pass, no validated Snapshot is deleted on conflict, and the existing repair/retry flows remain green.

- [ ] **Step 6: Commit Branch CAS**

```bash
git add \
  apps/server/src/branches/branchService.ts \
  apps/server/src/agent/orchestrator.ts \
  apps/server/src/integration/agentWorker.integration.ts
git commit -m "feat: commit snapshots with branch head cas"
```

## Task 7: Backfill Existing Documents and Verify the Migration

**Files:**

- Create: `apps/server/src/migrations/20260726WorkspaceBranches.ts`
- Create: `apps/server/src/migrations/20260726WorkspaceBranches.integration.ts`
- Create: `apps/server/src/migrate.ts`
- Modify: `apps/server/src/models/Project.ts`
- Modify: `apps/server/src/models/Chat.ts`
- Modify: `apps/server/src/models/AgentRun.ts`
- Modify: `apps/server/src/agent/models.test.ts`
- Modify: `apps/server/package.json`
- Modify: `README.md`

- [ ] **Step 1: Write a failing idempotent migration test**

Create `apps/server/src/migrations/20260726WorkspaceBranches.integration.ts`:

```ts
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { AgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';
import {
  migrateWorkspaceBranches,
  verifyWorkspaceBranchMigration
} from './20260726WorkspaceBranches';

let environment: IntegrationEnvironment;

before(async () => {
  environment = await createIntegrationEnvironment();
});
beforeEach(async () => environment.reset());
after(async () => environment.close());

test('migration backfills legacy Projects Chats and Runs exactly once', async () => {
  const user = await User.create({
    email: 'legacy@example.test',
    password: 'password',
    name: 'Legacy'
  });
  const project = await Project.collection.insertOne({
    userId: user._id,
    name: 'Legacy project',
    chatIds: [],
    activeSnapshotRevision: 3,
    settings: {
      framework: 'react',
      styling: 'tailwind',
      uiLibrary: 'shadcn'
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const chat = await Chat.collection.insertOne({
    userId: user._id,
    projectId: project.insertedId,
    title: 'Legacy chat',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const run = await AgentRun.collection.insertOne({
    userId: user._id,
    projectId: project.insertedId,
    chatId: chat.insertedId,
    prompt: 'Legacy run',
    status: 'completed',
    mode: 'create',
    baseSnapshotRevision: 3,
    attempt: 0,
    maxRepairAttempts: 2,
    model: 'legacy-model',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await migrateWorkspaceBranches();
  await migrateWorkspaceBranches();
  await verifyWorkspaceBranchMigration();

  const [workspace, membership, migratedProject, branch, migratedChat, migratedRun] =
    await Promise.all([
      Workspace.findOne({ slug: 'default' }),
      WorkspaceMember.findOne({ userId: user._id }),
      Project.findById(project.insertedId),
      ProjectBranch.findOne({ projectId: project.insertedId, name: 'main' }),
      Chat.findById(chat.insertedId),
      AgentRun.findById(run.insertedId)
    ]);

  assert.ok(workspace && membership && migratedProject && branch);
  assert.equal(await ProjectBranch.countDocuments({
    projectId: project.insertedId,
    name: 'main'
  }), 1);
  assert.equal(migratedProject.workspaceId?.toString(), workspace._id.toString());
  assert.equal(migratedChat?.branchId?.toString(), branch._id.toString());
  assert.equal(migratedRun?.workspaceId?.toString(), workspace._id.toString());
  assert.equal(migratedRun?.branchId?.toString(), branch._id.toString());
  assert.equal(migratedRun?.baseHeadVersion, 3);
});
```

- [ ] **Step 2: Run the migration test and confirm failure**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/migrations/20260726WorkspaceBranches.integration.ts
```

Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Implement the idempotent migration**

Create `apps/server/src/migrations/20260726WorkspaceBranches.ts` with these exported operations:

```ts
import { AgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';

export const migrateWorkspaceBranches = async (): Promise<void> => {
  const users = await User.find().sort({ createdAt: 1, _id: 1 });
  if (users.length === 0) return;

  const owner = users[0]!;
  const workspace = await Workspace.findOneAndUpdate(
    { slug: 'default' },
    {
      $setOnInsert: {
        slug: 'default',
        name: 'Default Workspace',
        status: 'active',
        createdByUserId: owner._id
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  for (const user of users) {
    await WorkspaceMember.updateOne(
      { workspaceId: workspace._id, userId: user._id },
      {
        $setOnInsert: {
          role: user._id.equals(owner._id) ? 'owner' : 'member'
        }
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  const projects = await Project.find();
  for (const project of projects) {
    if (!project.workspaceId) {
      await Project.updateOne(
        { _id: project._id, workspaceId: { $exists: false } },
        { $set: { workspaceId: workspace._id } }
      );
      project.workspaceId = workspace._id;
    }

    const branch = await ProjectBranch.findOneAndUpdate(
      { projectId: project._id, name: 'main' },
      {
        $setOnInsert: {
          workspaceId: workspace._id,
          projectId: project._id,
          name: 'main',
          status: 'active',
          headSnapshotId: project.activeSnapshotId,
          headVersion: project.activeSnapshotRevision ?? 0,
          createdFromSnapshotId: project.activeSnapshotId
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await Chat.updateMany(
      { projectId: project._id, branchId: { $exists: false } },
      { $set: { branchId: branch._id } }
    );
    await AgentRun.updateMany(
      { projectId: project._id, workspaceId: { $exists: false } },
      { $set: { workspaceId: workspace._id } }
    );
    await AgentRun.updateMany(
      { projectId: project._id, branchId: { $exists: false } },
      { $set: { branchId: branch._id } }
    );

    const legacyRuns = await AgentRun.find({
      projectId: project._id,
      baseHeadVersion: { $exists: false }
    }).select('_id baseSnapshotRevision');
    if (legacyRuns.length > 0) {
      await AgentRun.bulkWrite(legacyRuns.map(run => ({
        updateOne: {
          filter: { _id: run._id, baseHeadVersion: { $exists: false } },
          update: {
            $set: {
              baseHeadVersion: run.baseSnapshotRevision ?? 0
            }
          }
        }
      })));
    }
  }
};

export const verifyWorkspaceBranchMigration =
  async (): Promise<void> => {
    const counts = {
      projectsWithoutWorkspace: await Project.countDocuments({
        workspaceId: { $exists: false }
      }),
      chatsWithoutBranch: await Chat.countDocuments({
        projectId: { $exists: true },
        branchId: { $exists: false }
      }),
      runsWithoutWorkspace: await AgentRun.countDocuments({
        workspaceId: { $exists: false }
      }),
      runsWithoutBranch: await AgentRun.countDocuments({
        branchId: { $exists: false }
      }),
      runsWithoutBaseHeadVersion: await AgentRun.countDocuments({
        baseHeadVersion: { $exists: false }
      })
    };

    const failures = Object.entries(counts).filter(([, count]) => count > 0);
    if (failures.length > 0) {
      throw new Error(
        `Workspace/Branch migration incomplete: ${JSON.stringify(counts)}`
      );
    }
  };
```

The migration intentionally uses sequential Project iteration. This is a one-time internal migration, and bounded concurrency can be added only if production volume proves it necessary.

- [ ] **Step 4: Add the CLI and package scripts**

Create `apps/server/src/migrate.ts`:

```ts
import dotenv from 'dotenv';
import {
  migrateWorkspaceBranches,
  verifyWorkspaceBranchMigration
} from './migrations/20260726WorkspaceBranches';
import { connectDB, disconnectDB } from './utils/db';

dotenv.config();

const main = async (): Promise<void> => {
  await connectDB();
  try {
    await migrateWorkspaceBranches();
    await verifyWorkspaceBranchMigration();
    console.log('Workspace/Branch migration completed');
  } finally {
    await disconnectDB();
  }
};

void main().catch(error => {
  console.error('Workspace/Branch migration failed', error);
  process.exitCode = 1;
});
```

Add to `apps/server/package.json`:

```json
"migrate:workspace-branches": "tsx src/migrate.ts",
"start:migrate:workspace-branches": "node dist/migrate.js"
```

- [ ] **Step 5: Enforce required references for all new writes**

After the migration module and its integration test exist, tighten
`apps/server/src/models/Project.ts`:

```ts
workspaceId: {
  type: Schema.Types.ObjectId,
  ref: 'Workspace',
  required: true
},
```

In `apps/server/src/models/Chat.ts`, require `branchId` only when the Chat is
attached to a Project, preserving standalone legacy Chats:

```ts
branchId: {
  type: Schema.Types.ObjectId,
  ref: 'ProjectBranch',
  required(this: IChat): boolean {
    return this.projectId !== undefined;
  }
},
```

In `apps/server/src/models/AgentRun.ts`, make all three fields required:

```ts
workspaceId: {
  type: Schema.Types.ObjectId,
  ref: 'Workspace',
  required: true
},
branchId: {
  type: Schema.Types.ObjectId,
  ref: 'ProjectBranch',
  required: true
},
baseHeadVersion: {
  type: Number,
  required: true
},
```

Add model-validation cases to `apps/server/src/agent/models.test.ts` proving
that a new Project and AgentRun without these fields fail `validateSync()`,
while a standalone Chat without `projectId` remains valid.

```ts
test('new persisted domain records require Workspace and Branch references', () => {
  const userId = new Types.ObjectId();
  const projectId = new Types.ObjectId();

  const project = new Project({
    userId,
    name: 'Missing Workspace'
  });
  assert.equal(
    project.validateSync()?.errors.workspaceId?.kind,
    'required'
  );

  const run = new AgentRun({
    userId,
    projectId,
    prompt: 'Missing Branch baseline',
    status: 'queued',
    mode: 'create',
    baseSnapshotRevision: 0,
    maxRepairAttempts: 2,
    model: 'test-model'
  });
  const runErrors = run.validateSync()?.errors;
  assert.equal(runErrors?.workspaceId?.kind, 'required');
  assert.equal(runErrors?.branchId?.kind, 'required');
  assert.equal(runErrors?.baseHeadVersion?.kind, 'required');

  const standaloneChat = new Chat({
    userId,
    title: 'Standalone legacy chat',
    messages: []
  });
  assert.equal(standaloneChat.validateSync(), undefined);
});
```

- [ ] **Step 6: Document the maintenance-window rollout**

Add to `README.md`:

````md
### Workspace/Branch 数据迁移

升级到包含 ProjectBranch 的版本时，先停止 API Server 和 Agent Worker，
备份 MongoDB，然后执行：

```bash
npm run build --workspace @v0/server
npm run start:migrate:workspace-branches --workspace @v0/server
```

命令可重复执行。只有看到 `Workspace/Branch migration completed` 后才能启动
新版本 Server 和 Worker。迁移会创建一个默认 Workspace、把现有用户加入该
Workspace、为每个 Project 创建 `main` Branch，并回填 Chat 和 AgentRun。
````

- [ ] **Step 7: Run migration and build verification**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/migrations/20260726WorkspaceBranches.integration.ts
npm run build --workspace @v0/server
```

Expected: the migration passes twice against the same fixtures and the server build succeeds.

- [ ] **Step 8: Commit migration support**

```bash
git add \
  apps/server/src/migrations/20260726WorkspaceBranches.ts \
  apps/server/src/migrations/20260726WorkspaceBranches.integration.ts \
  apps/server/src/migrate.ts \
  apps/server/src/models/Project.ts \
  apps/server/src/models/Chat.ts \
  apps/server/src/models/AgentRun.ts \
  apps/server/src/agent/models.test.ts \
  apps/server/package.json \
  README.md
git commit -m "feat: migrate projects to workspace branches"
```

## Task 8: Preserve Frontend Behavior for Branch Conflict Completion

**Files:**

- Modify: `apps/web/src/services/api.ts`
- Modify: `apps/web/src/lib/v0Workspace.ts`
- Modify: `apps/web/src/lib/v0Workspace.test.ts`
- Modify: `apps/web/src/lib/chatTimeline.ts`
- Modify: `apps/web/src/lib/chatTimeline.test.ts`
- Modify: `apps/web/src/pages/V0Clone.tsx`

- [ ] **Step 1: Write failing frontend state tests**

Add to `apps/web/src/lib/v0Workspace.test.ts`:

```ts
test('completed_with_conflict keeps the validated Snapshot ready', () => {
  const state = applyAgentRunDetail(
    startApiGeneration(
      createInitialWorkspaceState(),
      'Build competing version',
      'run_conflict'
    ),
    {
      run: {
        _id: 'run_conflict',
        status: 'completed_with_conflict',
        resultSnapshotId: 'snapshot_conflict'
      },
      events: [],
      resultSnapshot: {
        _id: 'snapshot_conflict',
        summary: 'Validated conflicting version',
        files: [],
        packageJson: {
          dependencies: {},
          devDependencies: {},
          scripts: {}
        },
        validation: { status: 'passed', checks: [] }
      }
    }
  );

  assert.equal(state.generation.status, 'ready');
  assert.equal(state.snapshot?.id, 'snapshot_conflict');
  assert.match(state.generation.warning ?? '', /未更新当前分支/);
});
```

Add to `apps/web/src/lib/chatTimeline.test.ts`:

```ts
test('Branch conflict completion is terminal and keeps its Snapshot summary', () => {
  const conflict = turn('conflict', 'completed_with_conflict');
  conflict.snapshot = {
    id: 'snapshot-conflict',
    summary: 'Alternative result',
    changedFiles: ['src/App.tsx']
  };

  assert.equal(canToggleTurn(conflict), true);
  assert.match(formatCollapsedTurnLabel(conflict), /分支已变化/);
});
```

- [ ] **Step 2: Run the focused frontend tests and confirm failure**

Run:

```bash
node --import tsx --test \
  apps/web/src/lib/v0Workspace.test.ts \
  apps/web/src/lib/chatTimeline.test.ts
```

Expected: FAIL because the status and warning field are unknown.

- [ ] **Step 3: Extend API and Workspace types**

In `apps/web/src/services/api.ts`:

- Add `workspaceId`, `branchId`, and `baseHeadVersion` to `AgentRun`.
- Add `branchId` to `RoutedChat` and `ChatListItem`.
- Add `waiting_for_capacity` and `completed_with_conflict` to `AgentRun.status`.

In `apps/web/src/lib/v0Workspace.ts`:

```ts
warning?: string
```

Insert this property directly after `generation.error?: string` in the
existing nested `generation` object.

Add both statuses to `AgentRunSummary.status`. Treat conflict completion as terminal and ready:

```ts
const completed = detail.run.status === 'completed'
  || detail.run.status === 'completed_with_conflict';
const terminal = completed
  || detail.run.status === 'failed'
  || detail.run.status === 'cancelled';
```

Set:

```ts
status: completed
  ? 'ready'
  : isCancelled
    ? 'cancelled'
    : terminal
      ? 'failed'
      : 'running',
warning: detail.run.status === 'completed_with_conflict'
  ? '代码已通过验证并保存，但当前分支已变化，因此未更新当前分支。'
  : undefined,
```

- [ ] **Step 4: Extend timeline terminal handling**

In `apps/web/src/lib/chatTimeline.ts`:

- Add `waiting_for_capacity` to `activeStatuses`.
- Add `completed_with_conflict` to `terminalStatuses`.
- Treat both completed statuses as candidates in `resolveDefaultExpandedRunIds`.
- Return a conflict-specific collapsed label:

```ts
if (turn.agent.status === 'completed_with_conflict') {
  return `已保存 · 分支已变化 · ${
    turn.agent.summary ?? turn.snapshot?.summary ?? '替代版本'
  }`;
}
```

When applying a `run.completed` event, read `event.payload?.conflict`:

```ts
if (event.type === 'run.completed') {
  return event.payload?.conflict === true
    ? 'completed_with_conflict'
    : 'completed';
}
```

Use a shared `isCompletedStatus()` helper everywhere the file currently compares only with `'completed'`.

In `apps/web/src/pages/V0Clone.tsx`, change:

```ts
if (chatId && detail.run.status === 'completed') {
```

to:

```ts
if (
  chatId &&
  (
    detail.run.status === 'completed' ||
    detail.run.status === 'completed_with_conflict'
  )
) {
```

- [ ] **Step 5: Run frontend tests, type-check, and build**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all web tests pass and the production build succeeds.

- [ ] **Step 6: Commit frontend compatibility**

```bash
git add \
  apps/web/src/services/api.ts \
  apps/web/src/lib/v0Workspace.ts \
  apps/web/src/lib/v0Workspace.test.ts \
  apps/web/src/lib/chatTimeline.ts \
  apps/web/src/lib/chatTimeline.test.ts \
  apps/web/src/pages/V0Clone.tsx
git commit -m "feat: surface branch conflict snapshots"
```

## Task 9: Run the Full Phase Verification

**Files:**

- Modify only if verification finds a defect in files already listed above.

- [ ] **Step 1: Run repository formatting checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 2: Run all server unit tests**

Run:

```bash
npm test --workspace @v0/server
```

Expected: all server unit tests pass.

- [ ] **Step 3: Run all backend integration tests**

Run:

```bash
npm run test:integration --workspace @v0/server
```

Expected: all Testcontainers-backed MongoDB/Redis integration tests pass.

- [ ] **Step 4: Run all frontend tests**

Run:

```bash
npm test --workspace @v0/web
```

Expected: all frontend Node tests pass.

- [ ] **Step 5: Run both production builds**

Run:

```bash
npm run build --workspace @v0/server
npm run build --workspace @v0/web
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Verify migration idempotency separately**

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  apps/server/src/migrations/20260726WorkspaceBranches.integration.ts
```

Expected: the migration runs twice and verification reports no missing Workspace or Branch references.

- [ ] **Step 7: Inspect the final change scope**

Run:

```bash
git status --short
git diff --stat HEAD~8..HEAD
```

Expected: only the Workspace/Branch files listed in this plan are present. Preserve unrelated pre-existing `package.json` and `tests/repository/` changes.

- [ ] **Step 8: Commit any verification-only fixes**

If and only if verification required changes:

```bash
git status --short
git add -- \
  apps/server/src/models/Workspace.ts \
  apps/server/src/models/WorkspaceMember.ts \
  apps/server/src/models/ProjectBranch.ts \
  apps/server/src/models/BranchExecutionLease.ts \
  apps/server/src/models/Project.ts \
  apps/server/src/models/Chat.ts \
  apps/server/src/models/AgentRun.ts \
  apps/server/src/workspaces/defaultWorkspace.ts \
  apps/server/src/workspaces/projectAccess.ts \
  apps/server/src/branches/branchService.ts \
  apps/server/src/branches/branchExecution.ts \
  apps/server/src/migrations/20260726WorkspaceBranches.ts \
  apps/server/src/migrations/20260726WorkspaceBranches.integration.ts \
  apps/server/src/migrate.ts \
  apps/server/src/agent/types.ts \
  apps/server/src/agent/stateMachine.ts \
  apps/server/src/agent/stateMachine.test.ts \
  apps/server/src/agent/models.test.ts \
  apps/server/src/agent/createWorker.ts \
  apps/server/src/agent/createWorker.test.ts \
  apps/server/src/agent/orchestrator.ts \
  apps/server/src/agent/contextBuilder.ts \
  apps/server/src/agent/schemas.ts \
  apps/server/src/routes/auth.ts \
  apps/server/src/routes/project.ts \
  apps/server/src/routes/chat.ts \
  apps/server/src/routes/agent.ts \
  apps/server/src/chat/chatList.ts \
  apps/server/src/integration/workspaceAccess.integration.ts \
  apps/server/src/integration/agentRoutes.integration.ts \
  apps/server/src/integration/agentWorker.integration.ts \
  apps/server/package.json \
  apps/web/src/services/api.ts \
  apps/web/src/lib/v0Workspace.ts \
  apps/web/src/lib/v0Workspace.test.ts \
  apps/web/src/lib/chatTimeline.ts \
  apps/web/src/lib/chatTimeline.test.ts \
  apps/web/src/pages/V0Clone.tsx \
  README.md
git commit -m "fix: complete workspace branch verification"
```

Before committing, inspect `git diff --cached --stat` and unstage any path not
listed in this plan. If no fixes were required, do not create an empty commit.

## Final Acceptance Checklist

- [ ] New registrations join one default Workspace.
- [ ] Existing owner checks remain in force in addition to Workspace membership.
- [ ] Every new Project receives `workspaceId` and one `main` Branch.
- [ ] Every new Chat receives `branchId`.
- [ ] Explicit Branch creation validates the source Snapshot.
- [ ] Every new AgentRun records Workspace, Branch, base Snapshot, and base head version.
- [ ] Same-Branch write Runs serialize through BranchExecutionLease.
- [ ] A delayed generation Run rebases to the latest Branch Head before model execution.
- [ ] A delayed validation retry preserves its original Candidate baseline.
- [ ] Busy Branch Jobs use BullMQ delayed processing without consuming normal attempts.
- [ ] Different Branches still execute concurrently up to Worker concurrency.
- [ ] Snapshot commit uses Branch Head CAS.
- [ ] A stale Run preserves its Snapshot and becomes `completed_with_conflict`.
- [ ] Preview and Workspace UI treat a conflict Snapshot as usable but not active.
- [ ] Migration is idempotent and fails verification if any reference is missing.
- [ ] Existing snapshot rollback remains backward compatible through the `main` Branch.
- [ ] Server unit tests, integration tests, frontend tests, and both builds pass.

## Implementation References

- Approved design: `docs/superpowers/specs/2026-07-26-daytona-sandbox-provider-design.md`
- BullMQ manual delayed processing: <https://docs.bullmq.io/patterns/process-step-jobs>
- BullMQ 5.81 `Job.moveToDelayed`: <https://api.docs.bullmq.io/classes/v5.Job.html#moveToDelayed>
- BullMQ 5.81 `DelayedError`: <https://api.docs.bullmq.io/classes/v5.DelayedError.html>
