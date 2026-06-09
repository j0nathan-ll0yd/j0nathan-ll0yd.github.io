/**
 * Playwright test fixtures with PNG IEND-truncation patch.
 *
 * Imports `test` and `expect` from this file (NOT from `@playwright/test`) so the
 * worker-scoped `pngTruncation` fixture activates for every test in the importing file.
 * The fixture monkey-patches Playwright's bundled `pngjs.PNG.sync.read` once per
 * worker process to truncate buffers at the PNG IEND chunk before pngjs sees them.
 *
 * Why a worker-scoped fixture (not globalSetup):
 *   - globalSetup runs in the main runner process only
 *     (node_modules/playwright/lib/runner/tasks.js:165-181)
 *   - Workers are forked via child_process.fork
 *     (node_modules/playwright/lib/runner/processHost.js:54)
 *   - Each worker has its own module cache. A globalSetup patch never reaches them.
 *   - The comparator (comparators.js:64-65) runs IN-PROCESS in each worker.
 *   - Therefore the patch must be applied inside a worker-scoped fixture.
 *
 * Why createRequire:
 *   - package.json has "type": "module"; bare require() is not available.
 *   - playwright-core/lib/utilsBundle is CJS; the CJS-from-ESM pattern is
 *     `createRequire(import.meta.url)`.
 *
 * Kill switch: set SKIP_PNG_TRUNCATION=1 to disable the patch (useful for verifying
 * the patch IS the load-bearing fix, or for debugging a future Playwright upgrade).
 */

import { test as base, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { truncateAtIEND } from './png-iend-truncate';

const require = createRequire(import.meta.url);

type WorkerFixtures = { pngTruncation: void };

export const test = base.extend<{}, WorkerFixtures>({
  pngTruncation: [
    async ({}, use) => {
      if (!process.env.SKIP_PNG_TRUNCATION) {
        // playwright-core/lib/utilsBundle.js re-exports PNG from the bundled pngjs.
        // Mutating PNG.sync.read in this worker's module cache is the only correctness
        // mechanism — covers both page.screenshot and locator.screenshot comparisons
        // since both flow through comparators.js → PNG.sync.read.
        const ub = require('playwright-core/lib/utilsBundle');
        const origRead = ub.PNG.sync.read;
        if (origRead.name !== 'truncatedRead') {
          ub.PNG.sync.read = function truncatedRead(buf: Buffer, opts?: unknown) {
            return origRead(truncateAtIEND(buf), opts);
          };
        }
        // Smoke check: if the patch silently failed (e.g. Playwright restructured
        // utilsBundle in a future version), this warning surfaces in CI step logs.
        if (ub.PNG.sync.read.name !== 'truncatedRead') {
          // eslint-disable-next-line no-console
          console.warn('[pw-fixtures] PNG.sync.read patch did NOT take effect — check Playwright internals');
        }
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect, type Page };
