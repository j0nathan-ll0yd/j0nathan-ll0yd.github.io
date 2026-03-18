import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/build/**/*.test.ts'],
    globalSetup: ['tests/build/setup.ts'],
  },
});
