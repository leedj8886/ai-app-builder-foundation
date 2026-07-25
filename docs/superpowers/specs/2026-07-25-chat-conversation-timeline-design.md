# Chat Conversation Timeline Design

**Date:** 2026-07-25

## Goal

Replace the workspace's current single-prompt and flat Agent Plan presentation
with a persistent, chronological conversation timeline. Each turn shows the
user message followed by the Agent's structured, auditable work process and
result.

The right-side Preview, Code, and Design workspace remains unchanged.

## Product Principles

- Present user messages and Agent work in chronological order.
- Show structured work summaries, plans, file operations, validation, and
  results; never expose or imply access to a model's private chain of thought.
- Preserve enough detail to understand what happened without forcing every
  completed turn to remain expanded.
- Treat persisted Run and Event data as the source of truth for Agent activity.
- Restore the conversation after navigation or reload.

## Timeline Layout

The left workspace panel becomes one vertically scrolling timeline:

1. User message.
2. Agent work summary.
3. Dynamic implementation plan.
4. File and validation activity.
5. Final response and Snapshot result.
6. The next user message and Agent turn.

The fixed edit composer remains at the bottom of the left panel. While a Run is
active, the composer is disabled and its action displays `正在生成`.

## Expansion Rules

Each user message and associated Agent activity form one turn.

- The active Agent turn is always expanded.
- The latest successfully completed turn is expanded by default.
- Earlier completed turns are collapsed by default.
- Failed turns are expanded by default so the diagnostic is visible.
- Cancelled turns retain their completed activity and may be expanded.
- Users may manually expand or collapse any terminal turn.
- Expansion state is kept in frontend memory only. Reloading reapplies the
  default rules.

A collapsed turn displays one compact summary row:

```text
✓ 已完成 · 添加活动区域 · 修改 1 个文件 · 29 秒
```

The row also exposes the Snapshot revision entry. The structured summary,
implementation plan, file events, validation details, and full final response
remain inside the expandable region.

## Data Sources and Ownership

Existing persistence is divided across:

- `Chat.messages`: user messages and completed Assistant summaries.
- `AgentRun`: prompt, Chat association, lifecycle status, model, timing, usage,
  error, and result Snapshot association.
- `AgentEvent`: sequenced planning, plan, file, validation, repair, and terminal
  events.
- `ProjectSnapshot`: generated files, validation result, revision, and summary.

`AgentRun` is the authoritative record for one generated conversation turn.
The UI must not associate messages and Runs by comparing their text.

For generated turns, `userMessage.content` and `userMessage.createdAt` come from
`AgentRun.prompt` and `AgentRun.createdAt`. `Chat.messages` remains the model
conversation context and final Assistant-message store, but it is not joined to
a Run by comparing content. The final presentation summary comes from the
result Snapshot when available, with the terminal Run event as a degraded
fallback.

No historical data migration is required. Add an `AgentRun` index on
`{ userId: 1, chatId: 1, createdAt: -1 }` for timeline reads.

## Timeline API

Add an authenticated read-model endpoint:

```http
GET /api/chat/:chatId/timeline?limit=20&before=<cursor>
```

The endpoint verifies that the Chat belongs to the current user, queries Runs by
`chatId`, joins their sequenced Events and result Snapshots, and returns turns
in chronological order.

Representative response:

```ts
interface ChatTimelineResponse {
  chat: {
    id: string
    title: string
    projectId: string
  }
  turns: ChatTimelineTurn[]
  pageInfo: {
    hasMore: boolean
    nextBefore?: string
  }
}

interface ChatTimelineTurn {
  runId: string
  userMessage: {
    content: string
    createdAt: string
  }
  agent: {
    status:
      | 'queued'
      | 'running'
      | 'planning'
      | 'generating'
      | 'validating'
      | 'repairing'
      | 'persisting'
      | 'completed'
      | 'failed'
      | 'cancelled'
    model: string
    startedAt?: string
    completedAt?: string
    durationMs?: number
    planningDurationMs?: number
    summary?: string
    plan?: {
      summary: string
      steps: Array<{
        title: string
        intent: string
        filesLikelyTouched: string[]
      }>
      assumptions: string[]
    }
    events: Array<{
      type: string
      sequence: number
      message: string
      payload?: unknown
      createdAt: string
    }>
    error?: {
      code?: string
      message: string
    }
  }
  snapshot?: {
    id: string
    summary: string
    changedFiles: string[]
  }
}
```

The initial request returns the latest 20 turns but orders them oldest to newest
for display. Older pages are loaded through an explicit `加载更早对话` action.
The cursor is an opaque encoding of the boundary Run's `createdAt` and `_id`,
which keeps ordering deterministic when multiple Runs share a timestamp.

