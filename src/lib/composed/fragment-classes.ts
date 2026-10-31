// The class tokens each composed fragment may carry (atlas decision 0160, PR B; review 2026-10-16, H1).
//
// A class is not inert. The page CSS styles some classes as fixed full-viewport layers (`.glitch-page`)
// and some as fixed badges (`.dnd-badge`, `.shift-badge`), so a fragment that could name any class, or
// another component's class, could cover the page or draw another card's indicator. Each fragment may
// carry only the tokens its own component emits across the parity oracle's scenarios (each book status
// of the dashboard-books schema enum among them). tests/oracle/composer-parity.test.ts fails when a
// render uses a token missing here, or when a token here appears in no render of its fragment.
import type {ComposedFragmentId} from './artifact'

const tokens = (list: string): ReadonlySet<string> => new Set(list.split(' '))

export const FRAGMENT_CLASS_TOKENS: Readonly<Record<ComposedFragmentId, ReadonlySet<string>>> = Object.freeze({
  focusOverlay: tokens(
    'card clock-label clock-section clock-time clock-zone divider dot end heading no-entry schedule ' +
      'schedule-block schedule-label schedule-value shift-badge start subheading'
  ),
  dndOverlay: tokens(
    'clock-label clock-section clock-time clock-zone data-row data-row-bar data-rows divider ' + 'dnd-badge dot heading shield-fill shield-wrap subheading'
  ),
  cardSystem: tokens(
    'left-panel-status left-status-header live-dot sys-dot sys-dot-amber sys-dot-green sys-dot-purple ' +
      'sys-dot-red sys-dot-yellow sys-info sys-key sys-key-amber sys-key-green sys-key-purple ' +
      'sys-key-red sys-key-yellow sys-line sys-tooltip sys-val sys-val-green sys-val-red ' +
      'widget-header-right widget-label widget-timestamp'
  ),
  cardHR: tokens(
    'ecg-canvas hr-data hr-ecg-bg hr-empty hr-empty-label hr-footer hr-footer-cell hr-footer-label ' +
      'hr-footer-unit hr-footer-value hr-hrv-label hr-hrv-unit hr-hrv-value hr-layout hr-overlay ' +
      'hr-overlay-left hr-overlay-right hr-paused hr-paused-desc hr-paused-icon hr-paused-label ' +
      'is-paused live-dot live-dot-amber live-dot-pink live-dot-red pulse-bpm pulse-bpm-unit pulse-status-badge ' +
      'skeleton-bar skeleton-state tri-card tri-card-accent-amber tri-card-accent-pink tri-card-accent-red widget-body ' +
      'widget-empty widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale'
  ),
  cardMovement: tokens(
    'is-paused live-dot live-dot-red mv-chip mv-chip-label mv-chip-unit mv-chip-value mv-chips ' +
      'mv-data mv-empty mv-empty-label mv-layout mv-legend mv-legend-item mv-legend-swatch ' +
      'mv-legend-swatch-exercise mv-legend-swatch-move mv-legend-swatch-stand mv-legend-val mv-paused ' +
      'mv-paused-desc mv-paused-icon mv-paused-label mv-ring-exercise mv-ring-move mv-ring-progress ' +
      'mv-ring-stand mv-ring-track mv-ring-track-exercise mv-ring-track-move mv-ring-track-stand ' +
      'mv-rings mv-rings-center mv-rings-center-cap mv-rings-center-pct mv-sun-arc-row mv-sun-caption ' +
      'mv-sun-caption-hit mv-sun-dot mv-sun-footer mv-sun-glyph mv-sun-glyph-moon mv-sun-time ' +
      'mv-sun-track mv-sun-track-line mv-swatch-label mv-swatch-label-full mv-swatch-label-short ' +
      'skeleton-bar skeleton-circle skeleton-state tri-card tri-card-accent-red widget-body ' +
      'widget-empty widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale'
  ),
  cardHydration: tokens(
    'hydra-bottle hydra-bottle-body hydra-bottle-cap hydra-divider hydra-label hydra-layout ' +
      'hydra-liquid hydra-liquid-coffee hydra-liquid-water hydra-mug hydra-mug-body hydra-mug-handle ' +
      'hydra-mug-steam hydra-range hydra-range-coffee hydra-range-label hydra-range-label-bottom ' +
      'hydra-range-label-coffee hydra-range-label-top hydra-range-label-water hydra-range-water ' +
      'hydra-steam-line hydra-v3-bubble hydra-v3-bubbles hydra-v3-gloss hydra-v3-liquid hydra-val ' +
      'hydra-vessel hydra-vessel-coffee hydra-vessel-water hydra-wave hydra-wave-path live-dot ' +
      'live-dot-pink skeleton-bar skeleton-state tri-card tri-card-accent-pink widget-body widget-empty ' +
      'widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale'
  ),
  cardSleep: tokens(
    'live-dot live-dot-purple skeleton-bar skeleton-circle skeleton-state sleep-insight-empty ' +
      'sleep-moon-hero sleep-moon-info sleep-moon-insight sleep-moon-pill sleep-moon-pill-label ' +
      'sleep-moon-pill-val sleep-moon-pills sleep-moon-score-fill sleep-moon-score-label ' +
      'sleep-moon-score-row sleep-moon-score-track sleep-moon-score-val sleep-moon-top sleep-moon-wrap ' +
      'tri-card tri-card-accent-purple widget-body widget-empty widget-header widget-header-right ' +
      'widget-label widget-state-notice widget-timestamp widget-timestamp-stale'
  ),
  cardWorkouts: tokens(
    'live-dot live-dot-pink skeleton-bar skeleton-state tri-card tri-card-accent-pink widget-body ' +
      'widget-empty widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale workout-rest-center workout-rest-heading workout-rest-icon ' +
      'workout-rest-insight workout-rest-sub workout-stat workout-stat-label workout-stat-value ' +
      'workout-sub-card workout-sub-icon workout-sub-stats workout-sub-top workout-sub-type'
  ),
  cardDevLog: tokens(
    'gh-dal-date gh-dal-detail gh-dal-icon gh-dal-line gh-dal-repo gh-dal-terminal gh-dal-title ' +
      'live-dot skeleton-bar skeleton-state tri-card tri-card-accent-green widget-body widget-empty ' +
      'widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale'
  ),
  cardReading: tokens(
    'article-list article-list-date article-list-item article-list-note article-list-note-icon article-list-source ' +
      'article-list-title live-dot ' +
      'skeleton-bar skeleton-state tri-card tri-card-accent-amber widget-body widget-empty ' +
      'widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale'
  ),
  cardStarredRepos: tokens(
    'gh-sl-date gh-sl-lang gh-sl-lang-dot gh-sl-name gh-sl-owner gh-sl-row gh-sl-stars ' +
      'gh-starred-list live-dot skeleton-bar skeleton-state tri-card tri-card-accent-green widget-body ' +
      'widget-empty widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale'
  ),
  cardBooks: tokens(
    'live-dot shelf-book shelf-book-active shelf-book-author shelf-book-finished-date ' +
      'shelf-book-link shelf-book-progress shelf-book-progress-bar shelf-book-progress-fill shelf-book-stars ' +
      'shelf-book-status shelf-book-title shelf-cover-wrapper shelf-row shelf-status-finished ' +
      'shelf-status-pending shelf-status-reading shelf-status-upNext skeleton-bar skeleton-state ' +
      'star-off star-on tri-card tri-card-accent-amber widget-body widget-empty widget-empty--stack ' +
      'widget-empty-body widget-empty-title widget-header widget-header-right widget-label ' +
      'widget-state-notice widget-timestamp widget-timestamp-stale'
  ),
  cardTheatreReviews: tokens(
    'live-dot skeleton-bar skeleton-state theatre-card theatre-count-link theatre-grade ' +
      'theatre-poster-wrap theatre-row theatre-title tri-card tri-card-accent-yellow widget-body ' +
      'widget-empty widget-header widget-header-right widget-label widget-state-notice widget-timestamp ' +
      'widget-timestamp-stale'
  )
})

