import { defineConfig } from 'vitest/config';

// Unit tests for the app-owned client runtime (src/lib/runtime/*): fetch/poll/
// WebSocket logic relocated from @lifegames/web. These mock the network and run
// under jsdom — deliberately separate from vitest.build.config.ts, whose
// globalSetup runs a full `astro build` (wrong/slow for fetch-mocked unit tests).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    clearMocks: true,
  },
});
