import { defineConfig } from '@playwright/test';

// Behavioral (interaction) test suite for BookModal.
//
// This is NOT a visual/pixel suite. It takes no screenshots; it asserts
// DOM/interaction behavior: open, close, Escape, backdrop dismiss, focus
// restore, focus containment (background inert), analytics single-fire,
// and the CSP onerror-fix (no inline onerror= attribute on cover img).
//
// Uses the same production build + preview server as the visual suite
// (localhost:4321) with fixture route interception so the bookshelf is
// deterministically populated. SKIP_BUILD=1 skips the astro build step
// when the dist/ is already current.

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/behavioral',
  testMatch: '**/*.spec.ts',

  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 30_000,

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  webServer: {
    command: process.env.SKIP_BUILD
      ? 'npm run preview'
      : 'npm run build && npm run preview',
    url: 'http://localhost:4321/',
    timeout: 120_000,
    reuseExistingServer: !isCI,
  },

  use: {
    baseURL: 'http://localhost:4321/',
    // No screenshots — DOM/interaction assertions only.
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'on-first-retry',
    // Block service workers so they don't intercept fetch calls.
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'behavioral-chromium',
      use: { browserName: 'chromium', viewport: { width: 1400, height: 900 } },
    },
  ],
});
