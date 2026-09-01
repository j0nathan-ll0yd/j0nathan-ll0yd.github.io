# Health Render Conformance

## Purpose

Validate the behavioral rendering of the dashboard health vertical -- heart rate, movement rings,
hydration, night summary, workouts, and the system-status sync line -- against the web fixture
package. The iOS client and the Swift gallery own separate preview coverage; this specification
proves only the real web runtime. Render proof is behavioral DOM assertion, never screenshot
comparison: the widget screenshots in the visual suite are supplementary and are not this
capability's proving oracle.

Every rendered figure asserted here is a derived value, not a copied one. Water is converted from
millilitres, caffeine from grams, heart-rate zones from fixed thresholds, and sleep phases from
their second counts. A requirement below is about the derivation reaching the DOM correctly, not
about the pixel it lands on.

## Requirements

### Requirement: Loading state keeps the heart-rate card in its loading presentation

While the health request is pending, the system SHALL keep the Heart Rate card in its loading
presentation. The server-rendered vitals may remain underneath that presentation until fresh data
arrives.
Verified by `tests/behavioral/health-matrix.test.ts:20`.

#### Scenario: The heart-rate card stays in its loading presentation while health.json is outstanding

- **GIVEN** the dashboard loads with the health.json response held open
- **WHEN** the page reaches DOMContentLoaded before the health data arrives
- **THEN** the Heart Rate card SHALL still be visible carrying its `is-loading` presentation

### Requirement: Absent health quantities render the no-data dash rather than a zero

When a health quantity is absent from the export, the system SHALL render the no-data dash for it
and SHALL NOT render a zero, because a zero reads as a measured value.
Verified by `tests/behavioral/health-matrix.test.ts:32`.

#### Scenario: An export carrying no quantities renders a dash in every vitals slot

- **GIVEN** a health export whose quantities object is empty
- **WHEN** the Heart Rate card finishes loading
- **THEN** the BPM readout, the zone badge, the HRV value and all three footer vitals SHALL each
  render the em-dash placeholder rather than a zero

### Requirement: Baseline health renders the measured heart rate, zone and footer vitals

When the baseline health fixture is served, the system SHALL render the measured heart rate, its
classified zone, and the footer vitals strip, distinguishing an absent quantity from a measured
zero. Heart-rate variability SHALL reach the DOM under its renamed key.
Verified by `tests/behavioral/health-matrix.test.ts:47`.

#### Scenario: The baseline export renders its heart rate, HRV, zone and a signed zero temperature

- **GIVEN** the baseline health export, whose heart rate is 63 and whose variability is carried
  under the HealthKit name `heartRateVariabilitySDNN`, with no resting heart rate or respiratory
  rate and a wrist-temperature delta of exactly 0
- **WHEN** the Heart Rate card finishes loading
- **THEN** it SHALL read "63" with the "Normal Zone" badge, SHALL read "45" for the renamed
  variability quantity, SHALL render the dash for the absent resting and respiratory rates, and
  SHALL render the present-but-zero temperature as "0.0"

### Requirement: Heart-rate zone classification drives the zone badge and the card accent

When the heart rate falls into a zone, the system SHALL render that zone's badge and SHALL apply
that zone's card accent, replacing any previous accent.
Verified by `tests/behavioral/health-matrix.test.ts:63`.

#### Scenario: A bradycardic and a peak reading render different badges and accents

- **GIVEN** a health export reading 42 bpm and then one reading 165 bpm
- **WHEN** each is rendered in turn
- **THEN** the card SHALL read "Bradycardia" with the pink accent for the first, and "Peak Zone"
  with the red accent -- and no pink accent -- for the second

### Requirement: A paused watch replaces heart-rate and movement data with the paused block

When the export reports the watch as unworn, the system SHALL show the paused block on both
watch-driven cards and SHALL hide their data wrappers, so no stale reading is presented as live.
The paused copy SHALL name the cause.
Verified by `tests/behavioral/health-matrix.test.ts:84`.

#### Scenario: An off-wrist watch and a charging watch each hide the data and name their cause

- **GIVEN** a health export reporting the watch unworn through a heart-rate gap, then one
  reporting it unworn because it is charging
- **WHEN** each is rendered in turn
- **THEN** both the Heart Rate and Movement cards SHALL show their paused block with their data
  wrapper hidden, reading "Watch off" for the first and "Watch charging" for the second

### Requirement: Movement rings render the server-synced goals, stand hours, daylight and solar

When the export carries synced goals and solar facts, the system SHALL render the rings and legend
against those goals rather than the client-side defaults, SHALL take stand from the achieved ring
count, and SHALL render the daylight and solar footer from the export.
Verified by `tests/behavioral/health-matrix.test.ts:111`.

#### Scenario: A goals-bearing export renders its own denominators and solar times

- **GIVEN** a health export carrying goals of 650 kcal, 40 exercise minutes, 12 stand hours and 20
  daylight minutes, with 4 achieved stand hours and 48 daylight minutes
- **WHEN** the Movement card finishes loading
- **THEN** the legend SHALL read "103/650", "0/40" and "4/12", the ring centre SHALL read "16%",
  the daylight caption SHALL read 48 with its goal-met mark visible, and the sun arc SHALL read
  "05:39" and "20:24"

