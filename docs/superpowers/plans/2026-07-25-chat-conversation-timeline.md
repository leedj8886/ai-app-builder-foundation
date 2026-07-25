# Chat Conversation Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workspace's flat Agent Plan panel with a persistent chronological timeline of user messages, structured Agent activity, results, and collapsible historical turns.

**Architecture:** Add a Chat-scoped backend read model that aggregates `AgentRun`, sequenced `AgentEvent`, and result `ProjectSnapshot` records into cursor-paginated turns. Add a frontend timeline state module and focused React components, then merge SSE events into the active turn while keeping the existing Preview/Code workspace and composer.

**Tech Stack:** Node.js, Express, MongoDB/Mongoose, TypeScript, React 18, Tailwind CSS, SSE, Node test runner, Supertest, Playwright

---

## Working Tree Guard

The implementation starts with unrelated uncommitted changes in:

- `apps/server/src/agent/orchestrator.ts`
- `apps/server/src/agent/orchestrator.test.ts`

Preserve both files and exclude them from every timeline commit. Stage only the
explicit files listed in each task. The `.superpowers/` visual-companion
directory is also local-only and must not be committed.

## File Map

- Create `apps/server/src/agent/chatTimeline.ts`: timeline response types,
  cursor parsing, Run/Event/Snapshot projection, and degraded-state handling.
- Create `apps/server/src/agent/chatTimeline.test.ts`: pure projection and cursor
  tests.
- Modify `apps/server/src/models/AgentRun.ts`: add the Chat timeline query index.
- Modify `apps/server/src/routes/chat.ts`: expose the authenticated timeline
  endpoint.
- Modify `apps/server/src/integration/agentRoutes.integration.ts`: verify
  authorization, ordering, pagination, plan projection, and terminal states.
- Modify `apps/server/src/agent/testing/fakeModelClient.ts`: make deterministic
  Edit generation produce an effective file update for smoke validation.
- Modify `apps/web/src/services/api.ts`: add timeline API response types and
  client method.
- Create `apps/web/src/lib/chatTimeline.ts`: frontend state, expansion rules,
  event deduplication, duration formatting, and page merging.
- Create `apps/web/src/lib/chatTimeline.test.ts`: pure frontend timeline tests.
- Create `apps/web/src/components/ConversationTimeline.tsx`: timeline,
  user-message, Agent-turn, activity, summary, and Snapshot presentation.
- Modify `apps/web/src/pages/V0Clone.tsx`: load timeline pages, merge SSE events,
  refetch terminal turns, and replace the old Agent Plan block.
- Modify `tests/smoke/workspace.spec.ts`: verify two chronological turns,
  collapse rules, live progress, and reload restoration.
- Modify `docs/superpowers/plans/2026-07-25-chat-conversation-timeline.md`:
  record exact execution results.

### Task 1: Build the Backend Timeline Projection

**Files:**
- Create: `apps/server/src/agent/chatTimeline.ts`
- Create: `apps/server/src/agent/chatTimeline.test.ts`
- Modify: `apps/server/src/models/AgentRun.ts`

- [ ] **Step 1: Write failing projection and cursor tests**

Create `apps/server/src/agent/chatTimeline.test.ts` with focused tests:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatTimelineTurn,
  decodeTimelineCursor,
  encodeTimelineCursor
} from './chatTimeline';

test('cursor round-trips createdAt and id', () => {
  const boundary = {
    createdAt: new Date('2026-07-25T10:00:00.000Z'),
    id: '66a3f4402f24b17418d55abc'
  };
  assert.deepEqual(
    decodeTimelineCursor(encodeTimelineCursor(boundary)),
    boundary
  );
});

