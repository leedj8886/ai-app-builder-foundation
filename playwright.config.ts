import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: 'workspace.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results/playwright',
});
