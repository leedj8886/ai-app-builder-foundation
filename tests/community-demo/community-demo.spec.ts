import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const outputDirectory = path.resolve(
  process.env.COMMUNITY_DEMO_OUTPUT ?? 'docs/assets/community-preview'
);
const prompt = 'Build an operations dashboard with metrics, filters, and an activity timeline.';

test('records the build-verified community preview', async ({ page }) => {
  await mkdir(outputDirectory, { recursive: true });
  await page.goto('/');
  await page.locator('article')
    .filter({ hasText: 'Operations Dashboard' })
    .locator('button')
    .first()
    .click();
  await page.getByPlaceholder('描述你想构建的应用...').fill(prompt);
  await page.getByLabel('Build prompt').click();

  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  await expect(page).toHaveURL(/\/chats\/[a-f\d]{24}$/);
  await expect(
    page.frameLocator(
      '[data-testid="snapshot-preview"] iframe[title="Sandpack Preview"]'
    ).getByTestId('generated-app')
  ).toContainText('Generated app', { timeout: 30_000 });

  await page.getByTestId('conversation-timeline').waitFor();
  await page.waitForTimeout(2_500);

  await page.getByRole('button', {
    name: 'Generation model: Deterministic Demo'
  }).click();
  await expect(page.getByRole('dialog', { name: 'Application model' })).toBeVisible();
  await page.waitForTimeout(3_000);
  await page.getByRole('button', { name: 'Close model manager' }).click();
  await page.waitForTimeout(750);

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'src/App.tsx', exact: true }).first()
  ).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: path.join(outputDirectory, 'hero.png'),
    animations: 'disabled'
  });
  await page.waitForTimeout(2_000);

  const timeline = page.getByTestId('conversation-timeline');
  await timeline.hover();
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(2_500);

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('snapshot-preview')).toBeVisible();
  await page.waitForTimeout(4_000);

  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.getByText('Export and deployment adapters', { exact: true }))
    .toBeVisible();
  await page.waitForTimeout(3_500);
});
