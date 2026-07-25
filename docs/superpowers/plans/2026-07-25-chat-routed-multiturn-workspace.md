# Chat-Routed Multiturn Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Chat a dedicated workspace URL and let users submit sequential Edit runs from a fixed composer against the Chat's Project and active Snapshot.

**Architecture:** React Router makes `chatId` the workspace route identity; the frontend resolves its `projectId` through the Chat API and reuses the existing Agent Run monitor. Chat creation becomes metadata-only, while authenticated Agent Run creation appends the user prompt and the Worker appends the assistant result, ensuring one LLM/Agent path per turn.

**Tech Stack:** TypeScript, Express, Mongoose, BullMQ, React 18, React Router 6, Vite, Node.js test runner, Testcontainers, Playwright

---

## File Map

- Modify `apps/server/src/routes/chat.ts`: remove legacy LLM generation from Chat creation and message append.
- Modify `apps/server/src/routes/agent.ts`: append one user message when creating a Chat-associated Agent Run.
- Modify `apps/server/src/integration/agentRoutes.integration.ts`: verify Chat ownership, project association, and user-message persistence.
- Modify `apps/server/src/integration/agentWorker.integration.ts`: verify Worker completion adds one assistant message without retry duplication.
- Modify `apps/web/src/App.tsx`: define `/` and `/v0/chats/:chatId` routes.
- Modify `apps/web/src/services/api.ts`: type Chat payloads and create Project-associated empty Chats.
- Create `apps/web/src/lib/chatWorkspace.ts`: own route-workspace request validation and Edit Run payload construction.
- Create `apps/web/src/lib/chatWorkspace.test.ts`: test Chat/Project/Snapshot prerequisites and exact Edit payloads.
- Modify `apps/web/src/pages/V0Clone.tsx`: load routed Chats, create/navigate first conversations, and manage the edit draft.
- Create `apps/web/src/components/WorkspaceEditComposer.tsx`: render the fixed bottom composer and keyboard behavior.
- Modify `tests/smoke/api-smoke.ts`: exercise one Chat-associated Create Run followed by an Edit Run.
- Modify `tests/smoke/workspace.spec.ts`: verify the dedicated route, removed history region, disabled running state, and second prompt.

### Task 1: Align Chat Persistence With Agent Runs

**Files:**
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/routes/agent.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`

- [x] **Step 1: Write failing Chat creation and Run message tests**

Extend `apps/server/src/integration/agentRoutes.integration.ts` with authenticated requests that establish the intended API contract:

```ts
test('Chat creation stores metadata without an assistant response', async () => {
  const { ownerToken, project } = await fixtures();
  const response = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id.toString(),
      titleSeed: 'Build a support dashboard'
    })
    .expect(201);

  assert.equal(response.body.chat.projectId, project._id.toString());
  assert.equal(response.body.chat.title, 'Build a support dashboard');
  assert.deepEqual(response.body.chat.messages, []);
});

test('creating a Chat-associated Run appends one user message', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const chat = await Chat.create({
    userId: owner._id,
    projectId: project._id,
    title: 'Support dashboard',
    messages: []
  });

  const response = await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id.toString(),
      chatId: chat._id.toString(),
      prompt: 'Add ticket filters',
      mode: 'create'
    })
    .expect(201);

  const refreshed = await Chat.findById(chat._id).lean();
  assert.equal(refreshed?.messages.length, 1);
  assert.equal(refreshed?.messages[0]?.role, 'user');
  assert.equal(refreshed?.messages[0]?.content, 'Add ticket filters');
  assert.equal(response.body.run.chatId, chat._id.toString());
});
```

Add rejection coverage:

```ts
test('Run creation rejects a Chat associated with another Project', async () => {
  const { ownerToken, owner, project } = await fixtures();
  const otherProject = await Project.create({
    userId: owner._id,
    name: 'Other',
    settings: { framework: 'react', styling: 'tailwind', uiLibrary: 'none' }
  });
  const chat = await Chat.create({
    userId: owner._id,
    projectId: otherProject._id,
    title: 'Other chat',
    messages: []
  });

  await request(app)
    .post('/api/agent/runs')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      projectId: project._id.toString(),
      chatId: chat._id.toString(),
      prompt: 'Do not append this',
      mode: 'create'
    })
    .expect(404);

  assert.equal((await Chat.findById(chat._id))?.messages.length, 0);
});
```

- [x] **Step 2: Run the focused integration tests and verify RED**

Run:

```bash
npm run test:integration --workspace @v0/server -- --test-name-pattern="Chat creation|Chat-associated|another Project"
```

Expected: FAIL because Chat creation still expects `initialMessage` and invokes the legacy generation service, while Agent Run creation does not append a user message.

- [x] **Step 3: Make Chat endpoints persistence-only**

In `apps/server/src/routes/chat.ts`, remove imports of `generateCode` and
`generateChatTitle`. Change Chat creation to require a valid Project owned by
the authenticated user, derive a bounded deterministic title, and store no
messages:

```ts
import { Project } from '../models/Project';
import { objectIdStringSchema } from '../agent/schemas';

