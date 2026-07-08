// Pages Function: serve the Cloudflare Web Analytics beacon first-party at
// /cf-insights.js (Cloudflare Pages strips the .ts extension, so
// functions/cf-insights.js.ts → route /cf-insights.js).
//
// Why: Safari's Advanced Tracking & Fingerprinting Protection triggers the
// "reduce protections" banner on a *domain* blocklist match — static.cloudflare
// insights.com / cloudflareinsights.com are classified trackers. Re-serving
// beacon.min.js same-origin removes the third-party script load; the beacon is
// configured in the page markup (data-cf-beacon send.to) to POST RUM data to the
// first-party /cdn-cgi/rum endpoint, which Cloudflare handles natively for
// proxied (orange-clouded) zones. Net result: zero cloudflareinsights.com
// requests, so no blocklist match and no banner — while keeping full Web
// Analytics (page views + Core Web Vitals).
//
// On upstream failure: returns a harmless empty 200 JS no-op so the page is
// never affected — never a 5xx (which would trip the smoke console-error check).
// Mirrors functions/sa.ts (the Simple Analytics first-party proxy).

const BEACON_URL = 'https://static.cloudflareinsights.com/beacon.min.js';

// Minimal Cloudflare Pages Function fetch options — only the cf cache fields used here.
interface CfRequestInit extends RequestInit {
  cf?: { cacheTtl?: number; cacheEverything?: boolean; };
}

function unavailable(): Response {
  return new Response('/* cf-insights unavailable */', {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequest(): Promise<Response> {
  const init: CfRequestInit = {
    cf: { cacheTtl: 86400, cacheEverything: true },
  };

  let upstream: Response;
  try {
    upstream = await fetch(BEACON_URL, init);
  } catch {
    return unavailable();
  }

  if (!upstream.ok) {
    return unavailable();
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    },
  });
}
