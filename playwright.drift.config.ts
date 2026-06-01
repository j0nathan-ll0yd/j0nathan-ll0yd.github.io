import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/drift',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  workers: 1,

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['html', { open: 'on-failure' }]],

  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--force-device-scale-factor=1'],
    },
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05, // 5% tolerance — intentionally looser than regression (2.5%)
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  snapshotPathTemplate:
    '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',

  projects: [
    {
      name: 'desktop-1400',
      use: { browserName: 'chromium', viewport: { width: 1400, height: 900 } },
    },
  ],
});