const toChatTitle = (titleSeed: string): string => {
  const normalized = titleSeed.trim().replace(/\s+/g, ' ');
  return normalized.length <= 60 ? normalized : `${normalized.slice(0, 57)}...`;
};

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { projectId, titleSeed } = z.object({
      projectId: objectIdStringSchema,
      titleSeed: z.string().trim().min(1)
    }).parse(req.body);
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const chat = await Chat.create({
      userId: req.userId,
      projectId,
      title: toChatTitle(titleSeed),
      messages: []
    });
    await Project.updateOne(
      { _id: projectId, userId: req.userId },
      { $addToSet: { chatIds: chat._id } }
    );
    res.status(201).json({ chat });
  } catch (error) {
    next(error);
  }
});
```

Change `POST /:id/messages` to append only the supplied user message and return
the Chat. Delete its `generateCode` call and assistant-message push.

- [x] **Step 4: Append the Run prompt exactly once in the HTTP creation path**

In `apps/server/src/routes/agent.ts`, retain the validated `Chat` document and
append after `AgentRun.create` but before event emission/enqueue:

```ts
import { randomUUID } from 'node:crypto';

const chat = body.chatId
  ? await Chat.findOne({
      _id: body.chatId,
      userId,
      projectId: body.projectId
    })
  : null;

if (body.chatId && !chat) {
  res.status(404).json({ error: 'Chat not found' });
  return;
}

// after AgentRun.create(...)
if (chat) {
  chat.messages.push({
    id: randomUUID(),
    role: 'user',
    content: body.prompt,
    createdAt: new Date()
  });
  await chat.save();
}
```

Do not append messages in the BullMQ processor's job-start path. BullMQ retries
must process the already persisted Run without duplicating its prompt.

- [x] **Step 5: Run backend integration and unit verification**

Run:

```bash
npm run test:integration --workspace @v0/server
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: all tests pass and type-check exits with code 0.

- [x] **Step 6: Commit the Chat/Run alignment**

```bash
git add apps/server/src/routes/chat.ts \
  apps/server/src/routes/agent.ts \
  apps/server/src/integration/agentRoutes.integration.ts
git commit -m "feat: persist chat turns through agent runs"
```

### Task 2: Verify Worker Assistant Turns

**Files:**
- Modify: `apps/server/src/integration/agentWorker.integration.ts`

- [x] **Step 1: Write a failing/strengthened Worker conversation test**

Add a Chat to the queued Run fixture and assert the exact completed
conversation:

```ts
test('BullMQ worker appends one assistant turn to its Chat', async () => {
  const { project, run, chat } = await createQueuedChatRun();
  const modelClient = createFakeModelClient();

  await enqueueAgentRun(run._id.toString());
  await withWorker(modelClient, createPassingValidator(), async () => {
    const completed = await waitForTerminalRun(run._id.toString());
    assert.equal(completed.status, 'completed');
  });

  const refreshed = await Chat.findById(chat._id).lean();
  assert.equal(refreshed?.messages.length, 2);
  assert.equal(refreshed?.messages[0]?.role, 'user');
  assert.equal(refreshed?.messages[1]?.role, 'assistant');
  assert.match(refreshed?.messages[1]?.content ?? '', /Snapshot:/);

  await processAgentRun(
    { runId: run._id.toString() },
    modelClient,
    createPassingValidator()
  );
  assert.equal((await Chat.findById(chat._id))?.messages.length, 2);
  assert.equal(project._id.toString(), run.projectId.toString());
});
```

