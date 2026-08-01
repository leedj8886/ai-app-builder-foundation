import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/community-demo',
  testMatch: 'community-demo.spec.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.COMMUNITY_DEMO_URL ?? 'http://127.0.0.1:4174',
    channel: process.env.COMMUNITY_DEMO_BROWSER_CHANNEL ??
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
  outputDir: 'work/community-demo-playwright'
});
