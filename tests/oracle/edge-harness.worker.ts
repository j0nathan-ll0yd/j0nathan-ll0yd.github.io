// A test Worker for the edge-injection parity oracle (atlas decision 0160, PR B). It runs the site's
// injector in workerd, with the real HTMLRewriter, on the inputs a test posts. Never deployed.
import type {DashboardRender} from '../../src/lib/data-plane/render-model'
import {fillFragment} from '../../src/lib/edge-render/fragment'
import {injectDashboard} from '../../src/lib/edge-render/inject'
import {parseTemplates} from '../../src/lib/edge-render/templates'

interface InjectRequest {
  page: string
  templates: string
  render: DashboardRender
  nowMs: number
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/escape') {
      // Probes how the rewriter encodes values: POST {text, attribute}.
      const {text, attribute} = (await request.json()) as {text: string; attribute: string}
      const html = await fillFragment('<p data-x=""></p>', (rewriter) =>
        rewriter.on('p', {
          element(el) {
            el.setAttribute('data-x', attribute)
            el.setInnerContent(text)
          }
        }))
      return new Response(html)
    }
    const input = (await request.json()) as InjectRequest
    const page = new Response(input.page, {headers: {'Content-Type': 'text/html; charset=utf-8'}})
    const injected = await injectDashboard(page, {render: input.render, templates: parseTemplates(input.templates), nowMs: input.nowMs})
    return new Response(await injected.text())
  }
}
