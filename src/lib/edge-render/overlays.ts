// The focus overlays (atlas decision 0160, PR B, owner decision 2026-10-16). FocusOverlay.astro and
// DndOverlay.astro render visible, marked `suppressed`, when `currentFocus` names their mode, and
// always seed their clock from the render time. This module writes the same two facts into the
// data-free page's overlays. tests/oracle pins it to the Astro render.
import {FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {DISPLAY_TIME_ZONE} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {setText} from './fragment'

const OVERLAYS = [
  {id: 'focusOverlay', clock: 'focusClock', mode: FOCUS_MODES.work},
  {id: 'dndOverlay', clock: 'dndClock', mode: FOCUS_MODES.doNotDisturb}
] as const

/** The overlay clock, as the overlays format it (24-hour, the owner's time zone). */
const CLOCK_FORMAT = new Intl.DateTimeFormat('en-US', {timeZone: DISPLAY_TIME_ZONE, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'})

export function overlayClock(nowMs: number): string {
  return Number.isFinite(nowMs) ? CLOCK_FORMAT.format(new Date(nowMs)) : '--:--:--'
}

export function registerOverlays(rewriter: HTMLRewriter, currentFocus: string | null, nowMs: number): HTMLRewriter {
  const clock = overlayClock(nowMs)
  for (const overlay of OVERLAYS) {
    const active = currentFocus === overlay.mode
    rewriter.on(`#${overlay.clock}`, {element: (el) => setText(el, clock)})
    if (active) {
      rewriter.on(`#${overlay.id}`, {
        element(el) {
          el.setAttribute('style', 'display: flex')
          el.setAttribute('data-ssr-state', 'suppressed')
        }
      })
    }
  }
  return rewriter
}
