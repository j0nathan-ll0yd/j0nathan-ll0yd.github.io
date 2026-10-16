// Shared harness for the edge-injection parity oracle (atlas decision 0160, PR B; owner decision
// 2026-10-16, option B). Astro renders the design system's widgets through the Container API (the
// ORACLE; this path never runs in the Worker). The site's injector runs in workerd, with the real
// HTMLRewriter, through wrangler's local runtime. A test compares the two, card by card.
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {experimental_AstroContainer as AstroContainer} from 'astro/container'
import {load} from 'cheerio'
import {unstable_dev} from 'wrangler'
import type {ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'
import {decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import {mirroredBookCovers} from '../../src/lib/book-cover-mirror'
import type {DashboardLoad, DomainOutcome, GatedKey} from '../../src/lib/data-plane/loader'
import {type DashboardRender, toDashboardRender} from '../../src/lib/data-plane/render-model'

const require = createRequire(import.meta.url)

export const LOCAL_COVERS = mirroredBookCovers()

const FIXTURE_DIRS: Record<GatedKey | 'focus', string> = {
  health: 'health',
  sleep: 'sleep',
  workouts: 'workouts',
  books: 'books',
  githubEvents: 'github-events',
  starredRepos: 'github-starred-repos',
  articles: 'articles',
  theatreReviews: 'theatre-reviews',
  focus: 'focus'
}

/** A raw fixture export, optionally restamped and changed. */
export function rawFixture(key: GatedKey | 'focus', variation: string, change: (raw: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const raw: Record<string, unknown> = JSON.parse(
    readFileSync(require.resolve(`@j0nathan-ll0yd/fixtures/generated/${FIXTURE_DIRS[key]}/${variation}.json`), 'utf8')
  )
  change(raw)
  return raw
}

export type DomainSpec = {variation: string; generatedAt?: string; change?: (raw: Record<string, unknown>) => void} | 'unavailable' | 'suppressed'

/** A load the loader could have produced, built from fixtures with no network. */
export function fixtureLoad(currentFocus: string | 'unreadable', domains: Partial<Record<GatedKey, DomainSpec>>, defaultGeneratedAt: string): DashboardLoad {
  const keys: GatedKey[] = ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'theatreReviews']
  const outcome = (key: GatedKey): DomainOutcome => {
    const spec = domains[key] ?? {variation: 'baseline'}
    if (spec === 'unavailable') {
      return {kind: 'unavailable', reason: 'http-503'}
    }
    if (spec === 'suppressed') {
      return {kind: 'suppressed'}
    }
    const raw = rawFixture(key, spec.variation, spec.change)
    raw.generatedAt = spec.generatedAt ?? defaultGeneratedAt
    return {kind: 'ok', data: decodeArtifact(key as ResourceKey, raw)} as DomainOutcome
  }
  const hiding = currentFocus === 'Work' || currentFocus === 'Do Not Disturb'
  const anySuppressed = Object.values(domains).includes('suppressed')
  return {
    focus: currentFocus === 'unreadable' ? {state: 'unreadable', reason: 'timeout'} : {state: hiding ? 'hiding' : 'visible', currentFocus},
    domains: Object.fromEntries(keys.map((key) => [
      key,
      currentFocus === 'unreadable' ? {kind: 'unavailable', reason: 'focus-unreadable'} : hiding || anySuppressed ? {kind: 'suppressed'} : outcome(key)
    ])) as DashboardLoad['domains'],
    suppressed: hiding || anySuppressed,
    ioMs: 0
  }
}

export function renderOf(loaded: DashboardLoad, nowMs: number): DashboardRender {
  return toDashboardRender(loaded, nowMs)
}

/** The Astro side: the design system's components, rendered in Node. */
export async function astroContainer() {
  return AstroContainer.create()
}

/** The workerd side: the site's injector with the real HTMLRewriter. */
export async function startInjector() {
  return unstable_dev('tests/oracle/edge-harness.worker.ts', {
    config: 'tests/oracle/wrangler.oracle.jsonc',
    // wrangler takes each define as `KEY:VALUE`; it splits at the first colon.
    define: [`__MIRRORED_BOOK_COVERS__:${JSON.stringify(LOCAL_COVERS)}`, `__SSR_BUILD_ID__:${JSON.stringify('test')}`],
    experimental: {disableExperimentalWarning: true},
    logLevel: 'error'
  })
}

/**
 * One element's markup in a comparable form: attributes sorted, and nothing else changed. Attribute
 * order is the one difference neither parsing nor layout sees. Whitespace is kept exactly: inside
 * inline elements it is laid out, and it moved a shelf by two pixels when an earlier version of this
 * comparison collapsed it.
 */
export function normalized(html: string, selector: string): string {
  const $ = load(html)
  const root = $(selector).first()
  if (root.length === 0) {
    return `<missing ${selector}>`
  }
  const walk = (node: ReturnType<typeof $>[number]): string => {
    if (node.type === 'text') {
      return (node.data ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
      return ''
    }
    const attrs = Object.entries(node.attribs ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ` ${k}="${v}"`).join('')
    const children = (node.children ?? []).map((child) => walk(child as ReturnType<typeof $>[number])).join('')
    return `<${node.name}${attrs}>${children}</${node.name}>`
  }
  return walk(root[0])
}
