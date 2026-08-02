import { expect, test } from '@playwright/test';
import {
  legacyStylingSmoke
} from '../../apps/server/src/testing/seedLegacyStylingSmoke';

const apiUrl = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:43001';
const previewCompileTimeout = 90_000;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ai-app-builder-language', 'zh-CN');
  });
});

test('legacy Tailwind Snapshot compiles Preview-only compatibility', async ({ page }) => {
  const response = await page.request.post(`${apiUrl}/api/auth/login`, {
    data: {
      email: legacyStylingSmoke.email,
      password: legacyStylingSmoke.password
    }
  });
  expect(response.ok()).toBe(true);
  const { token } = await response.json() as { token: string };
  await page.addInitScript(value => {
    localStorage.setItem('token', value);
  }, token);

  await page.goto(`/chats/${legacyStylingSmoke.chatId}`);
  await expect(page.getByTestId('snapshot-preview')).toBeVisible();
  const generatedPreview = page.frameLocator(
    '[data-testid="snapshot-preview"] iframe[title="Sandpack Preview"]'
  );
  await expect(generatedPreview.getByTestId('tailwind-background')).toHaveCSS(
    'background-color',
    'rgb(219, 234, 254)',
    { timeout: previewCompileTimeout }
  );

  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expect(page.getByRole('button', {
    name: 'tailwind.config.js',
    exact: true
  })).toHaveCount(0);
  await expect(page.getByRole('button', {
    name: 'postcss.config.cjs',
    exact: true
  })).toHaveCount(0);
});