test('projects a completed Run into an auditable timeline turn', () => {
  const turn = buildChatTimelineTurn({
    run: {
      _id: '66a3f4402f24b17418d55abc',
      prompt: 'Add an activity list',
      status: 'completed',
      model: 'deepseek-chat',
      createdAt: new Date('2026-07-25T10:00:00.000Z'),
      startedAt: new Date('2026-07-25T10:00:01.000Z'),
      completedAt: new Date('2026-07-25T10:00:09.000Z')
    },
    events: [
      {
        type: 'run.started',
        sequence: 1,
        message: 'Worker started',
        createdAt: new Date('2026-07-25T10:00:01.000Z')
      },
      {
        type: 'agent.plan',
        sequence: 2,
        message: 'Add activity UI',
        payload: {
          summary: 'Add activity UI',
          steps: [{
            title: 'Update App',
            intent: 'Render recent activity',
            filesLikelyTouched: ['src/App.tsx']
          }],
          assumptions: []
        },
        createdAt: new Date('2026-07-25T10:00:03.000Z')
      },
      {
        type: 'file.changed',
        sequence: 3,
        message: 'update src/App.tsx',
        payload: { operation: 'update', path: 'src/App.tsx' },
        createdAt: new Date('2026-07-25T10:00:05.000Z')
      }
    ],
    snapshot: {
      _id: '66a3f4402f24b17418d55abd',
      summary: 'Added a compact activity list',
      files: [{ path: 'src/App.tsx', generatedByRunId: '66a3f4402f24b17418d55abc' }]
    }
  });

  assert.equal(turn.userMessage.content, 'Add an activity list');
  assert.equal(turn.agent.durationMs, 8_000);
  assert.equal(turn.agent.planningDurationMs, 2_000);
  assert.equal(turn.agent.plan?.steps[0]?.title, 'Update App');
  assert.deepEqual(turn.snapshot?.changedFiles, ['src/App.tsx']);
});

test('preserves failed and incomplete Runs without requiring a Snapshot', () => {
  const turn = buildChatTimelineTurn({
    run: {
      _id: '66a3f4402f24b17418d55abe',
      prompt: 'Break nothing',
      status: 'failed',
      model: 'deepseek-chat',
      error: { code: 'VALIDATION_FAILED', message: 'Type-check failed' },
      createdAt: new Date('2026-07-25T10:01:00.000Z')
    },
    events: [],
    snapshot: null
  });
  assert.equal(turn.agent.status, 'failed');
  assert.equal(turn.agent.error?.message, 'Type-check failed');
  assert.equal(turn.snapshot, undefined);
});
```

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```bash
npm test --workspace @v0/server -- --test-name-pattern="cursor|timeline turn|incomplete Runs"
```

Expected: FAIL because `chatTimeline.ts` does not exist.

- [ ] **Step 3: Implement the projection and cursor**

Create `apps/server/src/agent/chatTimeline.ts` with exported response types and:

```ts
export const encodeTimelineCursor = (
  boundary: { createdAt: Date; id: string }
): string => Buffer.from(JSON.stringify({
  createdAt: boundary.createdAt.toISOString(),
  id: boundary.id
}), 'utf8').toString('base64url');

export const decodeTimelineCursor = (
  cursor: string
): { createdAt: Date; id: string } => {
  const parsed = JSON.parse(
    Buffer.from(cursor, 'base64url').toString('utf8')
  ) as { createdAt?: unknown; id?: unknown };
  const createdAt = new Date(String(parsed.createdAt));
  if (
    Number.isNaN(createdAt.getTime()) ||
    typeof parsed.id !== 'string' ||
    !/^[a-f\d]{24}$/i.test(parsed.id)
  ) {
    throw Object.assign(new Error('Invalid timeline cursor'), {
      code: 'INVALID_TIMELINE_CURSOR'
    });
  }
  return { createdAt, id: parsed.id };
};
```

Implement `buildChatTimelineTurn` so it:

- sorts events by `sequence`;
- reads a structurally valid plan only from `agent.plan.payload`;
- calculates total and planning duration without negative values;
- deduplicates `file.changed.payload.path` in event order;
- uses `run.prompt` and `run.createdAt` for the user message;
- uses the Snapshot summary as the completed Agent summary;
- returns failed/cancelled Runs even without a Snapshot.

- [ ] **Step 4: Add the query index**

Add to `apps/server/src/models/AgentRun.ts`:

```ts
AgentRunSchema.index({ userId: 1, chatId: 1, createdAt: -1 });
```

- [ ] **Step 5: Run backend unit verification**

Run:

```bash
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: all server unit tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit the backend projection**

```bash
git add \
  apps/server/src/agent/chatTimeline.ts \
  apps/server/src/agent/chatTimeline.test.ts \
  apps/server/src/models/AgentRun.ts
git commit -m "feat: project agent runs into chat turns"
```

### Task 2: Expose the Paginated Chat Timeline API

