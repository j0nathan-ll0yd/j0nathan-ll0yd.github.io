import {defineConfig} from 'vitest/config'

// Unit tests for the app-owned client runtime (src/lib/runtime/*): fetch/poll/
// WebSocket logic relocated from @lifegames/web. These mock the network and run
// under jsdom — deliberately separate from vitest.build.config.ts, whose
// globalSetup runs a full `astro build` (wrong/slow for fetch-mocked unit tests).
//
// tests/audit/**/*.test.ts (added for lp-audit Phase 2) exercise the pure
// validation functions exported from scripts/audit/*.mjs against local
// fixtures -- no network, no jsdom-specific APIs needed, but jsdom is a
// superset environment so plain Node/string-logic tests run fine under it
// without a third vitest config.
export default defineConfig({test: {environment: 'jsdom', include: ['tests/unit/**/*.test.ts', 'tests/audit/**/*.test.ts'], clearMocks: true}})
