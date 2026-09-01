import {defineConfig} from '@playwright/test'

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

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/behavioral',
  // The signed OpenSpec covers contract deliberately scans only `*.test.ts`.
  // Keep these conformance matrices on that suffix and name them explicitly
  // so Playwright executes their requirement tethers without broadening discovery.
  // A matrix missing from this list still parses as a covers tether but NEVER RUNS,
  // which would report a requirement as verified by a test nothing executes.
  testMatch: [
    '**/*.spec.ts',
    '**/articles-matrix.test.ts',
    '**/bookshelf-matrix.test.ts',
    '**/devlog-matrix.test.ts',
    '**/health-matrix.test.ts',
    '**/theatre-reviews-matrix.test.ts'
  ],
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 30_000,

  reporter: isCI
    ? [['github'], ['html', {open: 'never', outputFolder: 'playwright-report'}]]
    : [['list'], ['html', {open: 'on-failure'}]],

  webServer: {
    command: process.env.SKIP_BUILD
      ? 'pnpm run preview'
      : 'pnpm run build && pnpm run preview',
    url: 'http://localhost:4321/',
    timeout: 120_000,
    reuseExistingServer: !isCI
  },

  use: {
    baseURL: 'http://localhost:4321/',
    // No screenshots — DOM/interaction assertions only.
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'on-first-retry',
    // Block service workers so they don't intercept fetch calls.
    serviceWorkers: 'block'
  },

  projects: [
    {name: 'behavioral-chromium', use: {browserName: 'chromium', viewport: {width: 1400, height: 900}}},
    {
      // Scoped to the mobile-layout spec only — book-modal.spec.ts assumes a
      // desktop layout and would emit false failures at 390px.
      name: 'behavioral-mobile-chromium',
      testMatch: '**/mobile-layout.spec.ts',
      use: {browserName: 'chromium', viewport: {width: 390, height: 844}, hasTouch: true}
    }
  ]
})
