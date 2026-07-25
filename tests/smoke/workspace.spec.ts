import { expect, test } from '@playwright/test';

test('workspace completes a streamed run and restores its active snapshot', async ({ page }) => {
  const prompt = `Phase 6 browser smoke ${Date.now()}`;
  await page.goto('/');
  await page.getByPlaceholder('让 v0 构建...').fill(prompt);
  await page.getByLabel('Build prompt').click();

  await expect(page.getByTestId('agent-timeline')).toContainText('Worker started');
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(page).toHaveURL(/\/v0\/chats\/[a-f\d]{24}$/);
  await expect(page.getByText('Recent', { exact: true })).toHaveCount(0);

  const generatedPreview = page.frameLocator(
    '[data-testid="snapshot-preview"] iframe',
  );
  await expect(
    generatedPreview.getByTestId('generated-app'),
  ).toContainText('Generated app', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'src/App.tsx', exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('snapshot-history')).toContainText('active');
  await expect(page.getByTestId('snapshot-history')).toContainText('passed');

  const editComposer = page.getByTestId('workspace-edit-composer');
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
    .toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(editComposer.getByRole('textbox')).toHaveValue('');

  await page.reload();
  await expect(page.getByRole('button', { name: 'src/App.tsx', exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('snapshot-history')).toContainText('active');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page.frameLocator('[data-testid="snapshot-preview"] iframe')
      .getByTestId('generated-app'),
  ).toContainText('Generated app', { timeout: 30_000 });
});
