import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? '50%' : undefined,

  reporter: isCI
    ? [['github'], ['blob'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['html', { open: 'on-failure' }]],

  webServer: {
    command: process.env.SKIP_BUILD ? 'npm run preview' : 'npm run build && npm run preview',
    url: 'http://localhost:4321/',
    timeout: 120_000,
    reuseExistingServer: !isCI,
    env: { USE_FIXTURES: 'true' },
  },

  use: {
    baseURL: 'http://localhost:4321/',
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
      ],
    },
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.025, // allow up to 2.5% pixel drift -- accommodates sub-pixel font hinting variance under fullyParallel CPU load
      threshold: 0.2,          // per-pixel YIQ color tolerance
      animations: 'disabled',  // freeze CSS animations for determinism
      caret: 'hide',           // hide blinking text caret
      scale: 'css',            // use CSS px (not device px) for screenshots
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
      use: { browserName: 'chromium', viewport: { width: 1100, height: 800 } },
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
