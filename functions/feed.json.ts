// Pages Function: proxy /feed.json from CloudFront with edge caching.
// The backend (mantle-LifegamesPortal) owns the canonical JSON Feed 1.1;
// this route ensures the spec-required root path resolves on jonathanlloyd.me
// without a hand-maintained static file. The response is wrapped by
// functions/_middleware.ts, which injects the security headers.

import { CLOUDFRONT_BASE } from '@lifegames/portal-contract/constants';

const CLOUDFRONT_FEED_JSON = `${CLOUDFRONT_BASE}/feed.json`;

// Minimal Cloudflare Pages Function fetch options — only the cf cache fields used here.
interface CfRequestInit extends RequestInit {
  cf?: { cacheTtl?: number; cacheEverything?: boolean; };
}

export async function onRequest(): Promise<Response> {
  const init: CfRequestInit = { cf: { cacheTtl: 3600, cacheEverything: true } };
  const upstream = await fetch(CLOUDFRONT_FEED_JSON, init);

  if (!upstream.ok) {
    return new Response('feed.json unavailable', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/feed+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'X-Source': 'cloudfront-proxy',
    },
  });
}