The helper must persist the initial user message once, set both `chatId` and
`projectId` on the Run, and return all three records.

- [x] **Step 2: Run the focused test**

Run:

```bash
npm run test:integration --workspace @v0/server -- --test-name-pattern="assistant turn"
```

Expected: PASS if the existing idempotent completed-Run path is correct; if it
fails, the failure must show either a missing first assistant turn or a
duplicate after replay.

- [x] **Step 3: Run full backend verification and commit**

Run:

```bash
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: all commands exit with code 0.

```bash
git add apps/server/src/integration/agentWorker.integration.ts \
  apps/server/src/agent/orchestrator.ts
git commit -m "test: cover agent chat assistant turns"
```

The current completed-Run early return is the intended idempotency mechanism,
so `orchestrator.ts` should remain unstaged unless the test identifies a
specific defect that is first reproduced with an additional failing assertion.

### Task 3: Add Chat Route and Workspace Request Helpers

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/services/api.ts`
- Create: `apps/web/src/lib/chatWorkspace.ts`
- Create: `apps/web/src/lib/chatWorkspace.test.ts`

- [x] **Step 1: Write failing pure request-helper tests**

Create `apps/web/src/lib/chatWorkspace.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatPath,
  buildEditRunRequest,
  resolveRoutedProjectId
} from './chatWorkspace';

test('buildChatPath encodes a Chat id', () => {
  assert.equal(buildChatPath('chat / 1'), '/v0/chats/chat%20%2F%201');
});

test('resolveRoutedProjectId requires a Chat-associated Project', () => {
  assert.equal(resolveRoutedProjectId({ projectId: 'project_123' }), 'project_123');
  assert.throws(
    () => resolveRoutedProjectId({ projectId: undefined }),
    /not associated with a project/
  );
});

test('buildEditRunRequest requires an active Snapshot and preserves ids', () => {
  assert.deepEqual(buildEditRunRequest({
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: '  Add filters  ',
    activeSnapshotId: 'snapshot_123'
  }), {
    chatId: 'chat_123',
    projectId: 'project_123',
    prompt: 'Add filters',
    mode: 'edit'
  });
  assert.throws(
    () => buildEditRunRequest({
      chatId: 'chat_123',
      projectId: 'project_123',
      prompt: 'Add filters',
      activeSnapshotId: undefined
    }),
    /active snapshot/
  );
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --import tsx --test apps/web/src/lib/chatWorkspace.test.ts
```

Expected: FAIL because `chatWorkspace.ts` does not exist.

- [x] **Step 3: Implement the pure helpers**

Create `apps/web/src/lib/chatWorkspace.ts`:

```ts
export interface RoutedChat {
  projectId?: string;
}

export const buildChatPath = (chatId: string): string =>
  `/v0/chats/${encodeURIComponent(chatId)}`;

export const resolveRoutedProjectId = (chat: RoutedChat): string => {
  if (!chat.projectId) {
    throw new Error('This chat is not associated with a project');
  }
  return chat.projectId;
};

export const buildEditRunRequest = (input: {
  chatId: string;
  projectId: string;
  prompt: string;
  activeSnapshotId?: string;
}) => {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Prompt is required');
  if (!input.activeSnapshotId) throw new Error('Edit mode requires an active snapshot');
  return {
    chatId: input.chatId,
    projectId: input.projectId,
    prompt,
    mode: 'edit' as const
  };
};
```

- [x] **Step 4: Type the Chat API**

In `apps/web/src/services/api.ts`, introduce the routed Chat shape and update
creation:

