// The data-free page's path (atlas decision 0160, PR B). The Worker reads it through the ASSETS
// binding for every `GET /` and `HEAD /`: as the shell the composed fragments are spliced into, and
// as the whole answer when no composed page may be served.

/** The prerendered data-free page (dist/client/index.html). */
export const DATA_FREE_PAGE_PATH = '/'
