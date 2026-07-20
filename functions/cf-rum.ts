// Pages Function: first-party collector for Cloudflare Web Analytics RUM data.
// The beacon (loaded first-party via /cf-insights.js) is configured with
// data-cf-beacon send.to="/cf-rum", so the browser POSTs RUM payloads here —
// same-origin, so Safari's tracker blocklist never sees a cloudflareinsights.com
// request. This Function forwards the payload SERVER-SIDE to the real collector
// at https://cloudflareinsights.com/cdn-cgi/rum. Mirrors the Simple Analytics
// collector proxy (functions/simple/[[path]].ts).
//
// Response contract: ALWAYS a clean 2xx to the browser (upstream status when 2xx,
// else 204) and Cache-Control: no-store — never a 4xx/5xx, which would surface as
// a console error and trip the post-deploy smoke check.

const RUM_UPSTREAM = 'https://cloudflareinsights.com/cdn-cgi/rum'

// Minimal Cloudflare Pages Function context — only the field used here.
interface PagesContext {
  request: Request
}

// Minimal CF fetch extensions. `duplex` is required by undici (Node) when
// streaming a request body; it is a no-op on the Cloudflare Workers runtime.
interface CfRequestInit extends RequestInit {
  duplex?: 'half'
}

function noContent(): Response {
  return new Response(null, {status: 204, headers: {'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store'}})
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const {request} = context

  // The beacon only POSTs; anything else is a no-op.
  if (request.method !== 'POST') {
    return noContent()
  }

  const outboundHeaders: Record<string, string> = {}
  const contentType = request.headers.get('Content-Type')
  if (contentType) {
    outboundHeaders['Content-Type'] = contentType
  }
  const clientIp = request.headers.get('CF-Connecting-IP')
  if (clientIp) {
    outboundHeaders['X-Forwarded-For'] = clientIp
  }

  let upstream: Response
  try {
    const init: CfRequestInit = {method: 'POST', headers: outboundHeaders, body: request.body, duplex: 'half'}
    upstream = await fetch(RUM_UPSTREAM, init)
  } catch {
    // Network failure — swallow so the page stays clean (data best-effort).
    return noContent()
  }

  // Forward a 2xx through; collapse any non-2xx to 204 so the browser never
  // logs an error (RUM data is best-effort telemetry).
  if (upstream.ok) {
    return new Response(null, {status: 204, headers: {'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store'}})
  }
  return noContent()
}
