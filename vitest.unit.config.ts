import {defineConfig} from 'vitest/config'
import {MIRRORED_BOOK_COVERS_DEFINE, mirroredBookCovers} from './src/lib/book-cover-mirror'

// Unit tests for the app-owned client runtime (src/lib/runtime/*): fetch/poll/
// WebSocket logic relocated from @j0nathan-ll0yd/web. These mock the network and run
// under jsdom — deliberately separate from vitest.build.config.ts, whose
// globalSetup runs a full `astro build` (wrong/slow for fetch-mocked unit tests).
//
// audits/__tests__/**/*.test.ts (added for lp-audit Phase 2, moved out of
// tests/audit/ by atlas decision 0111 phase 2b) exercise the pure validation
// functions exported from audits/checks/*.mjs and audits/lib/* against local
// fixtures -- no network, no jsdom-specific APIs needed, but jsdom is a
// superset environment so plain Node/string-logic tests run fine under it
// without a third vitest config.
// The build-time cover list astro.config.mjs defines, so src/lib/load-dashboard-data.ts reads the real mirror here too.
export default defineConfig({
  define: {[MIRRORED_BOOK_COVERS_DEFINE]: JSON.stringify(mirroredBookCovers()), __SSR_BUILD_ID__: JSON.stringify('test')},
  test: {environment: 'jsdom', include: ['tests/unit/**/*.test.ts', 'audits/__tests__/**/*.test.ts'], clearMocks: true}
})
