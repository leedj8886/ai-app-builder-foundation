# Chat History Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a five-item recent-chat section to the Workspace sidebar and a read-only `/v0/chats` page for opening every prior conversation.

**Architecture:** Extend the existing authenticated Chat list response with a bounded first-user-message preview. Model Chat-list loading and presentation with pure frontend helpers, render a shared recent-list component plus a dedicated history page, and connect them to the existing routed Workspace without changing the generation flow.

**Tech Stack:** Node.js, Express, MongoDB/Mongoose, TypeScript, React 18, React Router, Tailwind CSS, Node test runner, Supertest, Playwright

---

## Working Tree Guard

The implementation starts with unrelated uncommitted changes in:

- `apps/server/src/agent/orchestrator.ts`
- `apps/server/src/agent/orchestrator.test.ts`
- `apps/web/src/components/ConversationTimeline.tsx`
- `apps/web/src/lib/chatTimeline.ts`
- `apps/web/src/lib/chatTimeline.test.ts`

Preserve these files and exclude them from every history-page commit. The
`.superpowers/` visual-companion directory is local-only and must not be
committed. Stage only the explicit files listed in each task.

## File Map

- Create `apps/server/src/chat/chatList.ts`: bounded Chat preview projection.
- Create `apps/server/src/chat/chatList.test.ts`: projection unit tests.
- Modify `apps/server/src/routes/chat.ts`: return projected list items.
- Modify `apps/server/src/integration/agentRoutes.integration.ts`: verify
  ownership, ordering, preview bounds, and absent previews.
- Modify `apps/web/src/services/api.ts`: expose `ChatListItem`.
- Create `apps/web/src/lib/chatHistory.ts`: loading state, recent selection, and
  display-time helpers.
- Create `apps/web/src/lib/chatHistory.test.ts`: pure state/helper tests.
- Create `apps/web/src/components/RecentChats.tsx`: compact collapsible sidebar
  list.
- Create `apps/web/src/pages/ChatHistoryPage.tsx`: full read-only history page.
- Modify `apps/web/src/pages/V0Clone.tsx`: load and render recent Chats.
- Modify `apps/web/src/App.tsx`: add `/v0/chats`.
- Modify `tests/smoke/workspace.spec.ts`: verify recent and full-history
  navigation.
- Modify `docs/superpowers/plans/2026-07-25-chat-history-page.md`: record exact
  execution results.

### Task 1: Project Chat List Items on the Server

**Files:**
- Create: `apps/server/src/chat/chatList.ts`
- Create: `apps/server/src/chat/chatList.test.ts`
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`

- [ ] **Step 1: Write failing projection tests**

Create `apps/server/src/chat/chatList.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectChatListItem } from './chatList';

test('uses and bounds the first user message as preview', () => {
  const item = projectChatListItem({
    _id: '66a3f4402f24b17418d55abc',
    title: 'Dashboard',
    messages: [
      { role: 'system', content: 'ignored' },
      { role: 'user', content: `  ${'x'.repeat(220)}  ` },
      { role: 'user', content: 'ignored second prompt' }
    ],
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    updatedAt: new Date('2026-07-25T11:00:00.000Z')
  });

  assert.equal(item.preview, `${'x'.repeat(157)}...`);
  assert.equal(item.updatedAt, '2026-07-25T11:00:00.000Z');
  assert.equal('messages' in item, false);
});

test('omits preview when a Chat has no user message', () => {
  const item = projectChatListItem({
    _id: '66a3f4402f24b17418d55abd',
    title: 'Empty',
    messages: [],
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    updatedAt: new Date('2026-07-25T10:00:00.000Z')
  });

  assert.equal(item.preview, undefined);
});
```

- [ ] **Step 2: Run the projection test and verify RED**

Run:

```bash
npm test --workspace @v0/server -- --test-name-pattern="first user message|no user message"
```

Expected: FAIL because `chatList.ts` does not exist.

- [ ] **Step 3: Implement the bounded projection**

Create `apps/server/src/chat/chatList.ts` with:

```ts
const PREVIEW_LENGTH = 160;