**Files:**
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/integration/agentRoutes.integration.ts`

- [ ] **Step 1: Write failing integration coverage**

Add an integration test that creates:

- one owner Chat and one stranger;
- 21 Chat-associated Runs with deterministic `createdAt` values;
- a completed Run with `agent.plan`, duplicate `file.changed`, and Snapshot;
- a failed Run with no Snapshot.

Assert:

```ts
const first = await request(app)
  .get(`/api/chat/${chat._id}/timeline?limit=20`)
  .set('Authorization', `Bearer ${ownerToken}`)
  .expect(200);

assert.equal(first.body.turns.length, 20);
assert.equal(first.body.pageInfo.hasMore, true);
assert.ok(first.body.pageInfo.nextBefore);
assert.ok(
  first.body.turns.every(
    (turn: { runId: string }, index: number, turns: Array<{ runId: string }>) =>
      index === 0 || turns[index - 1]!.runId !== turn.runId
  )
);

const older = await request(app)
  .get(`/api/chat/${chat._id}/timeline?limit=20&before=${
    encodeURIComponent(first.body.pageInfo.nextBefore)
  }`)
  .set('Authorization', `Bearer ${ownerToken}`)
  .expect(200);

assert.equal(older.body.turns.length, 1);

await request(app)
  .get(`/api/chat/${chat._id}/timeline`)
  .set('Authorization', `Bearer ${strangerToken}`)
  .expect(404);
```

Also assert that the completed turn contains its plan and one deduplicated
changed path, while the failed turn contains its error.

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
npm run test:integration --workspace @v0/server -- \
  --test-name-pattern="Chat timeline"
```

Expected: FAIL with HTTP 404 because the timeline route does not exist.

- [ ] **Step 3: Implement the route**

In `apps/server/src/routes/chat.ts`, register
`GET /:id/timeline` before `GET /:id`.

Validate:

```ts
const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().trim().min(1).optional()
});
```

Query the Chat by `_id` and `userId`, then query `limit + 1` Runs by
`{ chatId, userId }`. For a cursor boundary, add:

```ts
{
  $or: [
    { createdAt: { $lt: boundary.createdAt } },
    { createdAt: boundary.createdAt, _id: { $lt: boundary.id } }
  ]
}
```

Sort Runs by `{ createdAt: -1, _id: -1 }`, trim to `limit`, fetch all matching
Events and Snapshots in two batched queries, project the turns, then reverse the
page for chronological display.

Return malformed cursors as HTTP 400 with `Invalid timeline cursor`.

- [ ] **Step 4: Run backend verification**

Run:

```bash
npm run test:integration --workspace @v0/server
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: integration, unit, and type checks pass.

- [ ] **Step 5: Commit the timeline endpoint**

```bash
git add \
  apps/server/src/routes/chat.ts \
  apps/server/src/integration/agentRoutes.integration.ts
git commit -m "feat: expose chat conversation timeline"
```

### Task 3: Add Frontend Timeline Types and State Transitions

**Files:**
- Modify: `apps/web/src/services/api.ts`
- Create: `apps/web/src/lib/chatTimeline.ts`
- Create: `apps/web/src/lib/chatTimeline.test.ts`

- [ ] **Step 1: Write failing frontend state tests**

Create `apps/web/src/lib/chatTimeline.test.ts` covering:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendTimelineEvent,
  createTimelineState,
  mergeOlderTimelinePage,
  replaceTimelinePage,
  resolveDefaultExpandedRunIds
} from './chatTimeline';

test('expands active failed and latest completed turns by default', () => {
  const expanded = resolveDefaultExpandedRunIds([
    turn('old', 'completed'),
    turn('latest', 'completed'),
    turn('failed', 'failed'),
    turn('active', 'generating')
  ]);
  assert.deepEqual([...expanded], ['latest', 'failed', 'active']);
});

test('deduplicates streamed events by run id and sequence', () => {
  const initial = replaceTimelinePage(
    createTimelineState(),
    page([turn('active', 'generating')])
  );
  const once = appendTimelineEvent(initial, 'active', event(3));
  const twice = appendTimelineEvent(once, 'active', event(3));
  assert.equal(twice.turns[0]?.agent.events.length, 1);
});

test('prepends older pages without duplicating turns', () => {
  const initial = replaceTimelinePage(
    createTimelineState(),
    page([turn('b', 'completed'), turn('c', 'completed')])
  );
  const merged = mergeOlderTimelinePage(
    initial,
    page([turn('a', 'completed'), turn('b', 'completed')])
  );
  assert.deepEqual(merged.turns.map(turn => turn.runId), ['a', 'b', 'c']);
});
```