`changedFiles` is the ordered, deduplicated set of paths from that Run's
`file.changed` events. It does not require loading full Snapshot file contents
into the timeline response.

The UI labels the Snapshot entry with a short stable identifier derived from
its ID. It does not display a numeric revision because existing Snapshot records
do not persist a stable per-Snapshot revision number.

## Event Presentation

Persisted events map to user-facing activity:

| Event | Presentation |
| --- | --- |
| `run.created` | Run queued |
| `run.started` | Agent started working |
| planning phase | Analyzing the request |
| `agent.plan` | Structured work summary and dynamic implementation plan |
| `file.changed` | Created, updated, or deleted a named file |
| `validation.started` | Validating the generated project |
| `validation.passed` | Validation passed |
| `validation.failed` | Validation diagnostics |
| `repair.started` | Repairing from validation evidence |
| `run.completed` | Final response and Snapshot |
| `run.failed` | Failure summary and diagnostic |
| `run.cancelled` | Cancellation summary and last completed activity |

`planningDurationMs` is calculated from `run.started` to `agent.plan`. The UI may
label it `规划用时 N 秒`; it must not call it hidden reasoning or imply that it
is a transcript of model thought.

## Frontend Components

Split timeline behavior into focused components:

- `ConversationTimeline`: renders ordered turns, controls bottom-aware
  autoscroll, and requests older pages.
- `ConversationTurn`: groups one user message with its Agent turn.
- `UserMessage`: renders the user bubble and timestamp.
- `AgentTurn`: owns expanded/collapsed presentation for one Run.
- `TurnSummary`: renders the compact terminal-state row.
- `AgentActivity`: renders the structured summary, plan, and sequenced events.
- `SnapshotResult`: links the turn to its generated Snapshot and changed files.
- `WorkspaceEditComposer`: remains the fixed input surface.

The existing `WorkspaceScreen` should compose these units rather than continue
growing a monolithic activity section.

## Realtime Data Flow

1. Opening `/v0/chats/:chatId` requests the Chat timeline and active Snapshot.
2. The newest terminal turn and any active turn are expanded using the default
   rules.
3. Submitting the composer creates an Agent Run. The optimistic turn uses the
   returned `runId`, not prompt-text matching.
4. SSE events append to that turn by `runId` and `sequence`.
5. Duplicate or replayed events are ignored by the same composite identity.
6. When the Run reaches a terminal state, the client refetches that turn or the
   newest timeline page and refreshes the associated Snapshot.
7. Reloading reconstructs all visible turns from the Timeline API.

Autoscroll occurs only while the user is already near the bottom. Reading older
content must not be interrupted by incoming events.

## Error and Degraded States

- A failed turn preserves the user message and every event received before the
  failure. It displays the concise server diagnostic and is expanded by default.
- A cancelled turn displays the last completed step and remains expandable.
- If one historical Run lacks Events or a Snapshot, the API returns a degraded
  summary for that turn without failing the entire timeline.
- If timeline loading fails, the current Preview remains available and the left
  panel offers `重新加载对话`.
- If loading an older page fails, already loaded turns remain visible.
- A stale SSE connection cannot mutate a different Chat or Run.

## Accessibility and Interaction

- Expand controls are real buttons with `aria-expanded` and an associated
  content region.
- Running, completed, failed, and cancelled states are communicated through text
  as well as color.
- Keyboard focus remains stable when a turn collapses or new events arrive.
- The timeline uses semantic ordered content while decorative icons remain
  hidden from assistive technology.

## Verification

### Backend

- Timeline authorization and Chat ownership.
- Query filtering by `chatId`.
- Stable chronological ordering and cursor pagination.
- Plan extraction from `agent.plan`.
- Event ordering and per-Run isolation.
- Completed, failed, cancelled, and incomplete historical Runs.
- Snapshot metadata and changed-file projection.

### Frontend

- Timeline response normalization.
- Event deduplication using `runId + sequence`.
- Planning and total-duration calculations.
- Default expansion rules.
- Historical pagination without duplicate turns.
- Bottom-aware autoscroll.
- Loading, empty, failed, cancelled, and degraded states.

### End-to-End

1. Create the first Run and observe live structured activity.
2. Complete the Run and show its Snapshot.
3. Submit an Edit Run in the same Chat.
4. Verify the previous completed turn collapses and the active turn expands.
5. Reload the Chat route and restore both turns.
6. Expand the older turn and verify its plan and file activity.
7. Confirm the active Snapshot still renders in Preview and Code.

## Out of Scope

- A separate Chat history list page.
- Raw model chain-of-thought or private reasoning.
- Changes to the right-side Preview, Code, or Design workspace.
- Cross-Chat search or message full-text search.
- Persisting expansion preferences across reloads.
- Replacing the existing SSE transport.
