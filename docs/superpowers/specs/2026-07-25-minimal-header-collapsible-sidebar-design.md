# Minimal Header and Collapsible Sidebar Design

## Goal

Remove the currently unused global navigation menus and let users completely
hide the conversation workspace sidebar, recovering it from a small floating
button at the left page edge.

## Header

The global header keeps:

- the v0 brand button on the left;
- the existing login and register actions on desktop.

It removes:

- Templates and Resources menus;
- Enterprise, Pricing, iOS, Students, and FAQ links;
- the mobile hamburger button and its dropdown menu.

The header retains its current height, sticky behavior, border, and background
so removing navigation does not shift the workspace vertically. The brand
button continues to be the stable left anchor.

## Workspace Sidebar

The conversation workspace sidebar remains expanded by default on desktop. It
contains the New Chat action and the existing repository/settings actions.

An explicit collapse button is added within the expanded sidebar. Activating it
removes the entire sidebar from layout rather than reducing it to a narrow
rail. The workspace content then expands into the released width.

When collapsed, a floating expand button appears:

- fixed near the left edge below the global header;
- above normal workspace content with a clear border and opaque background;
- compact enough not to cover the Agent timeline, editor, or preview;
- labelled for screen readers and accessible by keyboard.

Activating the floating button restores the complete sidebar and removes the
floating control.

## Responsive Behavior

The sidebar and its collapse/expand controls are desktop-only, matching the
existing `lg` breakpoint. Mobile and tablet layouts continue without the
workspace sidebar and do not show the floating expand button.

The floating button is positioned relative to the viewport rather than the
workspace grid so it remains discoverable while the conversation panel
scrolls.

## State

`V0Clone` owns a `workspaceSidebarCollapsed` boolean and passes it to
`WorkspaceScreen` with collapse/expand callbacks.

The state:

- defaults to `false`;
- is not persisted to local storage;
- is not reset by Agent Run events, Snapshot refreshes, or edit-draft changes;
- returns to the default expanded state after a full page reload.

Collapsing the sidebar changes layout only. It does not abort monitoring,
change `chatId` or `projectId`, clear drafts, or replace workspace state.

## Testing

Playwright smoke will verify:

- removed global menu labels and mobile navigation control are absent;
- the expanded sidebar and collapse button are initially visible on desktop;
- collapsing removes the complete sidebar and exposes the floating expand
  button;
- the active Snapshot preview and edit draft remain present while collapsed;
- expanding restores New Chat and removes the floating button.

Frontend type-check and production build must continue to pass. Existing
Create/Edit smoke coverage remains unchanged apart from the new layout
assertions.
