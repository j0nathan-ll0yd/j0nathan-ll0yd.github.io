// Pages Function middleware: content negotiation + security headers
// Replaces both cloudflare/api-catalog-content-type.js (Worker) and public/_headers
// because root middleware disables _headers file processing.

import {
  CLOUDFRONT_BASE,
  LLM_CONTENT_PATHS,
  WEBSOCKET_URL,
} from '@lifegames/portal-contract/constants';

// WebSocket CSP source is the ORIGIN only (no /live path); CLOUDFRONT_BASE is
// already an origin. Sourcing both from the contract keeps the CSP in sync with
// the live addressing without hardcoded literals.
const WEBSOCKET_ORIGIN = new URL(WEBSOCKET_URL).origin;

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://scripts.simpleanalyticscdn.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `img-src 'self' data: https://*.basemaps.cartocdn.com https://m.media-amazon.com https://images.squarespace-cdn.com ${CLOUDFRONT_BASE} https://queue.simpleanalyticscdn.com`,
  `connect-src 'self' ${CLOUDFRONT_BASE} ${WEBSOCKET_ORIGIN} https://queue.simpleanalyticscdn.com https://cloudflareinsights.com`,
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ') + ';';

const LINK_HEADER = [
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</sitemap-index.xml>; rel="sitemap"',
  '</humans.txt>; rel="author"',
  '</feed.xml>; rel="alternate"; type="application/rss+xml"',
  '</feed.json>; rel="alternate"; type="application/feed+json"',
].join(', ');

// Minimal Cloudflare Pages Function context — only the fields this middleware reads.
// Avoids pulling in @cloudflare/workers-types just for one signature.
interface PagesContext {
  request: Request;
  next(): Promise<Response>;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);
  const accept = request.headers.get('Accept') || '';

  // Markdown negotiation: serve pre-composed markdown from CloudFront when
  // agents send Accept: text/markdown (passes isitagentready.com check)
  if (accept.includes('text/markdown')) {
    const mdResponse = await fetch(
      `${CLOUDFRONT_BASE}${LLM_CONTENT_PATHS.llmsFull}`
    );
    return new Response(mdResponse.body, {
      status: mdResponse.status,
      headers: {
        'Content-Type': 'text/markdown',
        'Cache-Control': 'no-store',
        'x-markdown-tokens': '2500',
      },
    });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);

  // Security headers
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS: 2-year max-age + subdomains. Preload intentionally omitted — owner-gated process.
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  headers.set('X-Frame-Options', 'DENY');
  // COOP: same-origin-allow-popups permits OAuth/payment popups while isolating the browsing context.
  // COEP/CORP omitted — would break cross-origin Amazon, Carto, and SimpleAnalytics resources.
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  headers.set('Permissions-Policy', 'accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), compute-pressure=(), display-capture=(), document-domain=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), speaker-selection=(), usb=(), web-share=(), xr-spatial-tracking=()');

  // sw.js and version.json must always revalidate so a new deploy is picked up
  // promptly: sw.js drives the update-check path in public/js/sw-register.js, and
  // version.json is the smoke check's freshness probe. Set here, not in
  // public/_headers, because this middleware disables _headers processing. Modern
  // Chromium already bypasses the HTTP cache for sw.js via updateViaCache:'imports';
  // this covers older engines and version.json defensively.
  if (url.pathname === '/sw.js' || url.pathname === '/version.json') {
    headers.set('Cache-Control', 'max-age=0, no-store');
  }

  // Homepage: disable CDN caching so content negotiation always works
  // (Cloudflare edge cache bypasses Functions on cache HITs,
  //  and Pages overrides Function-set Cache-Control for HTML assets)
  if (url.pathname === '/') {
    headers.set('Link', LINK_HEADER);
    headers.set('CDN-Cache-Control', 'no-store');
    // Prevent UTM/ad-click params from fragmenting the cache or Back/Forward Cache.
    headers.set('No-Vary-Search', 'params=("utm_source" "utm_medium" "utm_campaign" "utm_term" "utm_content" "gclid" "fbclid")');
  }

  // API catalog Content-Type override for RFC 9727 compliance
  if (url.pathname === '/.well-known/api-catalog') {
    headers.set(
      'Content-Type',
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
