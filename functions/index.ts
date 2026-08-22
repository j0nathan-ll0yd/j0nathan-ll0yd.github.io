import {fetchDashboardSnapshot, renderDashboardSnapshot, snapshotProvenance} from './_lib/dashboard-snapshot'

const START_MARKER = '<template id="dashboard-live-start"></template>'
const END_MARKER = '<template id="dashboard-live-end"></template>'
export const CLIENT_SHELL_HEADER = 'X-Dashboard-Client-Shell'

interface PagesContext {
  request: Request
  next(): Promise<Response>
}

function varyOnClientShell(headers: Headers): void {
  const current = headers.get('Vary')
  const values = current?.split(',').map((value) => value.trim().toLowerCase()) ?? []
  if (!values.includes(CLIENT_SHELL_HEADER.toLowerCase())) {
    headers.set('Vary', current ? `${current}, ${CLIENT_SHELL_HEADER}` : CLIENT_SHELL_HEADER)
  }
}

function safeFailure(): Response {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Dashboard unavailable</title></head><body><main><p>Live dashboard data unavailable.</p></main></body></html>'
  return new Response(html, {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-SSR-Data': 'unavailable'}})
}

export function injectSnapshot(shell: string, snapshotHtml: string, provenance: object): string | null {
  const start = shell.indexOf(START_MARKER)
  const end = shell.indexOf(END_MARKER)
  const headEnd = shell.indexOf('</head>')
  if (start === -1 || end === -1 || end <= start || headEnd === -1) {
    return null
  }

  const contentStart = start + START_MARKER.length
  const safeBody = shell.slice(0, contentStart) + snapshotHtml + shell.slice(end)
  const metaContent = JSON.stringify(provenance).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return safeBody.slice(0, headEnd) + `<meta name="ssr-data" content="${metaContent}">` + safeBody.slice(headEnd)
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const shellResponse = await context.next()
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return shellResponse
  }
  if (!shellResponse.ok) {
    return safeFailure()
  }

  if (context.request.method === 'HEAD') {
    const headers = new Headers(shellResponse.headers)
    headers.delete('Content-Length')
    headers.set('Cache-Control', 'no-store')
    headers.set('X-SSR-Data', 'not-evaluated')
    varyOnClientShell(headers)
    return new Response(null, {status: shellResponse.status, headers})
  }

  // JavaScript browsers request the canonical DS shell explicitly. It is an
  // internal, non-indexable fragment; normal HTML responses never expose its
  // fixture-backed dashboard region.
  if (context.request.headers.get(CLIENT_SHELL_HEADER) === '1') {
    let shell: string
    try {
      shell = await shellResponse.text()
    } catch {
      return safeFailure()
    }
    const start = shell.indexOf(START_MARKER)
    const end = shell.indexOf(END_MARKER)
    if (start === -1 || end === -1 || end <= start) {
      return safeFailure()
    }
    const fragment = shell.slice(start, end + END_MARKER.length)

    const headers = new Headers(shellResponse.headers)
    headers.delete('Content-Length')
    headers.set('Content-Type', 'application/vnd.jonathanlloyd.dashboard-shell+html; charset=utf-8')
    headers.set('Cache-Control', 'no-store')
    headers.set('X-Dashboard-Shell', 'fixture')
    headers.set('X-Robots-Tag', 'noindex, noarchive')
    varyOnClientShell(headers)
    return new Response(fragment, {status: shellResponse.status, headers})
  }

  let shell: string
  try {
    shell = await shellResponse.text()
  } catch {
    return safeFailure()
  }

  const snapshot = await fetchDashboardSnapshot()
  const provenance = snapshotProvenance(snapshot)
  const html = injectSnapshot(shell, renderDashboardSnapshot(snapshot), provenance)
  if (html === null) {
    return safeFailure()
  }

  const headers = new Headers(shellResponse.headers)
  headers.delete('Content-Length')
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  const liveCount = Object.values(snapshot).filter((domain) => domain.source === 'live').length
  headers.set('X-SSR-Data', liveCount === Object.keys(snapshot).length ? 'live' : liveCount === 0 ? 'unavailable' : 'partial')
  varyOnClientShell(headers)
  return new Response(html, {status: 200, headers})
}
