// The built files the Worker reads for `/` (atlas decision 0160, PR B). Both come through the ASSETS
// binding: the data-free page for every `GET /` and `HEAD /` (the shell the fragments are spliced
// into, and the whole answer when no composed page may be served), and the value-free pages.
/** The prerendered data-free page (dist/client/index.html). */
export const DATA_FREE_PAGE_PATH = '/'

/**
 * The value-free pages, as the website build composes them (scripts/build-composer.mjs): one per
 * hiding focus value, one for the gate shut over a visible value, one for an unreadable focus signal
 * (./artifact.ts `ValueFreeSet`). This module imports nothing, so the build script can read it.
 */
export const VALUE_FREE_PATH = '/_ssr/value-free.json'

/**
 * Built files only the Worker reads. wrangler.jsonc `run_worker_first` lists them, so a public
 * request reaches the Worker, which answers with the 404 page; the ASSETS binding still serves them.
 */
export const INTERNAL_ASSET_PATHS: readonly string[] = Object.freeze([VALUE_FREE_PATH])

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
