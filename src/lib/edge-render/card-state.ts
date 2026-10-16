// A card's data state, written into the data-free page's card in place (atlas decision 0160, PR B,
// owner decision 2026-10-16).
//
// The data-free page renders every live card `loading`: its value-free scaffold, a skeleton and a
// <noscript> note. A card in a data state (`live`, `stale`) keeps that scaffold. This module writes
// what every card shares, as the design system's own rules state it: the root state attributes
// (`stateRootAttrs`), the header timestamp (`widgetTimestampView`, the rule WidgetTimestamp.astro
// and the browser's `revealLiveData` apply), and the end of the loading state. Each card module
// writes its own slots. tests/oracle pins the result to the Astro render of the same props.
import {stateRootAttrs, widgetTimestampView} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {setOptionalAttribute} from './fragment'

export type DataState = 'live' | 'stale'

const LOADING_CLASS = /\s+is-loading\b/g

/** The card root's class without the loading marker. */
export function withoutLoading(className: string | null): string {
  return (className ?? '').replace(LOADING_CLASS, '')
}

/** The header timestamp of a data-state card, rewritten from its `data-live-label` slot. */
export function writeTimestamp(element: HTMLRewriterElement, state: DataState, generatedAt: string | null | undefined): void {
  const label = element.getAttribute('data-live-label') ?? ''
  const view = widgetTimestampView(label, state, generatedAt)
  if (view.kind === 'asOf') {
    element.tagName = 'time'
    element.setAttribute('class', 'widget-timestamp widget-timestamp-stale')
    element.setAttribute('datetime', view.datetime)
  } else {
    element.tagName = 'span'
    element.setAttribute('class', 'widget-timestamp')
    element.removeAttribute('datetime')
  }
  element.setInnerContent(view.text)
}

/**
 * Registers what every data-state card shares: the root's state attributes and class, the header
 * timestamps, and the removal of the loading note. `rootClass` overrides the root class when the
 * card's class depends on its values (Heart Rate's zone accent).
 */
export function registerDataState(rewriter: HTMLRewriter, cardId: string, state: DataState, generatedAt: string | null, rootClass?: string): HTMLRewriter {
  const attrs = stateRootAttrs(state, generatedAt)
  return rewriter.on(`#${cardId}`, {
    element(card) {
      card.setAttribute('class', rootClass ?? withoutLoading(card.getAttribute('class')))
      card.setAttribute('data-ssr-state', state)
      setOptionalAttribute(card, 'data-generated-at', attrs['data-generated-at'])
    }
  }).on(`#${cardId} .widget-timestamp[data-live-label]`, {
    element(timestamp) {
      writeTimestamp(timestamp, state, generatedAt)
    }
  }).on(`#${cardId} noscript`, {
    element(note) {
      note.remove()
    }
  })
}
