// Heart Rate in a data state (atlas decision 0160, PR B; owner decision 2026-10-16, option B).
//
// `heartRateView` is the design system's one owner of the card's state and every slot: the Astro
// template (widgets/health/HeartRate.astro) and the browser updater (`writeHeartRateSlots`) both read
// it. The edge fills the build-time template of the matching variant (live or stale, paused or not)
// with the same view, by the ids both use.
import type {DashboardViewModels} from '@j0nathan-ll0yd/web/runtime/view-models'
import {heartRateView} from '@j0nathan-ll0yd/web/runtime/widget-views'
import {type DataState, dataVariant, registerDataState} from '../card-state'
import {fillFragment, setAttribute, setOptionalAttribute, slotWith, textSlot} from '../fragment'
import {templateFor, type Templates} from '../templates'

export const HEART_RATE_CARD = 'cardHR'

export function fillHeartRate(props: DashboardViewModels['heartRate'], state: DataState, templates: Templates): Promise<string> {
  const view = heartRateView(props)
  const zone = view.zone
  const reading = view.hr > 0
  const variant = `${dataVariant(state, props.generatedAt)}${view.paused ? '-paused' : ''}`
  return fillFragment(templateFor(templates, HEART_RATE_CARD, variant), (rewriter) => {
    registerDataState(rewriter, HEART_RATE_CARD, state, props.generatedAt ?? null, `tri-card ${zone.accentClass}${view.paused ? ' is-paused' : ''}`)
    return rewriter.on(`#${HEART_RATE_CARD} .live-dot`, {element: (el) => setAttribute(el, 'class', `live-dot ${zone.dotClass}`)}).on(
      `#${HEART_RATE_CARD} .hr-data`,
      {element: (el) => setOptionalAttribute(el, 'hidden', view.scaffoldHidden ? '' : null)}
    ).on('#hrEcgBg', {element: (el) => setAttribute(el, 'style', `opacity: ${zone.ecgOpacity}`)}).on('#hrEcgCanvas', {
      element(el) {
        setOptionalAttribute(el, 'data-bpm', view.showData && reading ? String(view.hr) : null)
        setOptionalAttribute(el, 'data-hrv', view.showData && view.hasHrv ? String(view.hrv) : null)
        setOptionalAttribute(el, 'data-stroke', view.showData ? zone.ecgStroke : null)
      }
    }).on('#pulseBpm', slotWith(textSlot(view.bpmText), (el) => {
      setOptionalAttribute(el, 'style', reading ? `color: ${zone.bpmColor}; text-shadow: ${zone.bpmShadow}` : null)
    })).on('#hrZoneBadge', slotWith(textSlot(view.zoneText), (el) => {
      setOptionalAttribute(el, 'style', reading ? `color: ${zone.badgeColor}; background: ${zone.badgeBg}; border: 1px solid ${zone.badgeBorder}` : null)
    })).on('#hrHrvValue', slotWith(textSlot(view.hrvText), (el) => {
      setOptionalAttribute(el, 'style', view.hasHrv ? `color: ${view.hrvColor.color}; text-shadow: ${view.hrvColor.shadow}` : null)
    })).on('#hrPausedLabel', textSlot(view.pausedLabel)).on('#hrPausedDesc', textSlot(view.pausedDescription)).on('#hrFooterRhr', textSlot(view.rhrText)).on(
      '#hrFooterRr',
      textSlot(view.rrText)
    ).on('#hrFooterTemp', textSlot(view.tempText))
  })
}
