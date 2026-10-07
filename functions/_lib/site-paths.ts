// Site-plane paths that no package contract carries: the static text pages and the
// sitemap index. One module, so the pages, the layout, the sitemap config, and the
// markdown 404 name each path once. CloudFront artifact paths stay in
// @j0nathan-ll0yd/portal-contract; /developers is AGENT_PATHS.developers in agent-paths.mjs.

export const SITE_PAGE_PATHS = {about: '/about', contact: '/contact', privacy: '/privacy'} as const

/**
 * The sitemap index @astrojs/sitemap writes: the Sitemap: line in robots.txt, the layout's
 * rel="sitemap" link, and the markdown 404. LINK_HEADER in functions/_middleware.ts still
 * states the literal; the agent-interfaces change owns that header.
 */
export const SITEMAP_INDEX_PATH = '/sitemap-index.xml'
