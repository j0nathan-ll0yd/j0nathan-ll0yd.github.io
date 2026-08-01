import {type DashboardFixture, fixtures, type FixtureVariation, getDashboardFixture} from '@j0nathan-ll0yd/fixtures'

/**
 * The dashboard payload that backs the SSR build output. This is the exact
 * post-adapter display shape produced by `@j0nathan-ll0yd/fixtures` (Plan #04,
 * docs/onboarding-review/04-fixtures-as-ssr-shell.md). The fixtures package is
 * the single source of truth for representative content; this repo no longer
 * hand-bakes `data/*.json`.
 */
export type DashboardData = DashboardFixture

/** Known post-adapter variation keys (e.g. 'baseline', 'empty'). */
const VARIATIONS = Object.keys(fixtures.profile) as FixtureVariation[]

function resolveVariation(value: string | undefined): FixtureVariation {
  return value && (VARIATIONS as string[]).includes(value)
    ? (value as FixtureVariation)
    : 'baseline'
}

/**
 * Loads the dashboard payload that backs SSR build output.
 *
 * Runs only at Astro build time. The variation is chosen by
 * `import.meta.env.FIXTURE_VARIATION` (wired in astro.config.mjs from the build
 * process env); the visual suite sets it to select a named post-adapter
 * variation. Defaults to `baseline` (the representative SSR shell); an unknown
 * value also falls back to `baseline`.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  return getDashboardFixture(resolveVariation(import.meta.env.FIXTURE_VARIATION))
}
