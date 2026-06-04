// Pages Function middleware: content negotiation + security headers
// Replaces both cloudflare/api-catalog-content-type.js (Worker) and public/_headers
// because root middleware disables _headers file processing.

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://scripts.simpleanalyticscdn.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https://*.basemaps.cartocdn.com https://m.media-amazon.com https://images.squarespace-cdn.com https://d1pfm520aduift.cloudfront.net https://queue.simpleanalyticscdn.com",
  "connect-src 'self' https://d1pfm520aduift.cloudfront.net wss://iu1k9jv4mi.execute-api.us-west-2.amazonaws.com https://queue.simpleanalyticscdn.com https://cloudflareinsights.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ') + ';';

const LINK_HEADER = [
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</sitemap-index.xml>; rel="sitemap"',
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
      'https://d1pfm520aduift.cloudfront.net/llms-full.txt'
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

  // Homepage: disable CDN caching so content negotiation always works
  // (Cloudflare edge cache bypasses Functions on cache HITs,
  //  and Pages overrides Function-set Cache-Control for HTML assets)
  if (url.pathname === '/') {
    headers.set('Link', LINK_HEADER);
    headers.set('CDN-Cache-Control', 'no-store');
  }

  // API catalog Content-Type override for RFC 9727 compliance
  if (url.pathname === '/.well-known/api-catalog') {
    headers.set(
      'Content-Type',
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
  }

  // Cloudflare Pages serves the SPA 404 fallback (a `text/html` response) with
  // `Cache-Control: max-age=2592000, public` (30 days), and Pages re-applies its
  // default Cache-Control after the Function runs WHENEVER the response is HTML
  // (per the homepage note at the top of this branch). That means setting
  // `Cache-Control: no-store` via `headers.set(...)` does nothing on the 404
  // HTML response — Pages overwrites it on the way out.
  //
  // The win: for any asset-shaped URL (`.webp`, `.avif`, `.js`, etc.), no human
  // ever sees the 404 body — it loads via `<img>`/`<script>`/`<link>`. So we
  // can fully replace the response with an empty `text/plain` body. Pages does
  // NOT override Cache-Control on non-HTML responses, so our `no-store` sticks
  // and the browser never caches the 404. Once the asset is uploaded in a later
  // deploy, the very next request re-checks origin and gets the real bytes.
  const ASSET_EXT = /\.(?:webp|avif|png|jpe?g|gif|svg|ico|css|js|mjs|woff2?|ttf|otf|map|json|xml|txt)$/i;
  const looksLikeAsset = ASSET_EXT.test(url.pathname);
  const respIsHtml = (headers.get('Content-Type') || '').includes('text/html');
  if (looksLikeAsset && (response.status >= 400 || respIsHtml)) {
    return new Response('', {
      status: response.status >= 400 ? response.status : 404,
      headers: {
        'Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    });
  }

  // Non-asset error responses: still try `no-store`. Pages will likely override
  // for HTML, but `CDN-Cache-Control` blocks the edge cache and that helps
  // navigation 404s clear faster than max-age=2592000.
  if (response.status >= 400) {
    headers.set('Cache-Control', 'no-store');
    headers.set('CDN-Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
