// Pages Function: the SEP-2127 server card at /mcp/server-card, the location the
// server-card extension reserves (`<streamable-http-url>/server-card`). The extension
// asks for the card media type, open CORS, a one-hour public cache, and an ETag that
// honors If-None-Match (ext-server-card docs/discovery.md, "Hosted Server Card Location").
// The compatibility copy at /.well-known/mcp/server-card.json is the same bytes, written
// at build time by scripts/generate-webmcp.mjs.

import {SERVER_CARD_JSON, SERVER_CARD_MEDIA_TYPE} from '../_lib/agent-catalog.mjs'
import {DISCOVERY_CACHE_SECONDS} from '../_lib/mcp-server'

interface PagesContext {
  request: Request
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag'
}

let etag: Promise<string> | undefined

/** A strong ETag over the card bytes, computed once per isolate. */
function cardEtag(): Promise<string> {
  etag ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(SERVER_CARD_JSON)).then((digest) =>
    `"${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}"`
  )
  return etag
}

export async function onRequest({request}: PagesContext): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: CORS})
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {status: 405, headers: {...CORS, Allow: 'GET, HEAD, OPTIONS'}})
  }
  const tag = await cardEtag()
  const headers = new Headers({...CORS, 'Content-Type': SERVER_CARD_MEDIA_TYPE, 'Cache-Control': `public, max-age=${DISCOVERY_CACHE_SECONDS}`, ETag: tag})
  const ifNoneMatch = request.headers.get('If-None-Match')
  if (ifNoneMatch && ifNoneMatch.split(',').some((value) => value.trim() === tag || value.trim() === '*')) {
    return new Response(null, {status: 304, headers})
  }
  return new Response(request.method === 'HEAD' ? null : SERVER_CARD_JSON, {status: 200, headers})
}
