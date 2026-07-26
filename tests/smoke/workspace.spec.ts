import { expect, test } from '@playwright/test';

test('workspace completes a streamed run and restores its active snapshot', async ({ page }) => {
  const prompt = `Phase 6 browser smoke ${Date.now()}`;
  await page.goto('/');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveCount(0);
  await expect(page.getByText('Templates', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Resources', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Enterprise', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('让 v0 构建...').fill(prompt);
  await page.getByLabel('Build prompt').click();

  const timeline = page.getByTestId('conversation-timeline');
  await expect(timeline).toContainText(prompt);
  await expect(timeline).toContainText('Agent 已开始工作');
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  await expect(page).toHaveURL(/\/v0\/chats\/[a-f\d]{24}$/);
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

  await workspaceSidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(workspaceSidebar).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect(editComposer.getByRole('textbox')).toHaveValue('Draft preserved while collapsed');
  await expect(page.getByTestId('snapshot-preview')).toBeVisible();

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
  await expect(page.getByTestId('recent-chats')).toContainText(prompt);
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveCount(0);
  await editComposer.getByRole('textbox').fill('');

  const generatedPreview = page.frameLocator(
    '[data-testid="snapshot-preview"] iframe',
  );
  await expect(
    generatedPreview.getByTestId('generated-app'),
  ).toContainText('Generated app', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'src/App.tsx', exact: true }).first()).toBeVisible();

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
  await editComposer.getByRole('button', { name: 'Send edit' }).click();
  await expect(editComposer.getByRole('textbox')).toBeDisabled();
  await expect(editComposer.getByRole('button', { name: '正在生成' })).toBeDisabled();
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  await expect(editComposer.getByRole('textbox')).toHaveValue('');

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

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page.frameLocator('[data-testid="snapshot-preview"] iframe')
      .getByTestId('generated-app'),
  ).toContainText('Generated app', { timeout: 30_000 });

  await page.getByTestId('recent-chats').getByRole('link', { name: 'More' }).click();
  await expect(page).toHaveURL('/v0/chats');
  const historyList = page.getByTestId('chat-history-list');
  await expect(historyList).toContainText(prompt);
  await historyList.getByRole('link', { name: `打开对话：${prompt}` }).click();
  await expect(page).toHaveURL(chatUrl);
  await expect(page.getByTestId('workspace-sidebar')).toBeVisible();

  await page.getByTestId('recent-chats').getByRole('link', { name: 'More' }).click();
  await expect(page).toHaveURL('/v0/chats');
  await page.getByRole('link', { name: 'New chat' }).first().click();
  await expect(page).toHaveURL('/');
});
