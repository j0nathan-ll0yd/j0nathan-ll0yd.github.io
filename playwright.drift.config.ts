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
    // Determinism flags eliminate sub-pixel rendering variance across CI/local. Do not remove without verifying baselines still pass.
    launchOptions: {
      args: [
        '--force-device-scale-factor=1',
        '--font-render-hinting=none',          // kills hinting variance across OS
        '--disable-lcd-text',                  // disables subpixel anti-aliasing
        '--disable-font-subpixel-positioning', // snaps glyphs to pixel grid
        '--disable-skia-runtime-opts',         // deterministic Skia rendering path
        '--disable-dev-shm-usage',             // avoid 64MB /dev/shm limit on tall fullPage screenshots
      ],
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
    {
      name: 'tablet-1100',
      use: { browserName: 'chromium', viewport: { width: 1100, height: 900 } },
    },
    {
      name: 'tablet-768',
      use: { browserName: 'chromium', viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'mobile-600',
      use: { browserName: 'chromium', viewport: { width: 600, height: 900 } },
    },
  ],
});