Define local `turn`, `event`, and `page` fixture builders in the test file with
complete required fields.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test --workspace @v0/web -- --test-name-pattern="turns by default|streamed events|older pages"
```

Expected: FAIL because `chatTimeline.ts` does not exist.

- [ ] **Step 3: Add API types and client**

In `apps/web/src/services/api.ts`, add exact `ChatTimelineResponse`,
`ChatTimelineTurn`, `ChatTimelineAgent`, and `ChatTimelineEvent` interfaces
matching the backend response.

Add:

```ts
getTimeline: (
  id: string,
  options: { limit?: number; before?: string } = {},
) => api.get<ChatTimelineResponse>(`/api/chat/${id}/timeline`, {
  params: options,
}),
```

- [ ] **Step 4: Implement frontend timeline state**

Create `apps/web/src/lib/chatTimeline.ts` with:

```ts
export interface ChatTimelineState {
  turns: ChatTimelineTurn[]
  expandedRunIds: Set<string>
  loading: boolean
  loadingOlder: boolean
  error?: string
  pageInfo: ChatTimelineResponse['pageInfo']
}

export const createTimelineState = (): ChatTimelineState => ({
  turns: [],
  expandedRunIds: new Set(),
  loading: false,
  loadingOlder: false,
  pageInfo: { hasMore: false }
});
```

Implement pure immutable transitions for:

- replacing the newest page;
- prepending an older page by unique `runId`;
- inserting an optimistic Run returned by createRun;
- applying an SSE event by `runId + sequence`;
- replacing one terminal turn from a refreshed page;
- toggling only terminal turns;
- applying the default expansion rules;
- formatting duration and collapsed status text.

Do not put React hooks or network requests in this module.

- [ ] **Step 5: Run frontend unit and type verification**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
```

Expected: all web tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit timeline state**

```bash
git add \
  apps/web/src/services/api.ts \
  apps/web/src/lib/chatTimeline.ts \
  apps/web/src/lib/chatTimeline.test.ts
git commit -m "feat: model chat conversation timeline"
```

### Task 4: Build the Conversation Timeline Components

**Files:**
- Create: `apps/web/src/components/ConversationTimeline.tsx`
- Modify: `apps/web/src/lib/chatTimeline.test.ts`

- [ ] **Step 1: Add presentation-helper tests**

Extend `chatTimeline.test.ts` to assert:

- a completed collapsed label contains summary, changed-file count, and duration;
- a failed label contains the concise diagnostic;
- planning duration is labelled `规划用时`, never `思考过程`;
- `canToggleTurn` returns false for active statuses and true for terminal
  statuses.

- [ ] **Step 2: Run helper tests and verify RED**

Run:

```bash
npm test --workspace @v0/web -- \
  --test-name-pattern="collapsed label|planning duration|toggle"
```

Expected: FAIL because the presentation helpers are not implemented.

- [ ] **Step 3: Implement presentation helpers**

Add pure helpers to `chatTimeline.ts`:

```ts
export const terminalStatuses = new Set([
  'completed',
  'failed',
  'cancelled'
]);

export const canToggleTurn = (turn: ChatTimelineTurn): boolean =>
  terminalStatuses.has(turn.agent.status);

export const formatPlanningDuration = (durationMs?: number): string | undefined =>
  durationMs === undefined
    ? undefined
    : `规划用时 ${Math.max(1, Math.round(durationMs / 1000))} 秒`;
```

Build the collapsed label from status, summary/error, unique changed-file count,
and total duration.

- [ ] **Step 4: Implement the component tree**

Create `ConversationTimeline.tsx` exporting one public component:

```ts
interface ConversationTimelineProps {
  state: ChatTimelineState
  activeRunId?: string
  onToggleTurn(runId: string): void
  onLoadOlder(): void
  onRetry(): void
  onSelectSnapshot(snapshotId: string): void
  onCancelRun(runId: string): void
}
```

Inside the file, keep private focused components:

- `UserMessage`
- `AgentTurn`
- `TurnSummary`
- `AgentActivity`
- `ImplementationPlan`
- `SnapshotResult`

