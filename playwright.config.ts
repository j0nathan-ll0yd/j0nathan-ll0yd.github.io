import {defineConfig} from '@playwright/test'
import {CHROMIUM_DETERMINISM_ARGS} from './tests/shared/chromium-launch-args'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/visual',
  // global-setup guards against a stale dev server squatting the port (it was
  // previously orphaned — defined but never registered). global-teardown
  // losslessly optimizes regenerated baselines (no-op on compare runs).
  globalSetup: './tests/visual/global-setup.ts',
  globalTeardown: './tests/visual/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Serial (workers=1) everywhere -- local and CI, update and compare. At 2x
  // DPR the tall captures (up to 1200x5818) create real per-worker memory
  // pressure under parallel load, which jitters sub-pixel layout (e.g. the
  // system-status popover box.x) enough to flip clip-origin rounding and break
  // byte-for-byte local<->CI parity. Only a single worker is deterministic here.
  // The suite is sharded 4x in CI, so serial is still fast; determinism wins.
  workers: 1,

  reporter: isCI
    ? [['github'], ['blob'], ['html', {open: 'never', outputFolder: 'playwright-report'}]]
    : [['html', {open: 'on-failure'}]],

  webServer: {
    command: process.env.SKIP_BUILD ? 'npm run preview' : 'npm run build && npm run preview',
    url: 'http://localhost:4321/',
    timeout: 120_000,
    reuseExistingServer: !isCI
  },

  use: {
    baseURL: 'http://localhost:4321/',
    // Render at 2x device-pixel ratio so committed baselines are retina-sharp.
    // Deterministic here because every baseline renders in the identical arm64
    // noble container (DPR variance, not DPR value, is the determinism risk).
    deviceScaleFactor: 2,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
    launchOptions: {
      // Determinism flags from tests/shared/chromium-launch-args.ts. Used only by
      // this visual-regression suite; the production smoke check
      // (playwright.smoke.config.ts) deliberately omits them.
      args: [...CHROMIUM_DETERMINISM_ARGS]
    }
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.006, // empirically-calibrated ceiling at 2x DPR: holds the same ABSOLUTE drift sensitivity as the old 0.025 at 1x (4x the pixels -> ~1/4 the ratio); tightened so 2x does not hand back 4x the hiding room for a real memory-pressure divergence
      threshold: 0.2, // per-pixel YIQ color tolerance
      animations: 'disabled', // freeze CSS animations for determinism
      caret: 'hide', // hide blinking text caret
      scale: 'device' // capture at the emulated 2x device px so baselines are retina-resolution (was 'css' at 1x)
    }
  },

  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',

  projects: [
    {name: 'desktop-1400', use: {browserName: 'chromium', viewport: {width: 1400, height: 900}}},
    {name: 'tablet-1100', use: {browserName: 'chromium', viewport: {width: 1100, height: 800}}},
    {name: 'tablet-768', use: {browserName: 'chromium', viewport: {width: 768, height: 1024}}},
    {name: 'mobile-600', use: {browserName: 'chromium', viewport: {width: 600, height: 900}}},
    {name: 'mobile-390', use: {browserName: 'chromium', viewport: {width: 390, height: 844}}}
  ]
})