### Requirement: Hydration vessels render the converted water and caffeine totals

When the export carries hydration quantities, the system SHALL render water converted from
millilitres to ounces and caffeine converted from grams to milligrams, in both vessels.
Verified by `tests/behavioral/health-matrix.test.ts:132`.

#### Scenario: A zero and a scale-max export both render their converted totals

- **GIVEN** a health export with no water or caffeine, then one at the scale maximum of 4140.3 mL
  and 0.5 g
- **WHEN** the Hydration card finishes loading for each
- **THEN** the vessels SHALL read "0 oz" and "0 mg" for the first, and "140 oz" and "500 mg" for
  the second

### Requirement: Night summary renders the sleep duration and per-phase pills

When the sleep export carries phase durations, the system SHALL render the total sleep duration and
one populated pill per phase, counting only the asleep phases toward the total.
Verified by `tests/behavioral/health-matrix.test.ts:150`.

#### Scenario: The baseline night renders its duration and four phase pills

- **GIVEN** the baseline sleep export of 5500s REM, 5500s deep, 17500s core and 1950s awake
- **WHEN** the Night Summary card finishes loading
- **THEN** it SHALL read "7h 55m" -- REM plus deep plus core, excluding awake -- and SHALL render
  the deep, REM, core and awake pills as "1h 31m", "1h 31m", "4h 51m" and "32m"

### Requirement: Phase dominance drives the restorative caption percentages

When the sleep phase mix changes, the system SHALL render the restorative caption percentages as
proportions of total sleep rather than of time in bed.
Verified by `tests/behavioral/health-matrix.test.ts:164`.

#### Scenario: A deep-dominant night renders its own deep and REM percentages

- **GIVEN** a sleep export of 10800s deep and 3600s REM within 28800s of total sleep
- **WHEN** the Night Summary card finishes loading
- **THEN** it SHALL read "8h 0m" and its restorative caption SHALL read "38% deep" and "13% REM"

### Requirement: An empty sleep export renders night-summary placeholders rather than zeros

When the sleep export records no sleep at all, the system SHALL render placeholders across the card
and SHALL NOT render a zero-valued night as a measured one.
Verified by `tests/behavioral/health-matrix.test.ts:177`.

#### Scenario: A zero-second night renders placeholders and the no-data timestamp

- **GIVEN** a sleep export whose every phase is zero seconds
- **WHEN** the Night Summary card finishes loading
- **THEN** the duration, score and phase pills SHALL each read the placeholder, the insight line
  SHALL read "No sleep data", and the timestamp SHALL read "no data"

### Requirement: Workouts render each session's type, duration, calories and distance

When the workouts export carries sessions, the system SHALL reveal the workouts card and render one
sub-card per session with its activity type, duration, energy burned and distance.
Verified by `tests/behavioral/health-matrix.test.ts:192`.

#### Scenario: A three-session export renders one sub-card per session

- **GIVEN** a workouts export of a 965s walk, a 2700s ride and a 1800s run
- **WHEN** the dashboard finishes loading
- **THEN** the card SHALL be visible with three sub-cards, the walk SHALL read "16m 5s", "72 kcal"
  and "1.14 km", and the ride SHALL read "45m" -- dropping the zero seconds component -- and
  "12.00 km"

### Requirement: A mapped workout type renders its branded label and outbound link

When a session carries a generic activity type that maps to a known studio, the system SHALL render
the mapped label as a safe outbound link, and SHALL omit the distance stat when no distance was
recorded.
Verified by `tests/behavioral/health-matrix.test.ts:212`.

#### Scenario: A generic studio session renders its brand, its link and no distance stat

- **GIVEN** a workouts export holding one 3600s session of the generic type "Other" with no
  distance
- **WHEN** the dashboard finishes loading
- **THEN** the sub-card SHALL render "Barry's Bootcamp" as a link carrying `target="_blank"` and
  `rel="noopener noreferrer"`, SHALL read "1h 0m" and "450 kcal", and SHALL render exactly two
  stats rather than a zero distance

### Requirement: A rest day leaves the conditional workouts card hidden

When the workouts export is empty, the system SHALL leave the conditional workouts card hidden and
SHALL NOT surface the build-time session that the server-rendered shell carries.
Verified by `tests/behavioral/health-matrix.test.ts:230`.

#### Scenario: An empty workouts export keeps the card hidden while the rest of health renders

- **GIVEN** a workouts export containing no sessions
- **WHEN** the dashboard finishes loading
- **THEN** the workouts card SHALL be hidden while the Heart Rate card SHALL remain visible

### Requirement: System status reports each health source as active once its export lands

When an export lands, the system SHALL mark that source's status line active in the system-status
panel, and SHALL omit the location line from the production build.
Verified by `tests/behavioral/health-matrix.test.ts:240`.

#### Scenario: A fully served dashboard reports seven active sources and no location line

- **GIVEN** a dashboard whose every endpoint is served from its baseline fixture
- **WHEN** the dashboard finishes loading
- **THEN** the health status line SHALL read "ACTIVE" in its active styling, the panel SHALL hold
  exactly seven status lines all marked active, and SHALL render no location line
