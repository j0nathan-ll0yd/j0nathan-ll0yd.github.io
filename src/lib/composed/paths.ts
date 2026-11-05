// The built file the Worker reads for `/` (atlas decision 0160, PR B), through the ASSETS binding: the
// data-free page for every `GET /` and `HEAD /` (the shell the fragments are spliced into, and the
// whole answer when no composed page may be served). The value-free pages are not a file: the build
// compiles them into the Worker (./value-free.ts, atlas decision 0164 row 1). This module imports
// nothing, so the build scripts can read it.
/** The prerendered data-free page (dist/client/index.html). */
export const DATA_FREE_PAGE_PATH = '/'

/**
 * The version of the contract between the composer and the backend runner that loads it: what
 * version.json names (`composer.path`, `composer.sha256`, `composer.contract`) and what the module
 * exports (`COMPOSER_CONTRACT`, `COMPOSER_BUILD`, `composeDashboard`). The runner refuses any other.
 */
export const COMPOSER_CONTRACT = 1

/** The public path of a build's composer, served by the static-asset plane with no Worker CPU. */
export function composerAssetPath(build: string): string {
  return `/_ssr/composer-${build}.mjs`
}
