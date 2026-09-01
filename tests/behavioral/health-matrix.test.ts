import {expect, test} from '@playwright/test'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {expectNoNewAxeViolations} from './a11y'
import {fixture, interceptDashboard, loadDashboard} from './dashboard-fixtures'

// Health vertical render conformance: heart rate, movement rings, hydration, night summary,
// workouts, and the system-status sync line. Behavioral DOM assertions only -- the widget
// screenshots in tests/visual/widgets.spec.ts are supplementary and are never this suite's oracle.
//
// Every value asserted here is derived from the shipped adapters, not copied from a render:
//   - water oz  = round(dietaryWater mL / 29.5735)      (adapters.ts adaptHealth)
//   - caffeine  = round(dietaryCaffeine g * 1000)
//   - zone      = classifyHeartRate thresholds 45 / 60 / 100 / 140  (runtime/heart-rate.ts)
//   - sleep     = formatDuration / formatPhase / computeSleepPercentages  (runtime/sleep.ts)

const HR_PAUSED_OFF_WRIST = 'Heart-rate tracking paused while the watch is off the wrist.'
const HR_PAUSED_CHARGING = 'Heart-rate tracking paused while the watch is charging.'

test.describe('Health Render Conformance', () => {
  // covers: health-render#Loading state keeps the heart-rate card in its loading presentation
  test('keeps the loading presentation while the health request is pending', async ({page}) => {
    await interceptDashboard(page)
    await page.route(`${CLOUDFRONT_BASE}${ENDPOINTS.health}**`, () => new Promise(() => {}))

    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expect(page.locator('#cardHR.is-loading')).toBeVisible()

    await expectNoNewAxeViolations(page, 'health/loading')
  })

  // covers: health-render#Absent health quantities render the no-data dash rather than a zero
  test('renders the no-data dash for every absent quantity', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'empty')}, '#cardHR')

    // An absent quantity must never render as 0 -- a zero reads as a measured resting value.
    await expect(page.locator('#pulseBpm')).toHaveText('—')
    await expect(page.locator('#hrZoneBadge')).toHaveText('—')
    await expect(page.locator('#hrHrvValue')).toHaveText('—')
    await expect(page.locator('#hrFooterRhr')).toHaveText('—')
    await expect(page.locator('#hrFooterRr')).toHaveText('—')
    await expect(page.locator('#hrFooterTemp')).toHaveText('—')

    await expectNoNewAxeViolations(page, 'health/empty')
  })

  // covers: health-render#Baseline health renders the measured heart rate, zone and footer vitals
  test('renders the baseline heart rate, its zone and the footer vitals strip', async ({page}) => {
    await loadDashboard(page, {}, '#cardHR')

    await expect(page.locator('#pulseBpm')).toHaveText('63')
    await expect(page.locator('#hrZoneBadge')).toHaveText('Normal Zone')
    // The export ships HRV under the HealthKit name `heartRateVariabilitySDNN`; the adapter renames
    // it to `hrvSDNN` before the updater reads it. A dash here would mean that rename regressed.
    await expect(page.locator('#hrHrvValue')).toHaveText('45')
    // wristTemperatureDelta is present and exactly 0, so it renders as a signed value, not a dash.
    await expect(page.locator('#hrFooterTemp')).toHaveText('0.0')
    await expect(page.locator('#hrFooterRhr')).toHaveText('—')
    await expect(page.locator('#hrFooterRr')).toHaveText('—')

    await expectNoNewAxeViolations(page, 'health/baseline')
  })

  // covers: health-render#Heart-rate zone classification drives the zone badge and the card accent
  test('classifies the heart rate into its zone badge and card accent', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'bradycardia')}, '#cardHR')

    await expect(page.locator('#pulseBpm')).toHaveText('42')
    await expect(page.locator('#hrZoneBadge')).toHaveText('Bradycardia')
    await expect(page.locator('#cardHR')).toHaveClass(/tri-card-accent-pink/)

    await expectNoNewAxeViolations(page, 'health/bradycardia')

    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'peak')}, '#cardHR')

    await expect(page.locator('#pulseBpm')).toHaveText('165')
    await expect(page.locator('#hrZoneBadge')).toHaveText('Peak Zone')
    // The accent is a rendered consequence of the zone, so it moves with it.
    await expect(page.locator('#cardHR')).toHaveClass(/tri-card-accent-red/)
    await expect(page.locator('#cardHR')).not.toHaveClass(/tri-card-accent-pink/)

    await expectNoNewAxeViolations(page, 'health/peak')
  })

  // covers: health-render#A paused watch replaces heart-rate and movement data with the paused block
  test('replaces the watch-driven card data with the paused block', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'pausedHrGap')}, '#cardHR')

    // The data wrapper must be HIDDEN, not merely overlaid: a paused watch has no current reading,
    // so leaving the last number on screen would present stale data as live.
    await expect(page.locator('#hrPaused')).toBeVisible()
    await expect(page.locator('#cardHR .hr-data')).toBeHidden()
    await expect(page.locator('#hrPausedLabel')).toHaveText('Watch off')
    await expect(page.locator('#hrPausedDesc')).toHaveText(HR_PAUSED_OFF_WRIST)
    await expect(page.locator('#mvPaused')).toBeVisible()
    await expect(page.locator('#cardMovement .mv-data')).toBeHidden()
    await expect(page.locator('#mvPausedLabel')).toHaveText('Watch off')

    await expectNoNewAxeViolations(page, 'health/pausedHrGap')

    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'pausedCharging')}, '#cardHR')

    await expect(page.locator('#hrPaused')).toBeVisible()
    await expect(page.locator('#cardHR .hr-data')).toBeHidden()
    await expect(page.locator('#hrPausedLabel')).toHaveText('Watch charging')
    await expect(page.locator('#hrPausedDesc')).toHaveText(HR_PAUSED_CHARGING)
    await expect(page.locator('#mvPausedLabel')).toHaveText('Watch charging')

    await expectNoNewAxeViolations(page, 'health/pausedCharging')
  })

  // covers: health-render#Movement rings render the server-synced goals, stand hours, daylight and solar
  test('renders the movement rings against server-synced goals and solar facts', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'movementActive')}, '#cardMovement')

    // Denominators come from the export's `goals`, never the client-side defaults (500/30/12/20).
    await expect(page.locator('#legendMove')).toHaveText('103/650')
    await expect(page.locator('#legendExercise')).toHaveText('0/40')
    // Stand uses the synced achieved-ring count `standHours`, not floor(standTime minutes / 60).
    await expect(page.locator('#legendStand')).toHaveText('4/12')
    await expect(page.locator('#ringCenterPct')).toHaveText('16%')
    await expect(page.locator('#cardMovement [data-mv-metric="steps"]')).toHaveText('324')
    await expect(page.locator('#cardMovement [data-mv-metric="distance"]')).toContainText('0.3')
    await expect(page.locator('#cardMovement [data-mv-metric="flights"]')).toHaveText('0')
    await expect(page.locator('#mvDaylightMin')).toHaveText('48')
    await expect(page.locator('#mvDaylightHit')).toBeVisible()
    await expect(page.locator('#mvSunrise')).toHaveText('05:39')
    await expect(page.locator('#mvSunset')).toHaveText('20:24')

    await expectNoNewAxeViolations(page, 'health/movementActive')
  })

  // covers: health-render#Hydration vessels render the converted water and caffeine totals
  test('converts and clamps the hydration totals in both vessels', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'zeroHydration')}, '#cardHydration')

    await expect(page.locator('#hydraWaterVal')).toHaveText('0 oz')
    await expect(page.locator('#hydraCoffeeVal')).toHaveText('0 mg')

    await expectNoNewAxeViolations(page, 'health/hydrationZero')

    await loadDashboard(page, {[ENDPOINTS.health]: fixture('health', 'maxHydration')}, '#cardHydration')

    // 4140.3 mL / 29.5735 = 140 oz, exactly the scale max; 0.5 g = 500 mg, likewise.
    await expect(page.locator('#hydraWaterVal')).toHaveText('140 oz')
    await expect(page.locator('#hydraCoffeeVal')).toHaveText('500 mg')

    await expectNoNewAxeViolations(page, 'health/hydrationMax')
  })

  // covers: health-render#Night summary renders the sleep duration and per-phase pills
  test('renders the sleep duration and every phase pill', async ({page}) => {
    await loadDashboard(page, {}, '#cardSleep')

    // Duration counts rem + deep + core and deliberately excludes awake (28500s = 7h 55m).
    await expect(page.locator('#sleepDuration')).toHaveText('7h 55m')
    await expect(page.locator('#cardSleep [data-phase="deep"] .sleep-moon-pill-val')).toHaveText('1h 31m')
    await expect(page.locator('#cardSleep [data-phase="rem"] .sleep-moon-pill-val')).toHaveText('1h 31m')
    await expect(page.locator('#cardSleep [data-phase="core"] .sleep-moon-pill-val')).toHaveText('4h 51m')
    await expect(page.locator('#cardSleep [data-phase="awake"] .sleep-moon-pill-val')).toHaveText('32m')

    await expectNoNewAxeViolations(page, 'health/sleepBaseline')
  })

  // covers: health-render#Phase dominance drives the restorative caption percentages
  test('derives the restorative caption percentages from the phase mix', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.sleep]: fixture('sleep', 'deepDominant')}, '#cardSleep')

    await expect(page.locator('#sleepDuration')).toHaveText('8h 0m')
    // 10800/28800 deep and 3600/28800 REM, rounded -- percentages of sleep, not of time in bed.
    await expect(page.locator('#sleepInsight')).toContainText('38% deep')
    await expect(page.locator('#sleepInsight')).toContainText('13% REM')
    await expect(page.locator('#sleepInsight')).toContainText('restorative sleep')

    await expectNoNewAxeViolations(page, 'health/sleepDeepDominant')
  })

  // covers: health-render#An empty sleep export renders night-summary placeholders rather than zeros
  test('renders night-summary placeholders when no sleep was recorded', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.sleep]: fixture('sleep', 'empty')}, '#cardSleep')

    // A zero-second night is "no data", not "0h 0m of sleep scoring 0".
    await expect(page.locator('#sleepDuration')).toHaveText('--')
    await expect(page.locator('#sleepScoreVal')).toHaveText('--')
    await expect(page.locator('#cardSleep [data-phase="deep"] .sleep-moon-pill-val')).toHaveText('--')
    await expect(page.locator('#cardSleep [data-phase="awake"] .sleep-moon-pill-val')).toHaveText('--')
    await expect(page.locator('#sleepInsight')).toHaveText('No sleep data')
    await expect(page.locator('#sleepTimestamp')).toHaveText('no data')

    await expectNoNewAxeViolations(page, 'health/sleepEmpty')
  })

  // covers: health-render#Workouts render each session's type, duration, calories and distance
  test('renders every workout session with its duration, calories and distance', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.workouts]: fixture('workouts', 'multiWorkout')}, '#cardHR')

    await expect(page.locator('#cardWorkouts')).toBeVisible()
    const cards = page.locator('#cardWorkouts .workout-sub-card')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0).locator('.workout-sub-type')).toHaveText('Walking')
    // 965s renders minutes AND seconds; 2700s is a whole 45m and drops the seconds component.
    await expect(cards.nth(0)).toContainText('16m 5s')
    await expect(cards.nth(0)).toContainText('72 kcal')
    await expect(cards.nth(0)).toContainText('1.14 km')
    await expect(cards.nth(1).locator('.workout-sub-type')).toHaveText('Cycling')
    await expect(cards.nth(1)).toContainText('45m')
    await expect(cards.nth(1)).toContainText('12.00 km')
    await expect(cards.nth(2).locator('.workout-sub-type')).toHaveText('Running')

    await expectNoNewAxeViolations(page, 'health/workoutsMulti')
  })

  // covers: health-render#A mapped workout type renders its branded label and outbound link
  test('maps a generic workout type to its branded label and outbound link', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.workouts]: fixture('workouts', 'barrysBootcamp')}, '#cardHR')

    // HealthKit reports this session as the generic "Other"; the adapter maps it to the brand.
    const link = page.locator('#cardWorkouts a.workout-sub-type')
    await expect(link).toHaveText("Barry's Bootcamp")
    await expect(link).toHaveAttribute('href', 'https://share.barrys.com/jsvsl')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(page.locator('#cardWorkouts')).toContainText('1h 0m')
    await expect(page.locator('#cardWorkouts')).toContainText('450 kcal')
    // distance is null for a studio class, so the distance stat is omitted rather than shown as 0.
    await expect(page.locator('#cardWorkouts .workout-stat')).toHaveCount(2)

    await expectNoNewAxeViolations(page, 'health/workoutsBranded')
  })

  // covers: health-render#A rest day leaves the conditional workouts card hidden
  test('leaves the workouts card hidden on a rest day', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.workouts]: fixture('workouts', 'empty')}, '#cardHR')

    // The card ships display:none and is revealed only by a non-empty export, so a rest day must
    // not surface the build-time SSR session. No axe scan here: a hidden card evaluates no nodes.
    await expect(page.locator('#cardWorkouts')).toBeHidden()
    await expect(page.locator('#cardHR')).toBeVisible()
  })

  // covers: health-render#System status reports each health source as active once its export lands
  test('reports every live source as active in the system-status panel', async ({page}) => {
    await loadDashboard(page, {}, '#cardHR')

    // `sys-val-green` is the discriminating signal: the health dot is `sys-dot-red` in BOTH the
    // active and offline states (health's line colour happens to be red), so the dot proves nothing.
    const healthLine = page.locator('#systemStatus .sys-line[data-source="health"]')
    await expect(healthLine.locator('.sys-val-green')).toContainText('ACTIVE')
    // Location is a known non-feature on the production build and is filtered out of the panel.
    await expect(page.locator('#systemStatus .sys-line')).toHaveCount(7)
    await expect(page.locator('#systemStatus .sys-line[data-source="location"]')).toHaveCount(0)
    await expect(page.locator('#systemStatus .sys-val-green')).toHaveCount(7)

    await expectNoNewAxeViolations(page, 'health/systemStatus')
  })
})
