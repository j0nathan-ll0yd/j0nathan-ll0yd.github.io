// Site-plane paths that no package contract carries: the static pages and the sitemap
// index. One module, so the pages, the layout, the sitemap config, and the markdown 404
// name each path once. CloudFront artifact paths stay in @j0nathan-ll0yd/portal-contract.

export const SITE_PAGE_PATHS = {about: '/about', contact: '/contact', developers: '/developers', privacy: '/privacy'} as const

/** The sitemap index @astrojs/sitemap writes, and the Sitemap: line in robots.txt. */
export const SITEMAP_INDEX_PATH = '/sitemap-index.xml'
