import {defineConfig} from '@playwright/test'
import {SITE_URL} from '@lifegames/portal-contract/constants'

// Production smoke check — runs against the LIVE deployed site after each deploy.
//
// This is NOT a visual/pixel suite. It takes no screenshots and needs no
// cross-OS determinism. It therefore deliberately does NOT import
// tests/shared/chromium-launch-args.ts (the SwiftShader/GPU determinism flags
// that segfault under QEMU on Apple Silicon) and never runs through
// scripts/run-in-docker.sh. A native Chromium on any platform is correct here —
// the check runs locally on arm64 (no Docker) and on CI ubuntu-latest (native
// amd64) identically.
//
// Replaces the retired pixel-drift suite, which pixel-diffed a frozen baseline
// against a live data stream and could never stay green — and structurally
// could not catch the failure mode it existed for (an island whose hydration
// script is CSP-blocked still renders its SSR shell at correct pixels). This
// suite asserts the DOM actually hydrated instead.

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.smoke.ts',

  // Single worker: don't hammer the live site with parallel page loads.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,

  // Retries only on CI, to absorb transient CDN/network blips on a live target
  // without masking real deploy failures.
  retries: isCI ? 2 : 0,

  // Generous per-test timeout for a cold CDN edge + service-worker startup.
  timeout: 45_000,

  reporter: isCI
    ? [['github'], ['html', {open: 'never', outputFolder: 'playwright-report'}]]
    : [['list'], ['html', {open: 'on-failure'}]],

  use: {
    baseURL: SITE_URL,
    // No screenshots, no pixel determinism — this is a logic/DOM check.
    screenshot: 'off',
    video: 'off',
    // Trace only on the retry that follows a failure — zero overhead on green runs.
    trace: 'on-first-retry',
    // Do NOT block service workers: the smoke check verifies the SW registers.
    // Do NOT set bypassCSP: real CSP enforcement is what catches the #50 class.
    serviceWorkers: 'allow'
  },

  projects: [
    {name: 'smoke-chromium', use: {browserName: 'chromium', viewport: {width: 1400, height: 900}}}
  ]
})
