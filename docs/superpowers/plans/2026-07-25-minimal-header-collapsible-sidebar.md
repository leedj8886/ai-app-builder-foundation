# Minimal Header and Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unused global menus and allow the desktop workspace sidebar to disappear completely and return from a floating left-edge button.

**Architecture:** `V0Clone` owns one non-persisted sidebar visibility boolean and passes it into `WorkspaceScreen`. `TopNav` becomes a static brand/actions header, while `WorkspaceScreen` conditionally renders either the full sidebar or a fixed desktop-only expand control.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide React, Vite, Playwright

---

## File Map

- Modify `apps/web/src/pages/V0Clone.tsx`: simplify `TopNav`, own sidebar state, conditionally render the full sidebar and floating expand button.
- Modify `tests/smoke/workspace.spec.ts`: verify removed menus, collapse/expand behavior, and preservation of workspace content.
- Modify `docs/superpowers/plans/2026-07-25-minimal-header-collapsible-sidebar.md`: record final verification.

### Task 1: Remove the Global Menus

**Files:**
- Modify: `tests/smoke/workspace.spec.ts`
- Modify: `apps/web/src/pages/V0Clone.tsx`

- [x] **Step 1: Write failing header assertions**

Immediately after `page.goto('/')` in `tests/smoke/workspace.spec.ts`, add:

```ts
await expect(page.getByRole('navigation')).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveCount(0);
await expect(page.getByText('Templates', { exact: true })).toHaveCount(0);
await expect(page.getByText('Resources', { exact: true })).toHaveCount(0);
await expect(page.getByText('Enterprise', { exact: true })).toHaveCount(0);
```

- [x] **Step 2: Run browser smoke and verify RED**

Run:

```bash
SMOKE_API_PORT=43002 \
SMOKE_API_URL=http://127.0.0.1:43002 \
SMOKE_WEB_PORT=4174 \
SMOKE_WEB_URL=http://127.0.0.1:4174 \
npm run test:smoke
```

Expected: FAIL because `TopNav` still renders the desktop navigation and mobile
toggle.

- [x] **Step 3: Replace `TopNav` with a static minimal header**

In `apps/web/src/pages/V0Clone.tsx`, remove `mobileMenuOpen`, its state setter,
the `Menu` and `X` imports, and the `NavMenu` component. Render:

```tsx
function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-[#fafafa]/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1440px] items-center justify-between px-3 sm:px-4">
        <button className="flex h-8 items-center gap-2 rounded-md text-left" aria-label="v0 home">
          <span className="text-[21px] font-black leading-none tracking-normal">v0</span>
        </button>
        <div className="hidden items-center gap-2 md:flex">
          <button className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50">
            登录
          </button>
          <button className="h-8 rounded-md bg-neutral-950 px-3 text-sm font-medium text-white hover:bg-neutral-800">
            注册
          </button>
        </div>
      </div>
    </header>
  );
}
```

Change the call site to `<TopNav />`.

- [x] **Step 4: Run Web verification**

Run:

```bash
npm test --workspace @v0/web
npm run type-check --workspace @v0/web
npm run build --workspace @v0/web
```

Expected: all tests pass and type-check/build exit with code 0.

- [x] **Step 5: Commit the header change**

```bash
git add apps/web/src/pages/V0Clone.tsx tests/smoke/workspace.spec.ts
git commit -m "refactor: simplify global header"
```

### Task 2: Completely Collapse the Workspace Sidebar

**Files:**
- Modify: `tests/smoke/workspace.spec.ts`
- Modify: `apps/web/src/pages/V0Clone.tsx`

- [x] **Step 1: Write failing collapse/expand assertions**

After the initial Agent Run reaches `ready` in
`tests/smoke/workspace.spec.ts`, add:

```ts
const workspaceSidebar = page.getByTestId('workspace-sidebar');
const editComposer = page.getByTestId('workspace-edit-composer');
await expect(workspaceSidebar).toBeVisible();
await editComposer.getByRole('textbox').fill('Draft preserved while collapsed');

await workspaceSidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
await expect(workspaceSidebar).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
await expect(editComposer.getByRole('textbox')).toHaveValue('Draft preserved while collapsed');
await expect(page.getByTestId('snapshot-preview')).toBeVisible();

await page.getByRole('button', { name: 'Expand sidebar' }).click();
await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveCount(0);
await editComposer.getByRole('textbox').fill('');
```

- [x] **Step 2: Run browser smoke and verify RED**

Run:

```bash
SMOKE_API_PORT=43002 \
SMOKE_API_URL=http://127.0.0.1:43002 \
SMOKE_WEB_PORT=4174 \
SMOKE_WEB_URL=http://127.0.0.1:4174 \
npm run test:smoke
```

Expected: FAIL because the sidebar has no test ID or collapse control.

- [x] **Step 3: Add parent-owned visibility state**

In `V0Clone`, add:

```tsx
const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsed] = useState(false);
```

Pass these props to `WorkspaceScreen`:

```tsx
sidebarCollapsed={workspaceSidebarCollapsed}
onCollapseSidebar={() => setWorkspaceSidebarCollapsed(true)}
onExpandSidebar={() => setWorkspaceSidebarCollapsed(false)}
```

Add matching prop types:

```ts
sidebarCollapsed: boolean;
onCollapseSidebar: () => void;
onExpandSidebar: () => void;
```

- [x] **Step 4: Conditionally render the sidebar and floating control**

Import `PanelLeftClose` and `PanelLeftOpen` from `lucide-react`.

Make the outer desktop grid dynamic:

```tsx
<main
  className={`grid min-h-[calc(100vh-48px)] grid-cols-1 bg-white ${
    sidebarCollapsed ? 'lg:grid-cols-1' : 'lg:grid-cols-[272px_1fr]'
  }`}
>
```

Render the full sidebar only while expanded:

```tsx
{!sidebarCollapsed ? (
  <aside
    className="hidden border-r border-neutral-200 bg-[#fafafa] lg:flex lg:flex-col"
    data-testid="workspace-sidebar"
  >
    <div className="flex items-center gap-2 p-3">
      <button
        className="flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-md bg-neutral-950 text-sm font-medium text-white hover:bg-neutral-800"
        onClick={onBackHome}
      >
        <Sparkles className="h-4 w-4" />
        New chat
      </button>
      <button
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-100"
        aria-label="Collapse sidebar"
        onClick={onCollapseSidebar}
      >
        <PanelLeftClose className="h-4 w-4" />
      </button>
    </div>
    <div className="flex-1" />
    <div className="space-y-1 border-t border-neutral-200 p-2">
      <button className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-neutral-600 hover:bg-neutral-100">
        <Github className="h-4 w-4" />
        Sync with repo
      </button>
      <button className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-neutral-600 hover:bg-neutral-100">
        <Settings2 className="h-4 w-4" />
        Settings
      </button>
    </div>
  </aside>
) : (
  <button
    className="fixed left-2 top-14 z-40 hidden h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white shadow-md hover:bg-neutral-50 lg:inline-flex"
    aria-label="Expand sidebar"
    onClick={onExpandSidebar}
  >
    <PanelLeftOpen className="h-4 w-4" />
  </button>
)}
```

The edit composer remains inside the workspace's left content panel and is not
conditionally rendered.

- [x] **Step 5: Run browser and Web verification**

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

Expected: all commands exit with code 0; Playwright verifies collapse, preserved
draft/preview, and expansion.

- [x] **Step 6: Commit the sidebar behavior**

```bash
git add apps/web/src/pages/V0Clone.tsx tests/smoke/workspace.spec.ts
git commit -m "feat: collapse workspace sidebar"
```

### Task 3: Refresh the Retained Stack and Record Results

**Files:**
- Modify: `docs/superpowers/plans/2026-07-25-minimal-header-collapsible-sidebar.md`

- [x] **Step 1: Rebuild the retained local stack**

Run:

```bash
docker compose \
  -p phase6-manual \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f work/docker-compose.real-validation.yml \
  up -d --build --force-recreate web
```

Expected: Web is healthy at `http://127.0.0.1:4173`; Server and Worker remain
running.

- [x] **Step 2: Verify repository and service state**

Run:

```bash
git diff --check
git status --short
git log -6 --oneline
curl -fsS http://127.0.0.1:43001/health
```

Expected: no whitespace errors, only the plan record remains modified, and API
health is `ok`.

- [x] **Step 3: Record exact verification results**

Append an `Execution Results` section containing Web test count, Playwright
result, build result, retained-stack health, and the existing Vite chunk
warning.

- [x] **Step 4: Commit the completed plan record**

```bash
git add docs/superpowers/plans/2026-07-25-minimal-header-collapsible-sidebar.md
git commit -m "docs: complete collapsible sidebar plan"
```

## Execution Results

- Header regression was verified RED against the retained pre-change UI, then
  implemented and committed as `2c1534c`.
- Sidebar regression assertions were added. The isolated smoke stack stopped in
  API smoke before Playwright because the working tree's uncommitted
  `NO_EFFECTIVE_CHANGES` server guard rejects the deterministic no-op edit
  fixture.
- Web verification passed: 57 tests, TypeScript type-check, and production
  build.
- Sidebar behavior and its Playwright coverage were committed as `62ab9d9`.
- The retained stack was rebuilt and is healthy at Web port `4173` and API port
  `43001`; MongoDB, Redis, and Worker are running.
- Browser smoke against the retained real-provider stack reached `Worker
  started`, but the Create Run remained `running` past the assertion's 30-second
  deadline. Worker logs subsequently recorded the job as completed. Therefore,
  the full Playwright scenario is not recorded as passing.
- Vite still reports the existing warning that
  `SnapshotPreview-*.js` is 619.76 kB after minification.
- Existing uncommitted changes in
  `apps/server/src/agent/orchestrator.ts` and
  `apps/server/src/agent/orchestrator.test.ts` were preserved and excluded from
  both frontend commits.
