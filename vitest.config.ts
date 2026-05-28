/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/build/**', 'tests/visual/**'],
    clearMocks: true,
  },
});
