// What every data-state card template needs written (atlas decision 0160, PR B; owner decision
// 2026-10-16, option B): the root's state attributes (`stateRootAttrs`) and the header timestamps
// (`widgetTimestampView`, the rule WidgetTimestamp.astro and the browser's `revealLiveData` apply).
// The template variant already has the right elements (./slot-props.ts `DataVariant`); this writes
// the values. tests/oracle pins the result to the Astro render of the same props.
import {stateRootAttrs, widgetTimestampView} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {setAttribute, setOptionalAttribute, textSlot} from './fragment'
import type {DataVariant} from './slot-props'

export type DataState = 'live' | 'stale'

/** The template variant whose header has the element `widgetTimestampView` renders for this card. */
export function dataVariant(state: DataState, generatedAt: string | null | undefined): DataVariant {
  if (state === 'live') {
    return 'live'
  }
  return widgetTimestampView('', 'stale', generatedAt).kind === 'asOf' ? 'stale' : 'stale-untimed'
}

/** Handlers for one header timestamp: its "as of" time, and its label or time text. */
function timestampSlot(state: DataState, generatedAt: string | null | undefined): HTMLRewriterElementHandlers {
  let text = ''
  const slot = textSlot(() => text)
  return {
    element(el) {
      const view = widgetTimestampView(el.getAttribute('data-live-label') ?? '', state, generatedAt)
      if (view.kind === 'asOf') {
        setAttribute(el, 'datetime', view.datetime)
      }
      text = view.text
      return slot.element?.(el)
    },
    text: slot.text
  }
}

/**
 * Registers what every data-state card writes: the root's state attributes and, when its class
 * depends on its values, its class; and each header timestamp.
 */
export function registerDataState(rewriter: HTMLRewriter, cardId: string, state: DataState, generatedAt: string | null, rootClass?: string): HTMLRewriter {
  const attrs = stateRootAttrs(state, generatedAt)
  return rewriter.on(`#${cardId}`, {
    element(card) {
      if (rootClass !== undefined) {
        setAttribute(card, 'class', rootClass)
      }
      setAttribute(card, 'data-ssr-state', state)
      setOptionalAttribute(card, 'data-generated-at', attrs['data-generated-at'])
    }
  }).on(`#${cardId} .widget-timestamp[data-live-label]`, timestampSlot(state, generatedAt))
}