/**
 * The class tokens a fragment ROOT may carry: its component's kind, its state (`is-paused`) and its
 * data accents. A root that named one of its component's absolute layers (`hydra-v3-bubbles`) would
 * itself become a layer over its column, so the root's list is closed apart from the rest of the
 * fragment's (review 2026-10-16, round 4). Pinned by tests/oracle/composer-parity.test.ts like the list above.
 */
export const FRAGMENT_ROOT_CLASS_TOKENS: Readonly<Record<ComposedFragmentId, ReadonlySet<string>>> = Object.freeze({
  focusOverlay: new Set<string>([]),
  dndOverlay: new Set<string>([]),
  cardSystem: new Set<string>(['left-panel-status']),
  cardHR: new Set<string>(['is-paused', 'tri-card', 'tri-card-accent-amber', 'tri-card-accent-pink', 'tri-card-accent-red']),
  cardMovement: new Set<string>(['is-paused', 'tri-card', 'tri-card-accent-red']),
  cardHydration: new Set<string>(['tri-card', 'tri-card-accent-pink']),
  cardSleep: new Set<string>(['tri-card', 'tri-card-accent-purple']),
  cardWorkouts: new Set<string>(['tri-card', 'tri-card-accent-pink']),
  cardDevLog: new Set<string>(['tri-card', 'tri-card-accent-green']),
  cardReading: new Set<string>(['tri-card', 'tri-card-accent-amber']),
  cardStarredRepos: new Set<string>(['tri-card', 'tri-card-accent-green']),
  cardBooks: new Set<string>(['tri-card', 'tri-card-accent-amber']),
  cardTheatreReviews: new Set<string>(['tri-card', 'tri-card-accent-yellow'])
})