Requirements:

- use an ordered list with one item per turn;
- use a user bubble aligned right;
- render `aria-expanded` and `aria-controls` on terminal summary buttons;
- keep active turns expanded and hide their toggle;
- show `Stop run` for an active cancellable Run and call `onCancelRun(runId)`;
- render plan steps, assumptions, event rows, final summary, error, Snapshot,
  changed files, and timing;
- use text labels in addition to icons for all statuses;
- expose stable test IDs:
  `conversation-timeline`, `conversation-turn-<runId>`,
  `agent-turn-summary-<runId>`, and `agent-turn-detail-<runId>`;
- show `加载更早对话`, loading, empty, degraded, and retry states.

- [ ] **Step 5: Add bottom-aware autoscroll**

In `ConversationTimeline`, keep a scroll container ref and a bottom sentinel.
Before an update, treat the reader as pinned when:

```ts
scrollHeight - scrollTop - clientHeight <= 80
```

After a new event or turn, scroll the sentinel into view only if pinned. Loading
older pages must preserve the previous scroll height offset.

- [ ] **Step 6: Run component build verification**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: tests, type-check, and production build pass. The existing
`SnapshotPreview` chunk warning may remain.

- [ ] **Step 7: Commit the component**

```bash
git add \
  apps/web/src/components/ConversationTimeline.tsx \
  apps/web/src/lib/chatTimeline.ts \
  apps/web/src/lib/chatTimeline.test.ts
git commit -m "feat: render collapsible agent conversation turns"
```

### Task 5: Integrate Timeline Loading and Realtime Runs

**Files:**
- Modify: `apps/web/src/pages/V0Clone.tsx`
- Modify: `apps/web/src/lib/chatTimeline.test.ts`

- [ ] **Step 1: Add state-transition regression tests**

Add tests for:

- inserting the returned Run immediately after submission;
- replacing the optimistic active turn with Timeline API data;
- completing the active turn and collapsing the previous completed turn;
- ignoring events for a stale Run;
- resetting all turns when `chatId` changes.

- [ ] **Step 2: Run the regression tests and verify RED**

Run:

```bash
npm test --workspace @v0/web -- \
  --test-name-pattern="returned Run|previous completed|stale Run|chatId changes"
```

Expected: FAIL until the missing transitions are implemented.

- [ ] **Step 3: Add timeline state and loaders to `V0Clone`**

Add:

```ts
const [timeline, setTimeline] = useState(createTimelineState);
const timelineRequestRef = useRef(0);
```

Implement:

```ts
const loadTimeline = async (
  targetChatId: string,
  before?: string
): Promise<void> => {
  const requestId = ++timelineRequestRef.current;
  const response = await chatApi.getTimeline(targetChatId, {
    limit: 20,
    ...(before ? { before } : {})
  });
  if (requestId !== timelineRequestRef.current) return;
  setTimeline(state =>
    before
      ? mergeOlderTimelinePage(state, response.data)
      : replaceTimelinePage(state, response.data)
  );
};
```

On a Chat route load, request Chat metadata, timeline, Runs/Snapshots, and the
active Snapshot. Reset timeline state and invalidate the request counter when
`chatId` changes.

- [ ] **Step 4: Merge Run submission and SSE into the timeline**

After `agentApi.createRun` returns:

- insert a turn using the returned Run ID, prompt, model, timestamps, and status;
- mark it expanded;
- append streamed Events using `appendTimelineEvent`;
- update its lifecycle status from phase payloads and terminal events;
- on terminal completion/failure/cancellation, refetch the newest Timeline page
  and merge by `runId`;
- preserve existing `workspace` Snapshot and Preview transitions.

Do not remove `monitorAgentRun`; reuse its `onEvent` callback for both workspace
progress and timeline progress. Retain `generation.steps` as internal Preview
compatibility state, but stop rendering it in the left panel.

- [ ] **Step 5: Replace the left-panel activity UI**

In `WorkspaceScreen`:

- remove the single prompt card;
- remove the Assistant status card and flat `Agent plan` block;
- render `ConversationTimeline` as the left panel's scrollable content;
- keep `WorkspaceEditComposer` fixed at the bottom;
- keep Stop Run available inside the active Agent turn;
- leave Preview, Code, Design, Deploy, Snapshot history, and sidebar behavior
  unchanged.

