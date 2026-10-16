// Paths of the edge injection (atlas decision 0160, PR B, owner decision 2026-10-16, option B).
//
// The Worker answers `GET /` by streaming the prerendered data-free page through HTMLRewriter. A card
// in a non-data state takes its value-free template from TEMPLATES_PAGE_PATH, which the build
// prerenders from the design system's own components. Both files are internal: the Worker reads them
// through the ASSETS binding, and a public request for the templates page gets the 404 page.

/** The prerendered data-free page (dist/client/index.html): the stream the Worker rewrites. */
export const DATA_FREE_PAGE_PATH = '/'

/** The prerendered, value-free card templates (src/pages/ssr-templates.astro). */
export const TEMPLATES_PAGE_PATH = '/ssr-templates'

/** The attribute that names one template: `<card id>:<state>`. */
export const TEMPLATE_ATTRIBUTE = 'data-ssr-template'
