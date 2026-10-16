// Heart Rate in a data state (atlas decision 0160, PR B, owner decision 2026-10-16).
//
// `heartRateView` is the design system's one owner of the card's state and every slot: the Astro
// template (widgets/health/HeartRate.astro) and the browser updater (`writeHeartRateSlots`) both read
// it. This module writes the same view into the data-free card's slots, by the ids both use. Every
// value goes through the text and attribute APIs.
import type {DashboardViewModels} from '@j0nathan-ll0yd/web/runtime/view-models'
import {heartRateView} from '@j0nathan-ll0yd/web/runtime/widget-views'
import {type DataState, registerDataState} from '../card-state'
import {setOptionalAttribute, setText} from '../fragment'

export const HEART_RATE_CARD = 'cardHR'

export function registerHeartRate(rewriter: HTMLRewriter, props: DashboardViewModels['heartRate'], state: DataState): HTMLRewriter {
  const view = heartRateView(props)
  const zone = view.zone
  const reading = view.hr > 0
  const rootClass = `tri-card ${zone.accentClass}${view.paused ? ' is-paused' : ''}`
  const text = (id: string, value: string) => rewriter.on(`#${id}`, {element: (el) => setText(el, value)})
  registerDataState(rewriter, HEART_RATE_CARD, state, props.generatedAt ?? null, rootClass)
  rewriter.on(`#${HEART_RATE_CARD} .live-dot`, {element: (el) => void el.setAttribute('class', `live-dot ${zone.dotClass}`)}).on(
    `#${HEART_RATE_CARD} .hr-data`,
    {element: (el) => setOptionalAttribute(el, 'hidden', view.scaffoldHidden ? '' : null)}
  ).on('#hrEcgBg', {element: (el) => void el.setAttribute('style', `opacity: ${zone.ecgOpacity}`)}).on('#hrEcgCanvas', {
    element(el) {
      setOptionalAttribute(el, 'data-bpm', view.showData && reading ? String(view.hr) : null)
      setOptionalAttribute(el, 'data-hrv', view.showData && view.hasHrv ? String(view.hrv) : null)
      setOptionalAttribute(el, 'data-stroke', view.showData ? zone.ecgStroke : null)
    }
  }).on('#pulseBpm', {
    element(el) {
      setOptionalAttribute(el, 'style', reading ? `color: ${zone.bpmColor}; text-shadow: ${zone.bpmShadow}` : null)
      setText(el, view.bpmText)
    }
  }).on('#hrZoneBadge', {
    element(el) {
      setOptionalAttribute(el, 'style', reading ? `color: ${zone.badgeColor}; background: ${zone.badgeBg}; border: 1px solid ${zone.badgeBorder}` : null)
      setText(el, view.zoneText)
    }
  }).on('#hrHrvValue', {
    element(el) {
      setOptionalAttribute(el, 'style', view.hasHrv ? `color: ${view.hrvColor.color}; text-shadow: ${view.hrvColor.shadow}` : null)
      setText(el, view.hrvText)
    }
  })
  text('hrPausedLabel', view.pausedLabel)
  text('hrPausedDesc', view.pausedDescription)
  text('hrFooterRhr', view.rhrText)
  text('hrFooterRr', view.rrText)
  text('hrFooterTemp', view.tempText)
  return rewriter
}
