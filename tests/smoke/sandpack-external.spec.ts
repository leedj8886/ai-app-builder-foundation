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

test('legacy Tailwind Snapshot compiles through the external Sandpack runtime', async ({ page }) => {
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
