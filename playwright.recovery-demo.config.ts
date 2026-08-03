import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/recovery-demo',
  testMatch: 'recovery-demo.spec.ts',
  timeout: 12 * 60_000,
  expect: { timeout: 8 * 60_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.RECOVERY_DEMO_URL ?? 'http://127.0.0.1:4175',
    channel: process.env.RECOVERY_DEMO_BROWSER_CHANNEL ??
      (process.platform === 'darwin' ? 'chrome' : undefined),
    colorScheme: 'light',
    viewport: { width: 1440, height: 900 },
    video: {
      mode: 'on',
      size: { width: 1440, height: 900 }
    },
    trace: 'off',
    screenshot: 'off'
  },
  outputDir: 'work/recovery-demo-playwright'
});
