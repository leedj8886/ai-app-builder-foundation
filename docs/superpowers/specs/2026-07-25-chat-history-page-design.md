# Chat History Page Design

## Goal

Add a lightweight recent-chat section to the Workspace sidebar and a dedicated
chat-history page. Users can move between prior conversations without adding
management features such as search, rename, or delete.

## User Experience

### Workspace Sidebar

- Keep the existing `New chat` button at the top.
- Add a collapsible `最近聊天` section directly beneath it.
- Show the five most recently updated chats, ordered by `updatedAt` descending.
- Highlight the active Chat.
- Clicking a Chat opens `/v0/chats/:chatId`.
- Show `More` after the recent list. Clicking it opens `/v0/chats`.
- Preserve the existing whole-sidebar collapse behavior. Re-expanding the
  sidebar restores the recent-chat section.
- Do not add per-row menus or management actions.

### Full History Page

- Use the dedicated route `/v0/chats`.
- Show a page title, a short ordering description, and a `New chat` action.
- Render all chats in a single vertical list ordered by `updatedAt` descending.
- Each row shows:
  - Chat title;
  - a concise preview based on the first user message, when available;
  - a human-readable updated time.
- Clicking anywhere on a row opens `/v0/chats/:chatId`.
- Do not add search, date grouping, rename, or delete in this phase.

### Loading, Empty, and Error States

- Show a compact skeleton while Chat records load.
- When there are no Chats, explain that completed conversations will appear
  here and provide a `New chat` action.
- When loading fails, show a concise error and a retry action.
- A failed sidebar request must not prevent the active Workspace from loading.

## Architecture

### Data Source

Reuse the authenticated `GET /api/chat` endpoint. It already returns owned Chat
records ordered by `updatedAt` descending and includes the fields required by
the sidebar.

The full history preview also needs the first user message. Extend the list
projection to return a bounded preview field rather than returning the entire
embedded `messages` array:

```ts
interface ChatListItem {
  _id: string;
  projectId?: string;
  title: string;
  preview?: string;
  createdAt: string;
  updatedAt: string;
}
```

The server derives `preview` from the first user message and truncates it to a
safe display length. The response remains:

```ts
{ chats: ChatListItem[] }
```

### Frontend State Boundary

Create a small Chat-list state module with explicit `idle`, `loading`, `ready`,
and `error` behavior. It owns:

- loading and retry transitions;
- recent-list selection;
- active Chat matching;
- stable date formatting helpers.

Both the Workspace sidebar and full page consume the same list-item type and
presentation helpers. Data fetching can remain page-local so each route is
independently reloadable.

### Components and Routes

- Add `RecentChats` for the compact Workspace sidebar section.
- Add `ChatHistoryPage` for `/v0/chats`.
- Update `WorkspaceScreen` to render `RecentChats` under `New chat`.
- Add `/v0/chats` before `/v0/chats/:chatId` in the application routes.
- Keep `/` as the new-chat/home destination.

The existing `ChatHistory` component predates the current product direction and
contains rename/delete controls. Replace or retire it instead of extending
those controls into the new experience.

## Data Flow

1. The Workspace or history page mounts and requests `GET /api/chat`.
2. The server verifies authentication, queries only the current user's Chats,
   and returns the ordered list with bounded previews.
3. The Workspace takes the first five records for `最近聊天`.
4. Selecting a row navigates to the Chat route; the existing Workspace loading
   flow resolves the associated Project and Snapshot.
5. Selecting `More` navigates to `/v0/chats`.
6. Selecting `New chat` navigates to `/`.

When a new Chat is created or an existing Chat receives another user turn, the
next list request reflects the updated ordering. Live cross-page synchronization
is outside this phase.

## Responsive Behavior

- The recent list follows the existing desktop Workspace sidebar and is hidden
  when that sidebar is collapsed.
- The full history page uses a centered, readable content column on wide
  screens and edge-to-edge rows with reduced padding on mobile.
- Titles and previews truncate rather than expanding rows without bounds.

## Accessibility

- Recent and full-history rows are links with descriptive accessible names.
- The active recent Chat exposes `aria-current="page"`.
- Loading status and errors use appropriate live-region semantics.
- Keyboard focus remains visible on every navigation and retry control.
- The recent-section disclosure exposes `aria-expanded`.

## Testing

### Server

- Chat list returns only the authenticated user's Chats in descending
  `updatedAt` order.
- Preview comes from the first user message and is bounded.
- Chats without a user message omit the preview.

### Frontend Unit

- Recent selection returns at most five records.
- Active Chat matching and empty/error transitions are deterministic.
- Date labels cover recent and older records.

### Component and Smoke

- Workspace sidebar renders recent Chats and highlights the routed Chat.
- Collapsing and expanding the sidebar preserves behavior.
- `More` opens `/v0/chats`.
- The history page handles loading, empty, error, and populated states.
- Clicking a history row restores the associated Workspace.
- `New chat` returns to `/`.

## Out of Scope

- Search and filters.
- Date-grouped navigation.
- Rename and delete.
- Pagination or infinite scrolling.
- Pinning, folders, sharing, and collaboration metadata.
- Live synchronization across browser tabs.