```ts
export interface RoutedChat {
  _id: string;
  projectId?: string;
  title: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
  }>;
}

export const chatApi = {
  getAll: () => api.get<{ chats: RoutedChat[] }>('/api/chat'),
  getById: (id: string) => api.get<{ chat: RoutedChat }>(`/api/chat/${id}`),
  create: (titleSeed: string, projectId: string) =>
    api.post<{ chat: RoutedChat }>('/api/chat', { titleSeed, projectId }),
  // retain update/delete and type append-only sendMessage
};
```

- [x] **Step 5: Define application routes**

Update `apps/web/src/App.tsx`:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { V0Clone } from '@/pages/V0Clone';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<V0Clone />} />
        <Route path="/v0/chats/:chatId" element={<V0Clone />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [x] **Step 6: Run Web tests/type-check and commit**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
```

Expected: all tests pass and type-check exits with code 0.

```bash
git add apps/web/src/App.tsx apps/web/src/services/api.ts \
  apps/web/src/lib/chatWorkspace.ts apps/web/src/lib/chatWorkspace.test.ts
git commit -m "feat: add chat workspace routing"
```

### Task 4: Load Routed Conversations and Start the First Run

**Files:**
- Modify: `apps/web/src/pages/V0Clone.tsx`
- Modify: `apps/web/src/lib/v0Workspace.ts`
- Modify: `apps/web/src/lib/v0Workspace.test.ts`

- [x] **Step 1: Add failing workspace-reset coverage**

Add a pure state transition to `apps/web/src/lib/v0Workspace.test.ts`:

```ts
import { resetWorkspaceForChat } from './v0Workspace';

test('resetWorkspaceForChat clears stale project state for a new route', () => {
  const previous = applyWorkspaceSnapshot(createInitialWorkspaceState(), snapshot);
  const next = resetWorkspaceForChat(previous);
  assert.equal(next.screen, 'workspace');
  assert.equal(next.prompt, '');
  assert.equal(next.snapshot, undefined);
  assert.deepEqual(next.snapshots, []);
  assert.deepEqual(next.runHistory, []);
  assert.equal(next.generation.status, 'idle');
});
```

Use the existing Snapshot fixture in that test file.

- [x] **Step 2: Run the focused state test and verify RED**

Run:

```bash
npm test --workspace @v0/web -- --test-name-pattern="resetWorkspaceForChat"
```

Expected: FAIL because the transition is not exported.

- [x] **Step 3: Implement route reset state**

Add to `apps/web/src/lib/v0Workspace.ts`:

```ts
export const resetWorkspaceForChat = (state: WorkspaceState): WorkspaceState => ({
  ...createInitialWorkspaceState(),
  selectedTemplateId: state.selectedTemplateId,
  screen: 'workspace'
});
```

- [x] **Step 4: Make `V0Clone` route-aware**

In `apps/web/src/pages/V0Clone.tsx`:

```tsx
import { useNavigate, useParams } from 'react-router-dom';
import {
  buildChatPath,
  buildEditRunRequest,
  resolveRoutedProjectId
} from '@/lib/chatWorkspace';

const navigate = useNavigate();
const { chatId } = useParams<{ chatId: string }>();
const [projectId, setProjectId] = useState('');
const [routeError, setRouteError] = useState<string>();
```

Remove `localStorage.getItem('v0.activeProjectId')` as the project initializer.
Add a `chatId` effect that aborts the previous monitor, resets the workspace,
loads the Chat and its Project state, and guards writes with a route request
ID:

```tsx
const routeRequestRef = useRef(0);

useEffect(() => {
  const requestId = ++routeRequestRef.current;
  monitorControllerRef.current?.abort();
  monitorControllerRef.current = null;
  setRouteError(undefined);

  if (!chatId) {
    setProjectId('');
    setWorkspace(createInitialWorkspaceState());
    return;
  }

  setProjectId('');
  setWorkspace((state) => resetWorkspaceForChat(state));
  void (async () => {
    try {
      const chatResponse = await chatApi.getById(chatId);
      const routedProjectId = resolveRoutedProjectId(chatResponse.data.chat);
      if (requestId !== routeRequestRef.current) return;
      setProjectId(routedProjectId);

      const snapshots = await refreshProjectData(routedProjectId);
      if (requestId !== routeRequestRef.current) return;
      const activeSnapshotId = snapshots?.find((snapshot) => snapshot.isActive)?.id;
      if (!activeSnapshotId) return;

      const snapshotResponse = await projectApi.getSnapshot(
        routedProjectId,
        activeSnapshotId
      );
      if (requestId !== routeRequestRef.current) return;
      setWorkspace((state) => applyWorkspaceSnapshot(
        state,
        snapshotResponse.data.snapshot
      ));
    } catch (error) {
      if (requestId !== routeRequestRef.current) return;
      setRouteError(getErrorMessage(error));
    }
  })();

  return () => {
    routeRequestRef.current += 1;
  };
}, [chatId]);
```

When no `chatId` is present, render the home state and do not restore a Project
from local storage.

- [x] **Step 5: Create Project, Chat, and Create Run from home**

Replace `createDemoProject` with an authenticated Project+Chat setup. In the
no-`chatId` branch of `submitPromptToAgent`:

```ts
const activeProjectId = await createDemoProject(prompt);
const chatResponse = await chatApi.create(prompt, activeProjectId);
const activeChatId = chatResponse.data.chat._id;
const runResponse = await agentApi.createRun({
  projectId: activeProjectId,
  chatId: activeChatId,
  prompt,
  mode: 'create'
});
setProjectId(activeProjectId);
navigate(buildChatPath(activeChatId));
```

The routed branch must call `buildEditRunRequest` with the active Snapshot ID
and never infer `mode` from stale local state.

Change New Chat/back-home behavior to abort active work and
`navigate('/')`.

- [x] **Step 6: Run Web verification and commit**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all commands exit with code 0.

```bash
git add apps/web/src/pages/V0Clone.tsx \
  apps/web/src/lib/v0Workspace.ts apps/web/src/lib/v0Workspace.test.ts
git commit -m "feat: load conversations by chat route"
```

### Task 5: Add the Fixed Multiturn Composer

**Files:**
- Create: `apps/web/src/components/WorkspaceEditComposer.tsx`
- Modify: `apps/web/src/pages/V0Clone.tsx`
- Modify: `tests/smoke/workspace.spec.ts`

- [x] **Step 1: Extend browser smoke with failing UI expectations**

After the first Run completes in `tests/smoke/workspace.spec.ts`, assert:

```ts
await expect(page).toHaveURL(/\/v0\/chats\/[a-f\d]{24}$/);
await expect(page.getByText('Recent', { exact: true })).toHaveCount(0);

const editComposer = page.getByTestId('workspace-edit-composer');
await expect(editComposer).toBeVisible();
await editComposer.getByRole('textbox').fill('Add a compact activity section');
await editComposer.getByRole('button', { name: 'Send edit' }).click();
await expect(editComposer.getByRole('textbox')).toBeDisabled();
await expect(editComposer.getByRole('button', { name: '正在生成' })).toBeDisabled();
await expect(page.getByTestId('agent-generation-status'))
  .toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
await expect(editComposer.getByRole('textbox')).toHaveValue('');
```

- [x] **Step 2: Run browser smoke and verify RED**

Run on alternate ports:

```bash
SMOKE_API_PORT=43002 \
SMOKE_API_URL=http://127.0.0.1:43002 \
SMOKE_WEB_PORT=4174 \
SMOKE_WEB_URL=http://127.0.0.1:4174 \
npm run test:smoke
```

Expected: FAIL because the URL remains `/` and no workspace edit composer
exists.

- [x] **Step 3: Implement the focused composer component**

Create `apps/web/src/components/WorkspaceEditComposer.tsx`:

```tsx
import { FormEvent, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';

export function WorkspaceEditComposer({
  value,
  disabled,
  canSubmit,
  onChange,
  onSubmit
}: {
  value: string;
  disabled: boolean;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSubmit && !disabled) onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="border-t border-neutral-200 bg-white p-3"
      data-testid="workspace-edit-composer"
      onSubmit={submit}
    >
      <div className="rounded-xl border border-neutral-200 bg-white p-2 shadow-sm focus-within:border-neutral-400">
        <textarea
          className="max-h-36 min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none disabled:text-neutral-400"
          aria-label="Edit prompt"
          placeholder="描述下一步修改…"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            aria-label={disabled ? '正在生成' : 'Send edit'}
            disabled={!canSubmit || disabled}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-neutral-950 px-3 text-xs font-medium text-white disabled:bg-neutral-300"
          >
            {disabled ? '正在生成' : <><Send className="h-3.5 w-3.5" />发送</>}
          </button>
        </div>
      </div>
    </form>
  );
}
```

- [x] **Step 4: Place the composer and remove workspace history**

In `WorkspaceScreen`, delete the search box and `Recent`/`runHistory` nav.
Keep the outer sidebar minimal. Add props for edit draft and submission, then
place `WorkspaceEditComposer` after the left panel's scrollable content:

```tsx
<WorkspaceEditComposer
  value={editDraft}
  disabled={state.generation.status === 'running' || submissionPending}
  canSubmit={Boolean(state.snapshot) && Boolean(editDraft.trim())}
  onChange={onEditDraftChange}
  onSubmit={onSubmitEdit}
/>
```

Keep the progress content in `flex-1 overflow-y-auto`; the composer itself must
not be inside that scroll container.

- [x] **Step 5: Implement draft lifecycle in the parent**

Add `editDraft` independently from the home `draftPrompt`. On submission,
capture the exact submitted string. Clear it only when the resulting detail is
`completed` and the current draft still equals that submitted value:

```ts
const submittedEdit = editDraft.trim();
const detail = await monitorAgentRun({
  runId,
  token,
  signal: controller.signal,
  onEvent: (event) => {
    setWorkspace((state) => applyAgentEvent(state, runId, event));
  }
});
setWorkspace((state) => applyAgentRunDetail(state, detail));
if (detail.run.status === 'completed') {
  setEditDraft((current) =>
    current.trim() === submittedEdit ? '' : current
  );
}
```

Failure and cancellation paths do not clear `editDraft`. Disable the composer
from the synchronous submission-in-flight state through terminal Run state.

- [x] **Step 6: Run browser and Web verification**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
SMOKE_API_PORT=43002 \
SMOKE_API_URL=http://127.0.0.1:43002 \
SMOKE_WEB_PORT=4174 \
SMOKE_WEB_URL=http://127.0.0.1:4174 \
npm run test:smoke
```

Expected: 0 failures; Playwright completes both Create and Edit within the
timeout.

- [x] **Step 7: Commit the composer**

```bash
git add apps/web/src/components/WorkspaceEditComposer.tsx \
  apps/web/src/pages/V0Clone.tsx tests/smoke/workspace.spec.ts
git commit -m "feat: add workspace edit composer"
```

### Task 6: End-to-End API and Real Provider Verification

**Files:**
- Modify: `tests/smoke/api-smoke.ts`
- Modify: `docs/superpowers/plans/2026-07-25-chat-routed-multiturn-workspace.md`

- [x] **Step 1: Extend deterministic API smoke to two turns**

After Project creation in `tests/smoke/api-smoke.ts`, create a Chat:

```ts
const chatResponse = await requestJson<{ chat: { _id: string } }>(
  '/api/chat',
  jsonRequest('POST', {
    projectId,
    titleSeed: `Build deterministic smoke dashboard ${unique}`
  }, token)
);
const chatId = chatResponse.chat._id;
```

Include `chatId` in the Create Run. After its completed Snapshot becomes
active, create and poll an Edit Run:

```ts
const edited = await requestJson<RunDetail>(
  '/api/agent/runs',
  jsonRequest('POST', {
    projectId,
    chatId,
    prompt: `Add deterministic activity section ${unique}`,
    mode: 'edit'
  }, token)
);
const editedDetail = await waitForTerminalRun(edited.run._id, token);
assert.equal(editedDetail.run.status, 'completed');
```

Fetch `/api/chat/:chatId` and assert roles are exactly:

```ts
assert.deepEqual(
  chat.chat.messages.map((message) => message.role),
  ['user', 'assistant', 'user', 'assistant']
);
```

Extract the existing polling loop into the shown `waitForTerminalRun` helper so
both runs share identical timeout behavior.

- [x] **Step 2: Run the full deterministic smoke**

Run:

```bash
SMOKE_API_PORT=43002 \
SMOKE_API_URL=http://127.0.0.1:43002 \
SMOKE_WEB_PORT=4174 \
SMOKE_WEB_URL=http://127.0.0.1:4174 \
npm run test:smoke
```

Expected: API and Playwright smoke pass; the Chat has four alternating
messages and the browser remains on its Chat route after reload.

- [x] **Step 3: Run all automated verification**

Run:

```bash
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all tests pass and all type-check/build commands exit with code 0.

- [x] **Step 4: Rebuild the retained real DeepSeek stack**

Run:

```bash
docker compose \
  -p phase6-manual \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f work/docker-compose.real-validation.yml \
  up -d --build --force-recreate server worker web
```

Verify all containers are healthy and Worker logs
`Agent worker listening`, not `Smoke agent worker listening`.

- [x] **Step 5: Perform one real Create-then-Edit conversation**

From `http://127.0.0.1:4173`:

1. submit a new Create prompt;
2. verify navigation to `/v0/chats/:chatId`;
3. wait for the generated Snapshot preview;
4. submit an Edit prompt from the fixed composer;
5. verify the composer shows `正在生成` and is disabled;
6. verify the Edit Run completes and the preview uses the new active Snapshot;
7. reload the Chat URL and verify the same Project/Snapshot restores;
8. verify the persisted Chat roles are
   `user, assistant, user, assistant`.

- [x] **Step 6: Review state and record results**

Run:

```bash
git diff --check
git status --short
git log -10 --oneline
```

Add exact test counts, smoke result, real Run IDs, Snapshot IDs, and any
remaining warnings to the plan's `Execution Results` section.

- [x] **Step 7: Commit the completed plan record**

```bash
git add tests/smoke/api-smoke.ts \
  docs/superpowers/plans/2026-07-25-chat-routed-multiturn-workspace.md
git commit -m "docs: complete chat multiturn plan"
```

## Execution Results

- Chat creation is now metadata-only and deterministic; it associates the Chat
  with its Project without calling the legacy code-generation service.
- Creating an Agent Run with `chatId` persists exactly one user message.
  Worker completion persists one assistant message with the resulting Snapshot,
  and replaying a completed job does not duplicate it.
- The frontend now routes conversations through `/v0/chats/:chatId`. Direct
  route loads resolve `projectId`, Run history, active Snapshot, and preview
  without relying on `localStorage.v0.activeProjectId`.
- The workspace sidebar no longer contains recent-chat history. The left
  workspace panel has a fixed composer that submits Edit runs, supports
  Enter/Shift+Enter, disables during submission, and displays `正在生成`.
- Server verification passed: 86 unit tests and 12 integration tests;
  type-check and build both exited successfully.
- Web verification passed: 57 tests; type-check and build both exited
  successfully. Vite retains the existing `SnapshotPreview` large-chunk
  warning.
- Deterministic two-turn smoke passed on ports `43002` and `4174`: API verified
  `user, assistant, user, assistant`, and Playwright verified the dedicated
  route, removed history region, disabled composer state, Edit completion,
  cleared draft, and reload restoration.
- Real DeepSeek Create Run `6a648fe1a80bc0f5256357aa` completed with Snapshot
  `6a64902ef083d0b8e66bc46d`.
- Real DeepSeek Edit Run `6a649030a80bc0f525635809` used that Snapshot as
  `baseSnapshotId` and completed with Snapshot
  `6a649078f083d0b8e66bc498`.
- Real Chat `6a648fe1a80bc0f5256357a3`, associated with Project
  `6a648fe1a80bc0f52563579f`, persisted the expected four alternating roles.
  Its routed page is
  `http://127.0.0.1:4173/v0/chats/6a648fe1a80bc0f5256357a3`.
