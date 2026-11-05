// Site-plane paths that no package contract carries: the static text pages and the
// sitemap index. One module, so the pages, the layout, the sitemap config, and the
// markdown 404 name each path once. CloudFront artifact paths stay in
// @j0nathan-ll0yd/portal-contract; /developers is AGENT_PATHS.developers in agent-paths.mjs.

export const SITE_PAGE_PATHS = {about: '/about', contact: '/contact', privacy: '/privacy'} as const

/**
 * The sitemap index @astrojs/sitemap writes: the Sitemap: line in robots.txt, the layout's
 * rel="sitemap" link, the homepage Link header, and the markdown 404.
 */
export const SITEMAP_INDEX_PATH = '/sitemap-index.xml'

/**
 * The RFC 9116 security.txt, a static file in public/.well-known/. It is the one served file that
 * keeps the contact address in clear (RFC 9116 requires it), so /contact links here without
 * JavaScript (atlas decision 0158, owner ruling 2026-10-15).
 */
export const SECURITY_TXT_PATH = '/.well-known/security.txt'

/**
 * The 512x512 site icon (also the web manifest's large icon). The homepage JSON-LD Organization
 * names it as its logo.
 */
export const SITE_LOGO = {path: '/assets/icon-512.png', width: 512, height: 512} as const
