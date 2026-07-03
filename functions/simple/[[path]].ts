// Pages Function: catch-all reverse proxy for Simple Analytics collection.
// Forwards GET/POST /simple/<rest> → https://queue.simpleanalyticscdn.com/<rest>
// with the /simple prefix stripped, so:
//   /simple/simple.gif  → queue/.../simple.gif  (pageview pixel)
//   /simple/append      → queue/.../append      (sendBeacon)
//   /simple/noscript.gif → queue/.../noscript.gif (noscript pixel)
//
// Geo correctness: CF-Connecting-IP is forwarded as X-Forwarded-For + X-Real-IP
// so SA records the visitor's actual country/city, not the edge PoP IP.
//
// On upstream failure: returns a silent 2xx no-op (204, or a 1×1 transparent GIF
// for *.gif paths) — NEVER a 5xx, which would trip the smoke console-error check.

const UPSTREAM_BASE = 'https://queue.simpleanalyticscdn.com';

// Minimal 1×1 transparent GIF (43 bytes, standard)
const TRANSPARENT_GIF = new Uint8Array([
  0x47,
  0x49,
  0x46,
  0x38,
  0x39,
  0x61,
  0x01,
  0x00,
  0x01,
  0x00,
  0x80,
  0x00,
  0x00,
  0xff,
  0xff,
  0xff,
  0x00,
  0x00,
  0x00,
  0x21,
  0xf9,
  0x04,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x2c,
  0x00,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x01,
  0x00,
  0x00,
  0x02,
  0x02,
  0x44,
  0x01,
  0x00,
  0x3b,
]);

// Minimal Cloudflare Pages Function context — only the fields used here.
interface PagesContext {
  request: Request;
  params: Record<string, string | string[]>;
}

// Minimal CF fetch extensions — only the cf cache fields used here.
// `duplex` is required by undici (Node) when streaming a request body; it is a
// no-op on the Cloudflare Workers runtime. Typed here because it is not yet in
// the lib.dom RequestInit.
interface CfRequestInit extends RequestInit {
  cf?: { cacheEverything?: boolean; };
  duplex?: 'half';
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);

  // Strip the /simple prefix: the catch-all param captures everything after /simple/
  // e.g. pathname=/simple/simple.gif → upstreamPath=/simple.gif
  // The [[path]] param may be undefined for bare /simple requests.
  const rawParam = context.params['path'];
  const suffix = rawParam
    ? '/' + (Array.isArray(rawParam) ? rawParam.join('/') : rawParam)
    : '';

  const upstreamUrl = `${UPSTREAM_BASE}${suffix}${url.search}`;

  const clientIp = request.headers.get('CF-Connecting-IP') ?? '';

  const outboundHeaders: Record<string, string> = {
    'X-Forwarded-For': clientIp,
    'X-Real-IP': clientIp,
  };

  // Preserve Content-Type for POST beacons (sendBeacon sends text/plain)
  const contentType = request.headers.get('Content-Type');
  if (contentType) {
    outboundHeaders['Content-Type'] = contentType;
  }

  const isGif = suffix.endsWith('.gif');

  // Collection endpoints must never be cached. `Cache-Control: no-store` covers
  // the browser, but Cloudflare's edge overrides it and caches GET responses by
  // default (observed: max-age=600 on the pixel), which would dedupe the static
  // `noscript.gif` pageview across a 600s window. `CDN-Cache-Control: no-store`
  // is the Cloudflare-honored directive that keeps the EDGE from caching too.
  const silentGif = () =>
    new Response(TRANSPARENT_GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
      },
    });

  const silentNoOp = () =>
    isGif
      ? silentGif()
      : new Response(null, {
        status: 204,
        headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' },
      });

  let upstream: Response;
  try {
    const init: CfRequestInit = {
      method: request.method,
      headers: outboundHeaders,
      // Never cache collection endpoints
      cf: { cacheEverything: false },
    };
    // Forward the body for POST beacons (sendBeacon → /append). Streaming
    // request.body requires duplex:'half' under undici (Node); no-op on workerd.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }
    upstream = await fetch(upstreamUrl, init);
  } catch {
    // Network failure / timeout — return silent no-op, never a 5xx
    return silentNoOp();
  }

  if (!upstream.ok) {
    return silentNoOp();
  }

  // For GIF paths, forward the upstream response; for others forward as-is or 204
  const responseHeaders = new Headers();
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('CDN-Cache-Control', 'no-store');

  const upstreamContentType = upstream.headers.get('Content-Type');
  if (upstreamContentType) {
    responseHeaders.set('Content-Type', upstreamContentType);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