test('workspace completes a streamed run and restores its active snapshot', async ({ page }) => {
  const prompt = `Phase 6 browser smoke ${Date.now()}`;
  await page.goto('/');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveCount(0);
  await expect(page.getByText('Templates', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Resources', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Enterprise', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('描述你想构建的应用…').fill(prompt);
  await page.getByLabel('开始构建').click();

  const timeline = page.getByTestId('conversation-timeline');
  await expect(timeline).toContainText(prompt);
  await expect(timeline).toContainText('Agent 已开始工作');
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  await expect(page).toHaveURL(/\/chats\/[a-f\d]{24}$/);
  const chatUrl = page.url();
  await expect(page.getByText('Recent', { exact: true })).toHaveCount(0);
  await expect(timeline.locator('[data-testid^="conversation-turn-"]').first())
    .toContainText('Snapshot');

  const workspaceSidebar = page.getByTestId('workspace-sidebar');
  const recentChats = page.getByTestId('recent-chats');
  const editComposer = page.getByTestId('workspace-edit-composer');
  await expect(workspaceSidebar).toBeVisible();
  await expect(recentChats).toContainText(prompt);
  await expect(
    recentChats.getByRole('link', { name: `打开对话：${prompt}` }),
  ).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(editComposer).toBeVisible();
  const compactComposerBox = await editComposer.boundingBox();
  expect(compactComposerBox).not.toBeNull();
  expect(compactComposerBox!.y + compactComposerBox!.height).toBeLessThanOrEqual(768);
  await page.setViewportSize({ width: 1440, height: 900 });

  await editComposer.getByRole('textbox').fill('Draft preserved while collapsed');

  await workspaceSidebar.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(workspaceSidebar).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible();
  await expect(editComposer.getByRole('textbox')).toHaveValue('Draft preserved while collapsed');
  await expect(page.getByTestId('snapshot-preview')).toBeVisible();

  const expandButtonBox = await page.getByRole('button', { name: '展开侧边栏' }).boundingBox();
  const topNavBrandBox = await page.getByTestId('top-nav-brand').boundingBox();
  const workspaceHeaderBox = await page.getByTestId('workspace-header').boundingBox();
  expect(expandButtonBox).not.toBeNull();
  expect(topNavBrandBox).not.toBeNull();
  expect(workspaceHeaderBox).not.toBeNull();
  expect(expandButtonBox!.y + expandButtonBox!.height)
    .toBeLessThanOrEqual(workspaceHeaderBox!.y);
  expect(topNavBrandBox!.x).toBeLessThanOrEqual(16);
  expect(expandButtonBox!.x).toBeGreaterThanOrEqual(topNavBrandBox!.x + topNavBrandBox!.width);

  await page.getByTestId('sidebar-edge-trigger').hover();
  const sidebarPreview = page.getByTestId('workspace-sidebar-preview');
  await expect(sidebarPreview).toBeVisible();
  await expect(page.getByTestId('sidebar-expand-button')).toBeHidden();
  await expect(sidebarPreview.getByTestId('recent-chats')).toContainText(prompt);
  await page.mouse.move(500, 120);
  await expect(sidebarPreview).toBeHidden();
  await expect(page.getByTestId('sidebar-expand-button')).toBeVisible();

  await page.getByRole('button', { name: '展开侧边栏' }).click();
  await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
  await expect(page.getByTestId('recent-chats')).toContainText(prompt);
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toHaveCount(0);

  await page.getByTestId('workspace-sidebar').getByRole('button', { name: '收起侧边栏' }).click();
  await page.getByTestId('sidebar-edge-trigger').hover();
  await page.getByTestId('workspace-sidebar-preview').getByRole('button', { name: '固定侧边栏' }).click();
  await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
  await expect(page.getByTestId('workspace-sidebar-preview')).toHaveCount(0);
  await editComposer.getByRole('textbox').fill('');

  await page.getByRole('button', { name: '代码', exact: true }).click();
  const appFile = page.getByRole('button', { name: 'src/App.tsx', exact: true }).first();
  await expect(appFile).toBeVisible();
  await appFile.click();
  await expect(page.locator('pre code')).toContainText('Generated app');

  await expect(editComposer).toBeVisible();
  await page.route('**/api/agent/runs', async (route) => {
    const request = route.request();
    const body = request.method() === 'POST'
      ? request.postDataJSON() as { mode?: string }
      : undefined;
    if (body?.mode === 'edit') {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    await route.continue();
  });
  await editComposer.getByRole('textbox').fill('Add a compact activity section');
  await editComposer.getByRole('button', { name: '发送消息' }).click();
  await expect(editComposer.getByRole('textbox')).toBeDisabled();
  await expect(editComposer.getByRole('button', { name: '正在生成…' })).toBeDisabled();
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  await expect(editComposer.getByRole('textbox')).toHaveValue('');
  await expect(timeline).toContainText('依赖缓存命中');

  const turns = timeline.locator('[data-testid^="conversation-turn-"]');
  await expect(turns).toHaveCount(2);
  const firstSummary = turns.nth(0).locator('[data-testid^="agent-turn-summary-"]');
  const latestSummary = turns.nth(1).locator('[data-testid^="agent-turn-summary-"]');
  await expect(firstSummary).toHaveAttribute('aria-expanded', 'false');
  await expect(latestSummary).toHaveAttribute('aria-expanded', 'true');
  await firstSummary.click();
  await expect(firstSummary).toHaveAttribute('aria-expanded', 'true');
  await expect(turns.nth(0)).toContainText('实施计划');
  await expect(turns.nth(0)).toContainText('src/App.tsx');

  await page.reload();
  const restoredTimeline = page.getByTestId('conversation-timeline');
  const restoredTurns = restoredTimeline.locator('[data-testid^="conversation-turn-"]');
  await expect(restoredTurns).toHaveCount(2);
  await expect(
    restoredTurns.nth(0).locator('[data-testid^="agent-turn-summary-"]'),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(
    restoredTurns.nth(1).locator('[data-testid^="agent-turn-summary-"]'),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: '代码', exact: true }).click();
  const restoredAppFile = page.getByRole('button', {
    name: 'src/App.tsx',
    exact: true,
  }).first();
  await restoredAppFile.click();
  await expect(page.locator('pre code')).toContainText('// deterministic edit');

  await page.getByTestId('recent-chats').getByRole('link', { name: '更多' }).click();
  await expect(page).toHaveURL('/chats');
  const historyList = page.getByTestId('chat-history-list');
  await expect(historyList).toContainText(prompt);
  await historyList.getByRole('link', { name: `打开对话：${prompt}` }).click();
  await expect(page).toHaveURL(chatUrl);
  await expect(page.getByTestId('workspace-sidebar')).toBeVisible();

  await page.getByTestId('recent-chats').getByRole('link', { name: '更多' }).click();
  await expect(page).toHaveURL('/chats');
  await page.getByRole('link', { name: '新建对话' }).first().click();
  await expect(page).toHaveURL('/');
});
