import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: ['workspace.spec.ts', 'sandpack-external.spec.ts'],
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:4173',
    channel: process.env.SMOKE_BROWSER_CHANNEL ??
      (process.platform === 'darwin' ? 'chrome' : undefined),
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results/playwright',
});
