// Keeps the browser bundle free of a `process` global (atlas decision 0160, PR A).
//
// @astrojs/cloudflare sets a top-level Rolldown `output.banner`,
// "globalThis.process ??= {}; globalThis.process.env ??= {};", in its astro:build:setup hook. It
// means the banner for the Worker bundle, but every Vite environment inherits top-level build
// options, so the client chunks carried it too and every browser gained a `process` global it never
// had on Pages. The Worker does not need it: wrangler.jsonc sets `nodejs_compat`, which provides
// `process`. This plugin clears the banner for the `client` environment only.
//
// tests/build/worker-output.test.ts fails if any built client chunk starts with the banner again.

export const PROCESS_BANNER_MARKER = 'globalThis.process'

/** @returns {import('vite').Plugin} */
export function clientNoProcessBanner() {
  return {
    name: 'client-no-process-banner',
    configEnvironment(name) {
      if (name !== 'client') {
        return null
      }
      return {build: {rolldownOptions: {output: {banner: ''}}}}
    }
  }
}
