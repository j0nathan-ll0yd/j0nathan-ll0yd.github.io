// The built files the Worker reads for `/` (atlas decision 0160, PR B). Both come through the ASSETS
// binding: the data-free page for every `GET /` and `HEAD /` (the shell the fragments are spliced
// into, and the whole answer when no composed page may be served), and the value-free pages.
import {VALUE_FREE_PATH} from './artifact'

/** The prerendered data-free page (dist/client/index.html). */
export const DATA_FREE_PAGE_PATH = '/'

/**
 * Built files only the Worker reads. wrangler.jsonc `run_worker_first` lists them, so a public
 * request reaches the Worker, which answers with the 404 page; the ASSETS binding still serves them.
 */
export const INTERNAL_ASSET_PATHS: readonly string[] = Object.freeze([VALUE_FREE_PATH])