Pass Timeline props and callbacks from `V0Clone` through `WorkspaceScreen`.

- [ ] **Step 6: Run frontend verification**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all web tests pass, type-check/build exit with code 0, and only the
existing large preview chunk warning remains.

- [ ] **Step 7: Commit the integration**

```bash
git add \
  apps/web/src/pages/V0Clone.tsx \
  apps/web/src/lib/chatTimeline.ts \
  apps/web/src/lib/chatTimeline.test.ts
git commit -m "feat: connect workspace to chat timeline"
```

### Task 6: Verify the Full Conversation Experience

**Files:**
- Modify: `apps/server/src/agent/testing/fakeModelClient.ts`
- Modify: `tests/smoke/workspace.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-25-chat-conversation-timeline.md`

- [ ] **Step 1: Make deterministic Edit output effective**

In `createFakeModelClient`, make `generateFiles` inspect
`input.context.mode`. Keep the existing Create result; for Edit, update
`src/App.tsx` to content different from the supplied base file:

```ts
generateFiles: async input => {
  calls.generate += 1;
  if (input.context.mode === 'edit') {
    const currentApp = input.context.files.find(
      file => file.path === 'src/App.tsx'
    )?.content ?? '';
    return {
      value: {
        message: 'Updated the deterministic application',
        operations: [{
          type: 'update',
          path: 'src/App.tsx',
          content: `${currentApp}\n// deterministic edit`
        }],
        dependencies: {},
        devDependencies: {}
      }
    };
  }
  return { value: deterministicGeneration };
},
```

Add a fake-client unit test that calls Create and Edit and asserts their
`src/App.tsx` contents differ.

- [ ] **Step 2: Update the browser smoke assertions**

Replace old `agent-timeline` assertions with:

```ts
const timeline = page.getByTestId('conversation-timeline');
await expect(timeline).toContainText(prompt);
await expect(timeline).toContainText('Agent started working');
await expect(page.getByTestId('agent-generation-status'))
  .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });

const firstTurn = timeline.locator('[data-testid^="conversation-turn-"]').first();
await expect(firstTurn).toContainText('Snapshot');
```

After sending the Edit prompt:

```ts
const turns = timeline.locator('[data-testid^="conversation-turn-"]');
await expect(turns).toHaveCount(2);
await expect(turns.nth(0).locator('[data-testid^="agent-turn-summary-"]'))
  .toHaveAttribute('aria-expanded', 'false');
await expect(turns.nth(1).locator('[data-testid^="agent-turn-summary-"]'))
  .toHaveAttribute('aria-expanded', 'true');
```

Click the first summary and verify its plan and changed file are restored.
Reload the route and repeat the two-turn count and default expansion assertions.

- [ ] **Step 3: Run deterministic smoke and verify GREEN**

Run:

```bash
SMOKE_API_PORT=43002 \
SMOKE_API_URL=http://127.0.0.1:43002 \
SMOKE_WEB_PORT=4174 \
SMOKE_WEB_URL=http://127.0.0.1:4174 \
npm run test:smoke
```

Expected: API smoke and one Playwright scenario pass.

- [ ] **Step 4: Run full repository verification**

Run:

```bash
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
git diff --check
```

Expected: all commands pass. Record exact test counts and any existing build
warning.

- [ ] **Step 5: Commit smoke coverage**

```bash
git add \
  apps/server/src/agent/testing/fakeModelClient.ts \
  tests/smoke/workspace.spec.ts
git commit -m "test: cover chat conversation timeline"
```

- [ ] **Step 6: Refresh the retained local stack**

Run:

```bash
docker compose \
  -p phase6-manual \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f work/docker-compose.real-validation.yml \
  up -d --build
```

Verify:

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

- [ ] **Step 7: Record execution results and commit the plan**

Append exact commits, test counts, smoke result, retained service state, build
warnings, and preserved unrelated changes under `Execution Results`.

```bash
git add docs/superpowers/plans/2026-07-25-chat-conversation-timeline.md
git commit -m "docs: complete chat timeline plan"
```

- [ ] **Step 8: Verify final local Git state**

Run:

```bash
git status --short
git log -8 --oneline
```

Expected: only the pre-existing `orchestrator` changes and local
`.superpowers/` directory remain uncommitted. Do not push.
