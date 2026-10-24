// On-demand route: CSP violation report collector.
// Accepts reports from the browser Reporting API (application/reports+json)
// and the legacy report-uri mechanism (application/csp-report). Always returns
// 204 so the browser does not retry. Logs a single structured line per invocation
// visible in `wrangler tail`.

import {apiMethodNotAllowed} from '../../lib/edge/api-v1'
import {edgeRoute} from '../../lib/edge/routes'

// The route context -- only the fields this handler reads (src/lib/edge/routes.ts EdgeContext).
interface PagesContext {
  request: Request
}

const ACCEPTED_CONTENT_TYPES = [
  'application/csp-report',
  'application/reports+json'
]

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const {request} = context

  const contentType = request.headers.get('Content-Type') ?? ''
  const accepted = ACCEPTED_CONTENT_TYPES.some((t) => contentType.includes(t))
  if (!accepted) {
    return new Response(null, {status: 415})
  }

  const userAgent = request.headers.get('User-Agent') ?? ''

  try {
    const body = await request.text()
    // Parse permissively -- both report types are JSON; swallow errors so a
    // malformed body never causes a retry storm.
    let report: unknown
    try {
      report = JSON.parse(body)
    } catch {
      report = {raw: body}
    }

    console.log(JSON.stringify({event: 'csp-report', userAgent, report}))
  } catch {
    // Body read failure -- still return 204 to suppress retries.
  }

  return new Response(null, {status: 204})
}

/** The collector accepts POST only. Any other method answers the developer API's 405 problem, never the HTML 404. */
export function onRequest(context: PagesContext): Promise<Response> | Response {
  return context.request.method === 'POST' ? onRequestPost(context) : apiMethodNotAllowed(context.request, 'POST')
}

// On-demand, every method (atlas decision 0160, PR A; is-agentic api-v1 plan): POST collects, and
// every other method answers the 405 problem with `Allow: POST`, like every path under /api.
export const prerender = false
export const ALL = edgeRoute(onRequest)
