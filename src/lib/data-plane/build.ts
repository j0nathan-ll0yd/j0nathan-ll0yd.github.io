// The Worker's build id (atlas decision 0160, PR B): the commit astro.config.mjs passes as
// `__SSR_BUILD_ID__`, from the one helper scripts/lib/build-id.mjs. It stamps the `ssr_render` log
// line, and the Worker serves a composed artifact only when the artifact's composer build equals it.
declare const __SSR_BUILD_ID__: string | undefined

export const BUILD_ID: string = typeof __SSR_BUILD_ID__ === 'undefined' ? 'unknown' : __SSR_BUILD_ID__
