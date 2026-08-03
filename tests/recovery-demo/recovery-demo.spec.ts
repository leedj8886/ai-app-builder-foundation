import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const outputDirectory = path.resolve(
  process.env.RECOVERY_DEMO_OUTPUT ?? 'docs/assets/community-preview'
);
const faultMarker = '__CONTROLLED_RECOVERY_DEMO_FAULT__';
const prompt = 'Build an operations dashboard with four KPI cards, a date-range filter, a revenue trend chart, and a compact activity timeline. Use TypeScript and keep all data local to the demo.';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ai-app-builder-language', 'zh-CN');
  });
});

test('records a controlled failure repaired by the real DeepSeek provider', async ({ page }) => {
  await mkdir(outputDirectory, { recursive: true });
  await page.goto('/');
  await page.evaluate(() => {
    const disclosure = document.createElement('div');
    disclosure.dataset.testid = 'recovery-demo-disclosure';
    disclosure.textContent = '受控故障注入 · 真实 DeepSeek 修复 · Developer Preview';
    Object.assign(disclosure.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '9999',
      borderRadius: '8px',
      background: 'rgba(10, 10, 10, 0.9)',
      color: 'white',
      font: '600 13px system-ui, sans-serif',
      padding: '9px 12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
    });
    document.body.appendChild(disclosure);
  });

  const promptInput = page.locator('textarea').first();
  await promptInput.fill(prompt);
  await promptInput.locator('xpath=ancestor::form')
    .locator('button[type="submit"]')
    .click();

  const timeline = page.getByTestId('conversation-timeline');
  await expect(timeline).toContainText(prompt);
  await expect(timeline).toContainText('验证未通过');
  await expect(timeline).toContainText('正在根据诊断修复');
  await expect(page.getByTestId('agent-generation-status'))
    .toHaveAttribute('data-status', 'ready');
  await expect(page).toHaveURL(/\/chats\/[a-f\d]{24}$/);
  await expect(timeline).toContainText('验证通过');
  await expect(timeline).toContainText('快照已生成');
  await expect(timeline).toContainText('deepseek · deepseek-v4-flash');

  await page.getByRole('button', { name: '代码', exact: true }).click();
  const appFile = page.getByRole('button', {
    name: 'src/App.tsx',
    exact: true
  }).first();
  await expect(appFile).toBeVisible();
  await appFile.click();
  await expect(page.locator('pre code')).not.toContainText(faultMarker);

  await page.screenshot({
    path: path.join(outputDirectory, 'recovery-hero.png'),
    animations: 'disabled'
  });

  await timeline.hover();
  await page.mouse.wheel(0, 620);
  await page.waitForTimeout(9_000);

  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expect(page.locator('pre code')).not.toContainText(faultMarker);
  await page.waitForTimeout(8_000);

  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByTestId('verified-build-preview')).toBeVisible();
  await page.waitForTimeout(10_000);
});
