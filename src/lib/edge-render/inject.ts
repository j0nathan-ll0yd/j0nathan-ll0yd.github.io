// The Worker's render of `/` (atlas decision 0160, PR B; owner decision 2026-10-16, option B: edge
// injection, over Workers Paid). Astro does not run per request. The Worker streams the prerendered
// data-free page (dist/client/index.html) through HTMLRewriter and writes, for each live card, the
// state and the values the shared view models decide (`toDashboardViewModels`, D11 = M1 data):
//
// - a card in `empty`, `unavailable` or `suppressed` is replaced by its value-free template, which
//   the build rendered from the design system's own component (./templates.ts);
// - a card in `live` or `stale` is replaced by its data-state template (rendered at build time from
//   value-free stand-ins), with every value written through the text and attribute APIs (./cards/).
//
// Every value is written through `setInnerContent` (text) or `setAttribute`, which escape it.
// tests/oracle renders the same props through Astro and pins the two to equal markup.
import type {DashboardRender, LiveCardId} from '../data-plane/render-model'
import {MIRRORED_BOOK_COVERS} from '../load-dashboard-data'
import type {DataState} from './card-state'
import {fillBookshelf} from './cards/bookshelf'
import {fillHeartRate} from './cards/heart-rate'
import {fillTheatre} from './cards/theatre'
import {registerOverlays} from './overlays'
import {isTemplateState, templateFor, type Templates} from './templates'

/** The cards the edge writes in a data state: each returns its filled template. A card missing here stays `loading` (spike scope). */
type DataCardFill = (render: DashboardRender, state: DataState, templates: Templates) => Promise<string>

const DATA_CARD_FILLS: Partial<Record<LiveCardId, DataCardFill>> = {
  cardHR: (render, state, templates) => fillHeartRate(render.vm.heartRate, state, templates),
  cardBooks: (render, state, templates) => fillBookshelf(render.vm.bookshelf, state, templates, MIRRORED_BOOK_COVERS),
  cardTheatreReviews: (render, state, templates) => fillTheatre(render.vm.theatreReviews, state, templates)
}

export interface InjectInput {
  render: DashboardRender
  templates: Templates
  /** The render time: the overlay clocks read it. */
  nowMs: number
}

/** The data-free page with every card's state and values written. Reads no data itself. */
export async function injectDashboard(page: Response, {render, templates, nowMs}: InjectInput): Promise<Response> {
  const rewriter = new HTMLRewriter()
  rewriter.on('meta[name="robots"]', {
    element(meta) {
      // The summary is one of a closed set of words (SsrSummary), never an export value.
      meta.after(`<meta name="ssr-data" content="${render.summary}">`, {html: true})
    }
  })
  for (const [cardId, state] of Object.entries(render.cards) as [LiveCardId, DashboardRender['cards'][LiveCardId]][]) {
    if (isTemplateState(state)) {
      const template = templateFor(templates, cardId, state)
      rewriter.on(`#${cardId}`, {element: (card) => void card.replace(template, {html: true})})
    } else if (state === 'live' || state === 'stale') {
      const fill = DATA_CARD_FILLS[cardId]
      if (fill) {
        const card = await fill(render, state, templates)
        rewriter.on(`#${cardId}`, {element: (el) => void el.replace(card, {html: true})})
      }
    }
  }
  registerOverlays(rewriter, render.vm.focusOverlay.currentFocus, nowMs)
  return rewriter.transform(page)
}
