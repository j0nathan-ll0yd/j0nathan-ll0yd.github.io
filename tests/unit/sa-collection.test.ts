import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test: Simple Analytics collection Function upstream-failure behaviour.
// Asserts that a network error or upstream 5xx from queue.simpleanalyticscdn.com
// is absorbed as a silent 2xx no-op — never a 5xx — so the smoke console-error
// check stays green (Issue #83 / Plan finding #7 / Principle 3).

// The Function module uses globalThis.fetch; stub it before importing.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

// Dynamic import after stubbing so the module picks up the mocked fetch.
const { onRequest } = await import('../../functions/simple/[[path]]');

function makeContext(pathname: string, method = 'GET') {
  // Derive the [[path]] param from the pathname (strip leading /simple/)
  const suffix = pathname.replace(/^\/simple\/?/, '');
  const params: Record<string, string> = suffix ? { path: suffix } : {};
  return {
    request: new Request(`https://jonathanlloyd.me${pathname}`, { method }),
    params,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('SA collection Function — upstream failure → silent 2xx', () => {
  it('returns 204 when fetch throws (network error) for a non-gif path', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failure'));
    const res = await onRequest(makeContext('/simple/append'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns transparent GIF (200) when fetch throws for a .gif path', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failure'));
    const res = await onRequest(makeContext('/simple/simple.gif'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/gif');
    const body = new Uint8Array(await res.arrayBuffer());
    // GIF89a magic bytes
    expect(body[0]).toBe(0x47); // G
    expect(body[1]).toBe(0x49); // I
    expect(body[2]).toBe(0x46); // F
  });

  it('returns transparent GIF (200) when fetch throws for noscript.gif', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    const res = await onRequest(makeContext('/simple/noscript.gif'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/gif');
  });

  it('returns 204 when upstream responds with 5xx for a non-gif path', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('upstream error', { status: 502 })
    );
    const res = await onRequest(makeContext('/simple/append', 'POST'));
    expect(res.status).toBe(204);
  });

  it('returns transparent GIF (200) when upstream responds with 5xx for a .gif path', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('upstream error', { status: 503 })
    );
    const res = await onRequest(makeContext('/simple/simple.gif'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/gif');
  });

  it('never returns a 5xx regardless of upstream failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await onRequest(makeContext('/simple/append'));
    expect(res.status).toBeLessThan(500);
  });

  it('proxies a successful upstream 200 response for a non-gif path', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
    const res = await onRequest(makeContext('/simple/append', 'POST'));
    expect(res.status).toBe(200);
  });

  it('sets Cache-Control AND CDN-Cache-Control: no-store on the noop path', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fail'));
    const res = await onRequest(makeContext('/simple/append'));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // CDN-Cache-Control is what Cloudflare's edge honors (it overrides the browser
    // Cache-Control); without it GET /simple/* is edge-cached for ~600s.
    expect(res.headers.get('CDN-Cache-Control')).toBe('no-store');
  });

  it('sets CDN-Cache-Control: no-store on the success path too', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    const res = await onRequest(makeContext('/simple/simple.gif'));
    expect(res.headers.get('CDN-Cache-Control')).toBe('no-store');
  });

  it('joins a multi-segment catch-all param array into the upstream path', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    // Cloudflare yields params.path as a string[] for a multi-segment match.
    const ctx = {
      request: new Request('https://jonathanlloyd.me/simple/a/b/c?q=1', { method: 'GET' }),
      params: { path: ['a', 'b', 'c'] },
    };
    await onRequest(ctx);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://queue.simpleanalyticscdn.com/a/b/c?q=1'
    );
  });

  it('forwards the POST body with duplex:half and Content-Type for /append', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const ctx = {
      request: new Request('https://jonathanlloyd.me/simple/append', {
        method: 'POST',
        body: 'type=event&name=scroll_depth_25',
        headers: { 'Content-Type': 'text/plain' },
      }),
      params: { path: 'append' },
    };
    await onRequest(ctx);
    const init = fetchMock.mock.calls[0][1] as Record<string, unknown>;
    expect(init.body).toBeTruthy(); // body forwarded, not dropped
    expect(init.duplex).toBe('half'); // undici stream-body requirement
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
  });
});
