// Shared factory for the CloudFront proxy Pages Functions (/llms.txt,
// /llms-full.txt, /index.md, /feed.xml, /feed.json). The backend
// (mantle-LifegamesPortal) owns the canonical artifacts; these routes ensure the
// spec-required root paths resolve on jonathanlloyd.me without hand-maintained
// static files. Responses are wrapped by functions/_middleware.ts, which injects
// the security headers.
//
// Not itself a route: Pages Functions only creates routes for modules that
// export an onRequest* handler; this module exports a factory.

import { CLOUDFRONT_BASE } from '@lifegames/portal-contract/constants';

// Minimal Cloudflare Pages Function fetch options — only the cf cache fields used here.
interface CfRequestInit extends RequestInit {
  cf?: { cacheTtl?: number; cacheEverything?: boolean; };
}

export interface CloudfrontProxyConfig {
  /** Artifact path on the CloudFront data plane, e.g. '/llms-full.txt'. */
  path: string;
  /** Content-Type served to the client (CloudFront serves its own; the route owns the public one). */
  contentType: string;
}

/** Builds an onRequest handler that proxies one CloudFront artifact with edge caching. */
export function makeCloudfrontProxy({ path, contentType }: CloudfrontProxyConfig): () => Promise<Response> {
  const upstreamUrl = `${CLOUDFRONT_BASE}${path}`;
  const artifactName = path.slice(1);

  return async function onRequest(): Promise<Response> {
    const init: CfRequestInit = { cf: { cacheTtl: 3600, cacheEverything: true } };
    const upstream = await fetch(upstreamUrl, init);

    if (!upstream.ok) {
      return new Response(`${artifactName} unavailable`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
        'X-Source': 'cloudfront-proxy',
      },
    });
  };
}
