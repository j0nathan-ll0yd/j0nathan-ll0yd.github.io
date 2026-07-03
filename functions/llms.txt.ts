// Pages Function: proxy /llms.txt from CloudFront with edge caching.
// The backend (mantle-LifegamesPortal) owns the canonical content; this route
// ensures the spec-required root path resolves on jonathanlloyd.me without a
// hand-maintained static file. The response is wrapped by functions/_middleware.ts,
// which injects the security headers (CSP, X-Content-Type-Options, Referrer-Policy).

import { CLOUDFRONT_BASE } from '@lifegames/portal-contract/constants';

// The /llms.txt discovery index has no dedicated contract path constant
// (LLM_CONTENT_PATHS covers llms-full / llms-small / index.md); the host is
// sourced from the contract so no CloudFront literal is hardcoded here.
const CLOUDFRONT_LLMS_TXT = `${CLOUDFRONT_BASE}/llms.txt`;

// Minimal Cloudflare Pages Function fetch options — only the cf cache fields used here.
interface CfRequestInit extends RequestInit {
  cf?: { cacheTtl?: number; cacheEverything?: boolean; };
}

export async function onRequest(): Promise<Response> {
  const init: CfRequestInit = { cf: { cacheTtl: 3600, cacheEverything: true } };
  const upstream = await fetch(CLOUDFRONT_LLMS_TXT, init);

  if (!upstream.ok) {
    return new Response('llms.txt unavailable', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'X-Source': 'cloudfront-proxy',
    },
  });
}
