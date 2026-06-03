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

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
