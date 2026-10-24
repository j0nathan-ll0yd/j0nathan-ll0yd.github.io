// On-demand route: every path under /api that no other route serves answers the developer API's
// not-found problem (application/problem+json), never the HTML 404 page. /api/csp-report and
// /api/v1/* have their own routes. See src/lib/edge/api-v1.ts.

import {apiNotFound} from '../../lib/edge/api-v1'
import {edgeRoute} from '../../lib/edge/routes'

// On-demand: this route runs in the Worker on every request, for every method.
export const prerender = false
export const ALL = edgeRoute((context) => apiNotFound(context.request))
