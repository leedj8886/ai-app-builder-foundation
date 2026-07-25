# Chat-Routed Multiturn Workspace Design

## Goal

Complete the frontend multiturn workflow by giving every conversation its own
URL and adding a fixed edit composer to the workspace. A conversation is
identified by `chatId`; its associated `projectId` selects the codebase and
active Snapshot that each Agent Run edits.

## Scope

This change will:

- add a dedicated `/v0/chats/:chatId` workspace route;
- create a Project and Chat before the first Agent Run;
- load workspace state from the Chat's `projectId` when the route is opened or
  refreshed;
- remove the recent-chat/history navigation from the workspace sidebar;
- add a fixed composer at the bottom of the workspace's left content panel;
- submit later prompts as Edit runs with the current `chatId` and `projectId`;
- make Agent Run creation own user-message persistence so the legacy Chat API
  does not make a second LLM call.

A separate conversation-history page, cross-project memory, queued prompts,
and multiple concurrent runs are explicitly out of scope.

## Domain Model

`Project` and `Chat` remain separate:

- `Project` owns settings, Agent Runs, Snapshots, and `activeSnapshotId`.
- `Chat` owns the ordered user/assistant conversation and references one
  `projectId`.
- `AgentRun` references both values. `projectId` selects the code and active
  Snapshot; `chatId` selects the conversation context and message destination.

One Project may have multiple Chats. Each Chat belongs to at most one Project;
the routed v0 workspace requires that relationship to exist.

## Routes and Page Boundaries

The application will use React Router:

- `/` renders the prompt-first v0 home.
- `/v0/chats/:chatId` renders the conversation workspace.
- unknown routes redirect to `/`.

The home and routed workspace may continue sharing the existing `V0Clone`
stateful container during this iteration. Route state, not
`localStorage.v0.activeProjectId`, is authoritative for selecting a
conversation. Local storage remains limited to authentication.

Opening `/v0/chats/:chatId` performs:

1. fetch the authenticated Chat;
2. require its `projectId`;
3. fetch the Project's runs and Snapshots;
4. load the active Snapshot and preview;
5. render a not-found/error state if the Chat is unavailable or has no Project.

Changing `chatId` aborts the previous monitor and ignores stale refresh
responses.

## First-Run Data Flow

Submitting the home prompt performs these operations in order:

1. ensure the demo user is authenticated;
2. create the Project;
3. create a Chat associated with that Project without invoking code
   generation;
4. create a `mode: "create"` Agent Run with `projectId`, `chatId`, and prompt;
5. navigate to `/v0/chats/:chatId`;
6. monitor the Run through the existing SSE/polling path.

The Chat creation request uses the first prompt as a title seed, but the
prompt's durable conversation message is written by Agent Run creation. This
keeps all generated output on the Agent Worker path.

If Project creation succeeds but Chat creation fails, the error is shown and
no Agent Run starts. If Chat creation succeeds but Run creation fails, the
conversation route remains usable and the original prompt remains available
for retry.

## Multiturn Edit Data Flow

The workspace composer calls the existing parent
`submitPromptToAgent` function. In routed workspace mode the function:

1. trims and validates the prompt;
2. requires the current `chatId`, `projectId`, and active Snapshot;
3. creates an Agent Run with `{ chatId, projectId, prompt, mode: "edit" }`;
4. monitors progress with the existing event stream;
5. refreshes Run history and the active Snapshot after completion.

The backend resolves the actual `baseSnapshotId` from the Project's active
Snapshot. The frontend does not send a Snapshot ID and therefore cannot race
by submitting a stale client-side value.

## Chat and Agent API Alignment

The current Chat routes call the legacy `generateCode` service, which would
cause a duplicate LLM call beside the Agent Worker. They will be changed as
follows:

- `POST /api/chat` creates a Chat associated with `projectId`, derives its
  title from the supplied title seed, and does not call `generateCode`.
- Agent Run creation with `chatId` validates Chat ownership/project
  association and appends the Run prompt as one user message.
- The existing Worker completion path appends one assistant message containing
  the generation summary and Snapshot ID.
- `POST /api/chat/:id/messages` becomes append-only and does not invoke an
  LLM. The routed workspace does not call this endpoint; it submits through
  Agent Run creation.

Run creation must avoid duplicating a user message if an identical request is
retried with the same persisted Run. Queue retry processing does not append
messages because message persistence occurs only in the HTTP creation path.

## Workspace Layout

The outer navigation sidebar will no longer contain search or recent-run/chat
history. It retains only global actions such as New Chat, repository sync, and
settings.

Inside the workspace, the left content panel contains:

- the current user prompt and Agent response/progress;
- validation errors, Snapshot files, and existing run controls;
- a vertically scrolling content area;
- a composer fixed to the bottom of the panel with a top border and opaque
  background.

The composer behavior is:

- Enter submits; Shift+Enter inserts a newline.
- Blank text cannot submit.
- It is enabled only when an active Snapshot exists and no submission is in
  flight.
- While a Run is active, the textarea and button are disabled and the button
  reads `正在生成`.
- An unsubmitted draft is preserved while a Run is active.
- A successfully submitted prompt is cleared only after the Run completes.
- A failed or cancelled prompt remains in the composer for editing and retry.

On smaller layouts the composer remains after the progress content rather than
using viewport-level fixed positioning, preventing it from covering the
preview.

## State and Error Handling

The initial home draft and workspace edit draft are separate state values.
Navigating between Chats resets the edit draft and loads the selected Chat.

The workspace distinguishes:

- loading the routed Chat;
- missing/unauthorized Chat;
- Chat without an associated Project;
- Project/Snapshot load failure;
- Agent Run failure or cancellation.

The previous active Snapshot remains previewable during a new Edit Run and
after a failed Edit Run. Submission is disabled during all active Run states,
including the period before a persisted Run ID is returned.

## Testing

Backend tests will verify:

- Chat creation associates a Project without invoking legacy code generation;
- Agent Run creation appends exactly one user message to the matching Chat;
- cross-project or foreign Chat IDs are rejected;
- Worker completion appends exactly one assistant message;
- job retries do not duplicate conversation messages.

Frontend tests will verify:

- route parsing and navigation use `chatId`;
- a routed Chat loads its `projectId`, runs, active Snapshot, and preview;
- the workspace no longer renders the recent-history region;
- the fixed composer submits the current `chatId`, `projectId`, prompt, and
  `mode: "edit"`;
- missing active Snapshot and blank prompts do not submit;
- running state disables the composer and displays `正在生成`;
- success clears the submitted draft while failure/cancellation preserves it;
- stale route loads and monitors cannot overwrite the current Chat.

Final verification will include backend and frontend unit/integration suites,
type-checks, builds, deterministic browser smoke, and one real DeepSeek
Create-then-Edit conversation through `/v0/chats/:chatId`.
