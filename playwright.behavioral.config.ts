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
/** The `wrangler dev` port of the developer API suite (tests/behavioral/api-v1.spec.ts reads the same variable). */
const WRANGLER_DEV_PORT = process.env.WRANGLER_DEV_PORT ?? '8788'
/** The rate-limiter Worker's `wrangler dev` port. */
const RATE_LIMITER_DEV_PORT = process.env.RATE_LIMITER_DEV_PORT ?? '8790'
const NO_JS_SPECS = ['**/ssr-no-js.test.ts', '**/site-footer-nav.test.ts']

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
    '**/client-states.test.ts',
    '**/data-free-shell.test.ts',
    '**/devlog-matrix.test.ts',
    '**/health-matrix.test.ts',
    '**/site-footer-nav.test.ts',
    '**/ssr-no-js.test.ts',
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

  // Two servers. The fixture data plane (tests/data-plane/server.ts) answers the export paths the
  // Worker reads for the server render of `/` (atlas decision 0160, PR B). The preview runs the real
  // Worker in workerd; write-dev-vars.mjs runs after the build because postbuild deletes the file.
  webServer: [
    {
      // The rate-limiter Worker (workers/rate-limiter/), first, so the site Worker's API_RATE_LIMITER
      // binding (`script_name`) finds it in the local dev registry when `wrangler dev` starts below. Its
      // fetch answers 404 by design, so readiness is the open port, not a URL.
      command: `pnpm exec wrangler dev --config workers/rate-limiter/wrangler.jsonc --ip 127.0.0.1 --port ${RATE_LIMITER_DEV_PORT}`,
      port: Number(RATE_LIMITER_DEV_PORT),
      timeout: 60_000,
      reuseExistingServer: !isCI
    },
    {
      command: 'node scripts/build-composer.mjs && pnpm exec tsx tests/data-plane/server.ts',
      url: 'http://127.0.0.1:4399/__control/requests',
      timeout: 30_000,
      reuseExistingServer: !isCI
    },
    {
      command: process.env.SKIP_BUILD
        ? 'node tests/data-plane/write-dev-vars.mjs && pnpm run preview'
        : 'pnpm run build && node tests/data-plane/write-dev-vars.mjs && pnpm run preview',
      url: 'http://localhost:4321/',
      timeout: 120_000,
      reuseExistingServer: !isCI
    },
    {
      // The same build under `wrangler dev`, for tests/behavioral/api-v1.spec.ts: `astro preview`
      // answers an OPTIONS preflight itself, before the Worker, so the developer API's CORS answer and
      // its Durable Object rate limiter are measured here. It reads the .dev.vars the preview step writes.
      command: `pnpm exec wrangler dev --config dist/server/wrangler.json --ip 127.0.0.1 --port ${WRANGLER_DEV_PORT}`,
      url: `http://127.0.0.1:${WRANGLER_DEV_PORT}/version.json`,
      timeout: 120_000,
      reuseExistingServer: !isCI
    }
  ],

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
    {name: 'behavioral-chromium', testIgnore: NO_JS_SPECS, use: {browserName: 'chromium', viewport: {width: 1400, height: 900}}},
    {
      // The server render read with JavaScript off (plan Step 6.3): what a crawler or a no-JS
      // visitor gets. It is part of the blocking `behavioral` gate with the rest of the suite.
      name: 'behavioral-no-js',
      testMatch: NO_JS_SPECS,
      use: {browserName: 'chromium', viewport: {width: 1400, height: 900}, javaScriptEnabled: false}
    },
    {
      // Scoped to the layout specs only — book-modal.spec.ts assumes a
      // desktop layout and would emit false failures at 390px.
      name: 'behavioral-mobile-chromium',
      testMatch: ['**/mobile-layout.spec.ts', '**/text-pages.spec.ts'],
      use: {browserName: 'chromium', viewport: {width: 390, height: 844}, hasTouch: true}
    }
  ]
})
