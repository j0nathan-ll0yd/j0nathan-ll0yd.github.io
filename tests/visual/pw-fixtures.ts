/**
 * Playwright test fixtures with PNG IEND-truncation patch.
 *
 * Imports `test` and `expect` from this file (NOT from `@playwright/test`) so the
 * worker-scoped `pngTruncation` fixture activates for every test in the importing file.
 * The fixture monkey-patches Playwright's bundled `pngjs.PNG.sync.read` once per
 * worker process to truncate buffers at the PNG IEND chunk before pngjs sees them.
 *
 * Strategy: the patch is applied at MODULE LOAD time (top-level) AND inside a
 * worker-scoped auto fixture. The module-load patch is the primary mechanism --
 * when this file is imported by a spec, the patch fires in that worker's module
 * cache immediately, before any test runs. The fixture is belt-and-suspenders.
 *
 * Why a worker-scoped patch (not globalSetup):
 *   - globalSetup runs in the main runner process only
 *     (node_modules/playwright/lib/runner/tasks.js:165-181)
 *   - Workers are forked via child_process.fork
 *     (node_modules/playwright/lib/runner/processHost.js:54)
 *   - Each worker has its own module cache. A globalSetup patch never reaches them.
 *   - The comparator (comparators.js:64-65) runs IN-PROCESS in each worker.
 *   - The PRINCIPLE is therefore: patch in worker scope. Module-load (this file
 *     imported by spec) and worker fixture both run in worker scope.
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

/**
 * Apply the PNG.sync.read patch. Idempotent: re-patching is a no-op due to the
 * name guard. Returns true if patch is in place after the call.
 */
function applyPngTruncationPatch(): boolean {
  if (process.env.SKIP_PNG_TRUNCATION) {
    return false;
  }
  try {
    const ub = require('playwright-core/lib/utilsBundle');
    const origRead = ub.PNG.sync.read;
    if (origRead.name !== 'truncatedRead') {
      ub.PNG.sync.read = function truncatedRead(buf: Buffer, opts?: unknown) {
        // DIAGNOSTIC: log every invocation to prove the comparator hits our patch
        const truncated = truncateAtIEND(buf);
        // eslint-disable-next-line no-console
        console.log(`[pw-fixtures] truncatedRead invoked buf.length=${buf?.length} truncated.length=${truncated?.length} delta=${(buf?.length ?? 0) - (truncated?.length ?? 0)}`);
        return origRead(truncated, opts);
      };
    }
    // Also check descriptor — if frozen, assignment silently failed
    const descriptor = Object.getOwnPropertyDescriptor(ub.PNG.sync, 'read');
    // eslint-disable-next-line no-console
    console.log(`[pw-fixtures] PNG.sync.read descriptor writable=${descriptor?.writable} configurable=${descriptor?.configurable} value.name=${ub.PNG.sync.read.name}`);
    return ub.PNG.sync.read.name === 'truncatedRead';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pw-fixtures] PNG.sync.read patch FAILED:', err instanceof Error ? err.message : err);
    return false;
  }
}

// MODULE-LOAD: apply patch immediately when this file is imported. This is the
// primary mechanism — imports happen in each worker's process before any test
// code runs, so the patch is in place before the comparator is ever called.
const moduleLoadPatchOk = applyPngTruncationPatch();
// eslint-disable-next-line no-console
console.log(`[pw-fixtures] module-load patch applied=${moduleLoadPatchOk} pid=${process.pid}`);

type WorkerFixtures = { pngTruncation: void };

export const test = base.extend<{}, WorkerFixtures>({
  pngTruncation: [
    async ({}, use) => {
      // Belt-and-suspenders: re-apply at fixture activation (idempotent).
      const ok = applyPngTruncationPatch();
      if (!ok && !process.env.SKIP_PNG_TRUNCATION) {
        // eslint-disable-next-line no-console
        console.warn('[pw-fixtures] PNG.sync.read patch did NOT take effect — check Playwright internals');
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect, type Page };