interface ChatListSource {
  _id: { toString(): string } | string;
  projectId?: { toString(): string } | string;
  title: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatListItem {
  _id: string;
  projectId?: string;
  title: string;
  preview?: string;
  createdAt: string;
  updatedAt: string;
}

export const projectChatListItem = (
  chat: ChatListSource
): ChatListItem => {
  const content = chat.messages
    .find(message => message.role === 'user')
    ?.content.trim().replace(/\s+/g, ' ');
  const preview = content
    ? content.length <= PREVIEW_LENGTH
      ? content
      : `${content.slice(0, PREVIEW_LENGTH - 3)}...`
    : undefined;

  return {
    _id: chat._id.toString(),
    ...(chat.projectId ? { projectId: chat.projectId.toString() } : {}),
    title: chat.title,
    ...(preview ? { preview } : {}),
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString()
  };
};
```

Update `GET /api/chat` in `apps/server/src/routes/chat.ts` to select the fields
needed for projection, call `.lean()`, and return:

```ts
res.json({ chats: chats.map(projectChatListItem) });
```

- [ ] **Step 4: Add failing integration assertions**

In `apps/server/src/integration/agentRoutes.integration.ts`, add a test that:

- creates two owned Chats with deterministic `updatedAt` values;
- gives the older Chat a system message followed by a 220-character user
  message;
- creates one Chat owned by another user;
- requests `GET /api/chat` with the owner token;
- asserts newest-first ordering, exactly two results, a 160-character bounded
  preview, no `messages` property, and no stranger Chat.

- [ ] **Step 5: Run backend verification**

Run:

```bash
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: all Server unit and integration tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the Server list projection**

```bash
git add \
  apps/server/src/chat/chatList.ts \
  apps/server/src/chat/chatList.test.ts \
  apps/server/src/routes/chat.ts \
  apps/server/src/integration/agentRoutes.integration.ts
git commit -m "feat: expose chat history list items"
```

### Task 2: Model Chat History State on the Web

**Files:**
- Modify: `apps/web/src/services/api.ts`
- Create: `apps/web/src/lib/chatHistory.ts`
- Create: `apps/web/src/lib/chatHistory.test.ts`

- [ ] **Step 1: Write failing state and display tests**

Create `apps/web/src/lib/chatHistory.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createChatHistoryState,
  failChatHistory,
  formatChatUpdatedAt,
  loadChatHistory,
  selectRecentChats
} from './chatHistory';

const chats = Array.from({ length: 7 }, (_, index) => ({
  _id: String(index),
  title: `Chat ${index}`,
  preview: `Prompt ${index}`,
  createdAt: `2026-07-${String(25 - index).padStart(2, '0')}T10:00:00.000Z`,
  updatedAt: `2026-07-${String(25 - index).padStart(2, '0')}T11:00:00.000Z`
}));

test('selects at most five recent Chats', () => {
  assert.deepEqual(selectRecentChats(chats).map(chat => chat._id),
    ['0', '1', '2', '3', '4']);
});

test('models loading ready and error states', () => {
  const loading = loadChatHistory(createChatHistoryState());
  assert.equal(loading.status, 'loading');
  const ready = loadChatHistory(loading, chats);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.chats.length, 7);
  const failed = failChatHistory(ready, 'Unable to load conversations');
  assert.equal(failed.status, 'error');
  assert.equal(failed.chats.length, 7);
});

test('formats same-day and older updated times', () => {
  const now = new Date('2026-07-25T12:00:00+08:00');
  assert.equal(
    formatChatUpdatedAt('2026-07-25T11:00:00+08:00', now, 'zh-CN'),
    '11:00'
  );
  assert.match(
    formatChatUpdatedAt('2026-07-20T11:00:00+08:00', now, 'zh-CN'),
    /7月20日/
  );
});
```

- [ ] **Step 2: Run the Web test and verify RED**

Run:

```bash
npm test --workspace @v0/web -- --test-name-pattern="recent Chats|loading ready|updated times"
```

Expected: FAIL because `chatHistory.ts` does not exist.

- [ ] **Step 3: Add the API type**

In `apps/web/src/services/api.ts`, add:

```ts
export interface ChatListItem {
  _id: string;
  projectId?: string;
  title: string;
  preview?: string;
  createdAt: string;
  updatedAt: string;
}
```

Change `chatApi.getAll` to:

```ts
getAll: () => api.get<{ chats: ChatListItem[] }>('/api/chat')
```

- [ ] **Step 4: Implement pure Chat history state**

Create `apps/web/src/lib/chatHistory.ts` with:

```ts
import type { ChatListItem } from '@/services/api';

export interface ChatHistoryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  chats: ChatListItem[];
  error?: string;
}

export const createChatHistoryState = (): ChatHistoryState => ({
  status: 'idle',
  chats: []
});

export function loadChatHistory(
  state: ChatHistoryState,
  chats?: ChatListItem[]
): ChatHistoryState {
  return chats
    ? { status: 'ready', chats }
    : { ...state, status: 'loading', error: undefined };
}

export const failChatHistory = (
  state: ChatHistoryState,
  error: string
): ChatHistoryState => ({ ...state, status: 'error', error });

export const selectRecentChats = (
  chats: ChatListItem[]
): ChatListItem[] => chats.slice(0, 5);
```

Also implement `formatChatUpdatedAt` with `Intl.DateTimeFormat`: use hour/minute
for the same local calendar day, `昨天` for the previous local calendar day,
and month/day for older records.

- [ ] **Step 5: Run Web unit and type verification**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
```

Expected: all Web tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the Web state model**

```bash
git add \
  apps/web/src/services/api.ts \
  apps/web/src/lib/chatHistory.ts \
  apps/web/src/lib/chatHistory.test.ts
git commit -m "feat: model chat history state"
```

### Task 3: Render Recent Chats and the Full History Page

**Files:**
- Create: `apps/web/src/components/RecentChats.tsx`
- Create: `apps/web/src/pages/ChatHistoryPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/lib/chatHistory.test.ts`

- [ ] **Step 1: Add failing presentation-helper tests**

Extend `apps/web/src/lib/chatHistory.test.ts` to assert:

```ts
import { getChatAccessibleName, isActiveChat } from './chatHistory';

test('marks and labels the active Chat', () => {
  assert.equal(isActiveChat('abc', 'abc'), true);
  assert.equal(isActiveChat('abc', undefined), false);
  assert.equal(
    getChatAccessibleName({ ...chats[0], title: 'Dashboard' }),
    '打开对话：Dashboard'
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test --workspace @v0/web -- --test-name-pattern="active Chat"
```

Expected: FAIL because the presentation helpers are not exported.

- [ ] **Step 3: Implement `RecentChats`**

Create `apps/web/src/components/RecentChats.tsx` with props:

```ts
interface RecentChatsProps {
  state: ChatHistoryState;
  activeChatId?: string;
  onRetry: () => void;
}
```

The component must:

- render a disclosure button labelled `最近聊天`;
- default to expanded and expose `aria-expanded`;
- render at most `selectRecentChats(state.chats)` as React Router `Link`s;
- set `aria-current="page"` for the active Chat;
- show compact skeleton rows while initially loading;
- keep stale rows visible during a failed refresh and show a retry action;
- render `More` as a link to `/v0/chats`;
- omit `More` in the empty state.

- [ ] **Step 4: Implement the full history page**

Create `apps/web/src/pages/ChatHistoryPage.tsx`. On mount it calls
`chatApi.getAll()`, transitions the pure state, and renders:

- a back/home brand control;
- `对话历史` and `按最近更新时间排列`;
- a `New chat` link to `/`;
- a loading skeleton, empty state, error/retry state, or all rows;
- each ready row as a `Link` to `buildChatPath(chat._id)`;
- title, optional preview, and `formatChatUpdatedAt(chat.updatedAt)`.

Use a centered `max-w-4xl` content column and mobile-safe padding.

- [ ] **Step 5: Register the route**

Modify `apps/web/src/App.tsx`:

```tsx
<Route path="/v0/chats" element={<ChatHistoryPage />} />
<Route path="/v0/chats/:chatId" element={<V0Clone />} />
```

Keep the static route before the parameterized route for readability.

- [ ] **Step 6: Run component boundary verification**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all Web tests, type checking, and the production build pass. Record
the existing Preview chunk warning if it remains.

- [ ] **Step 7: Commit the history UI**

```bash
git add \
  apps/web/src/components/RecentChats.tsx \
  apps/web/src/pages/ChatHistoryPage.tsx \
  apps/web/src/App.tsx \
  apps/web/src/lib/chatHistory.ts \
  apps/web/src/lib/chatHistory.test.ts
git commit -m "feat: add chat history page"
```

### Task 4: Connect Recent Chats to the Workspace

**Files:**
- Modify: `apps/web/src/pages/V0Clone.tsx`
- Modify: `tests/smoke/workspace.spec.ts`

- [ ] **Step 1: Add Workspace integration state**

In `apps/web/src/pages/V0Clone.tsx`:

- add `chatHistory` state initialized by `createChatHistoryState()`;
- add a memoized or stable `loadChatHistory` callback that calls
  `chatApi.getAll()` and preserves the active Workspace on failure;
- load recent Chats when a routed Workspace mounts and after a new Chat is
  created;
- pass state, `chatId`, and retry to `WorkspaceScreen`.

- [ ] **Step 2: Render recent Chats below `New chat`**

Update the expanded sidebar in `WorkspaceScreen`:

```tsx
<RecentChats
  state={chatHistory}
  activeChatId={chatId}
  onRetry={onRetryChatHistory}
/>
```

Place it below the top action row and above the flexible spacer. Do not modify
the existing Timeline, composer, Preview/Code panels, or sidebar-collapse
behavior.

- [ ] **Step 3: Extend the smoke test**

Update `tests/smoke/workspace.spec.ts` to:

- create and complete a Chat through the existing generation flow;
- assert `最近聊天` contains and highlights the routed Chat;
- collapse and re-expand the sidebar and verify the recent section returns;
- click `More` and expect `/v0/chats`;
- assert the full history row shows the Chat title or prompt preview;
- click the row and expect the original `/v0/chats/:chatId`;
- click `New chat` on the history page and expect `/`.

Use role-based locators and the existing 90-second generation timeout.

- [ ] **Step 4: Run deterministic end-to-end verification**

Run the existing deterministic smoke stack and:

```bash
SMOKE_WEB_URL=http://127.0.0.1:4174 npm run test:smoke
```

Expected: API smoke and the Playwright Workspace scenario pass.

- [ ] **Step 5: Run full repository verification**

Run:

```bash
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
git diff --check
```

Expected: every command exits 0. Record exact test counts and build warnings.

- [ ] **Step 6: Commit Workspace and smoke integration**

```bash
git add \
  apps/web/src/pages/V0Clone.tsx \
  tests/smoke/workspace.spec.ts
git commit -m "feat: connect recent chats to workspace"
```

### Task 5: Refresh Services and Record Results

**Files:**
- Modify: `docs/superpowers/plans/2026-07-25-chat-history-page.md`

- [ ] **Step 1: Refresh the retained local stack**

Run:

```bash
docker compose \
  -p phase6-manual \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f work/docker-compose.real-validation.yml \
  up -d --build
```

- [ ] **Step 2: Verify service health**

Run:

```bash
docker compose \
  -p phase6-manual \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f work/docker-compose.real-validation.yml \
  ps
curl -fsS http://127.0.0.1:43001/health
```

Expected: Web, API, Worker, MongoDB, and Redis are running; API health is `ok`.

- [ ] **Step 3: Record execution results**

Append an `Execution Results` section containing:

- exact implementation commits;
- Server unit and integration counts;
- Web unit count;
- smoke result;
- type-check and build results;
- retained service status;
- build warnings;
- preserved unrelated working-tree changes.

- [ ] **Step 4: Commit the completed plan**

```bash
git add docs/superpowers/plans/2026-07-25-chat-history-page.md
git commit -m "docs: complete chat history plan"
```

- [ ] **Step 5: Verify final local Git state**

Run:

```bash
git status --short
git log -8 --oneline
```

Expected: only the pre-existing guarded changes and local `.superpowers/`
directory remain uncommitted. Do not push.
