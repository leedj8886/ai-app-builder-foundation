import { expect, test } from '@playwright/test';

test('workspace completes a streamed run and restores its active snapshot', async ({ page }) => {
  const prompt = `Phase 6 browser smoke ${Date.now()}`;
  await page.goto('/');
  await page.getByPlaceholder('让 v0 构建...').fill(prompt);
  await page.getByLabel('Build prompt').click();

  await expect(page.getByTestId('agent-timeline')).toContainText('Worker started');
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'src/App.tsx', exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('snapshot-history')).toContainText('active');
  await expect(page.getByTestId('snapshot-history')).toContainText('passed');

  await page.reload();
  await expect(page.getByRole('button', { name: 'src/App.tsx', exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('snapshot-history')).toContainText('active');
});
