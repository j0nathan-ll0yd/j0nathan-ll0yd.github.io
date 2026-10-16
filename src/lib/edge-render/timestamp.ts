// A header "as of" time a card renders beside another header element (atlas decision 0160, PR B).
// The markup is WidgetTimestamp.astro's for `stale`; the values go through the text and attribute APIs.
import {widgetTimestampView} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {fillFragment, setText} from './fragment'

/** The value-free markup WidgetTimestamp renders for a stale card. */
const STALE_TIMESTAMP_SLOT = '<time class="widget-timestamp widget-timestamp-stale" data-live-label=""></time>'

/** The stale "as of" element for `generatedAt`, or null when the time cannot be shown. */
export async function staleTimestampFragment(label: string, generatedAt: string | null | undefined): Promise<string | null> {
  const view = widgetTimestampView(label, 'stale', generatedAt)
  if (view.kind !== 'asOf') {
    return null
  }
  return fillFragment(STALE_TIMESTAMP_SLOT, (rewriter) =>
    rewriter.on('time', {
      element(el) {
        el.setAttribute('data-live-label', label)
        el.setAttribute('datetime', view.datetime)
        setText(el, view.text)
      }
    }))
}
