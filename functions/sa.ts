// Pages Function: serve the Simple Analytics proxy script first-party at /sa
// (Cloudflare Pages strips the .ts extension, so functions/sa.ts → route /sa).
// Fetches https://simpleanalyticsexternal.com/proxy.js?hostname=jonathanlloyd.me&path=/simple
// which returns a v11 script baked with our hostname + collection path, then caches
// aggressively at the edge so a transient upstream blip is masked.
//
// On upstream failure: returns a harmless empty 200 JS no-op so the loader's
// onerror path / page is unaffected — never a 5xx.

const SA_PROXY_SCRIPT_URL = 'https://simpleanalyticsexternal.com/proxy.js?hostname=jonathanlloyd.me&path=/simple'

// The collection path baked into the script above must equal the catch-all
// Function route directory (/simple). This string is read by scripts/check-sa-proxy-path.mjs
// for the blocking build assertion (US-003).
export const SA_COLLECTION_PATH = '/simple'

// Minimal Cloudflare Pages Function fetch options — only the cf cache fields used here.
interface CfRequestInit extends RequestInit {
  cf?: {cacheTtl?: number; cacheEverything?: boolean}
}

export async function onRequest(): Promise<Response> {
  const init: CfRequestInit = {cf: {cacheTtl: 86400, cacheEverything: true}}

  let upstream: Response
  try {
    upstream = await fetch(SA_PROXY_SCRIPT_URL, init)
  } catch {
    // Network failure — return a harmless JS no-op so the page is unaffected
    return new Response('/* sa unavailable */', {
      status: 200,
      headers: {'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store'}
    })
  }

  if (!upstream.ok) {
    return new Response('/* sa unavailable */', {
      status: 200,
      headers: {'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store'}
    })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'}
  })
}
