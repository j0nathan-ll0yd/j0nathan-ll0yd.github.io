import Ajv, {type ValidateFunction} from 'ajv'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import type {
  ArticlesExport,
  BooksExport,
  GithubEventsExport,
  GithubStarredReposExport,
  HealthExport,
  SleepExport,
  WorkoutsExport
} from '@j0nathan-ll0yd/portal-contract/schemas'
import articlesSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/articles-export.schema.json' with {type: 'json'}
import booksSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/books-export.schema.json' with {type: 'json'}
import githubEventsSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/github-events-export.schema.json' with {type: 'json'}
import starredReposSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/github-starred-repos-export.schema.json' with {type: 'json'}
import healthSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/health-export.schema.json' with {type: 'json'}
import sleepSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/sleep-export.schema.json' with {type: 'json'}
import workoutsSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/workouts-export.schema.json' with {type: 'json'}

type LiveDomain = 'health' | 'sleep' | 'workouts' | 'githubEvents' | 'articles' | 'books' | 'starredRepos'
type Source = 'live' | 'unavailable'
type Freshness = 'fresh' | 'stale' | 'unknown'

interface DomainTypeMap {
  health: HealthExport
  sleep: SleepExport
  workouts: WorkoutsExport
  githubEvents: GithubEventsExport
  articles: ArticlesExport
  books: BooksExport
  starredRepos: GithubStarredReposExport
}

export interface SnapshotDomain<K extends LiveDomain = LiveDomain> {
  key: K
  source: Source
  freshness: Freshness
  generatedAt: string | null
  data: DomainTypeMap[K] | null
}

export type DashboardSnapshot = { [K in LiveDomain]: SnapshotDomain<K> }

interface CfRequestInit extends RequestInit {
  cf?: {cacheEverything?: boolean; cacheTtl?: number}
}

const DOMAIN_ORDER: readonly LiveDomain[] = [
  'health',
  'sleep',
  'workouts',
  'githubEvents',
  'articles',
  'books',
  'starredRepos'
]

// Deliberately excludes focus, location, and theatre reviews. Focus is a privacy
// control, not dashboard content; location is not approved for HTML distribution;
// theatre reviews have no server-rendered widget data today.
export const SSR_ENDPOINTS: Readonly<Record<LiveDomain, string>> = {
  health: ENDPOINTS.health,
  sleep: ENDPOINTS.sleep,
  workouts: ENDPOINTS.workouts,
  githubEvents: ENDPOINTS.githubEvents,
  articles: ENDPOINTS.articles,
  books: ENDPOINTS.books,
  starredRepos: ENDPOINTS.starredRepos
}

const MAX_AGE_MS: Readonly<Record<LiveDomain, number>> = {
  health: 48 * 60 * 60 * 1000,
  sleep: 48 * 60 * 60 * 1000,
  workouts: 7 * 24 * 60 * 60 * 1000,
  githubEvents: 7 * 24 * 60 * 60 * 1000,
  articles: 30 * 24 * 60 * 60 * 1000,
  books: 30 * 24 * 60 * 60 * 1000,
  starredRepos: 30 * 24 * 60 * 60 * 1000
}

const ajv = new Ajv({allErrors: true, strict: true})
const validators: { [K in LiveDomain]: ValidateFunction<DomainTypeMap[K]> } = {
  health: ajv.compile<HealthExport>(healthSchema),
  sleep: ajv.compile<SleepExport>(sleepSchema),
  workouts: ajv.compile<WorkoutsExport>(workoutsSchema),
  githubEvents: ajv.compile<GithubEventsExport>(githubEventsSchema),
  articles: ajv.compile<ArticlesExport>(articlesSchema),
  books: ajv.compile<BooksExport>(booksSchema),
  starredRepos: ajv.compile<GithubStarredReposExport>(starredReposSchema)
}

function unavailable<K extends LiveDomain>(key: K): SnapshotDomain<K> {
  return {key, source: 'unavailable', freshness: 'unknown', generatedAt: null, data: null}
}

function classifyFreshness(key: LiveDomain, generatedAt: string, now: number): Freshness {
  const generatedMs = Date.parse(generatedAt)
  if (!Number.isFinite(generatedMs)) {
    return 'unknown'
  }
  return now - generatedMs <= MAX_AGE_MS[key] ? 'fresh' : 'stale'
}

async function fetchDomain<K extends LiveDomain>(key: K, now: number, timeoutMs: number): Promise<SnapshotDomain<K>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const init: CfRequestInit = {signal: controller.signal, cf: {cacheEverything: true, cacheTtl: 60}}
    const response = await fetch(`${CLOUDFRONT_BASE}${SSR_ENDPOINTS[key]}`, init)
    if (!response.ok) {
      return unavailable(key)
    }

    const candidate: unknown = await response.json()
    const validate = validators[key] as ValidateFunction<DomainTypeMap[K]>
    if (!validate(candidate)) {
      return unavailable(key)
    }

    const generatedAt = candidate.generatedAt
    if (!Number.isFinite(Date.parse(generatedAt))) {
      return unavailable(key)
    }
    return {key, source: 'live', freshness: classifyFreshness(key, generatedAt, now), generatedAt, data: candidate}
  } catch {
    return unavailable(key)
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchDashboardSnapshot(options: {now?: number; timeoutMs?: number} = {}): Promise<DashboardSnapshot> {
  const now = options.now ?? Date.now()
  const timeoutMs = options.timeoutMs ?? 2500
  const settled = await Promise.allSettled(DOMAIN_ORDER.map((key) => fetchDomain(key, now, timeoutMs)))
  const domains = settled.map((result, index) => {
    const key = DOMAIN_ORDER[index]!
    return result.status === 'fulfilled' ? result.value : unavailable(key)
  })
  return Object.fromEntries(domains.map((domain) => [domain.key, domain])) as DashboardSnapshot
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function safeLink(url: string, label: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return escapeHtml(label)
    }
    return `<a href="${escapeHtml(parsed.href)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
  } catch {
    return escapeHtml(label)
  }
}

function card(domain: SnapshotDomain, title: string, body: string): string {
  const generated = domain.generatedAt
    ? `<time datetime="${escapeHtml(domain.generatedAt)}">${escapeHtml(domain.generatedAt)}</time>`
    : '<span data-generated-at="unknown">unknown</span>'
  const content = domain.data === null ? '<p>Live data unavailable.</p>' : body
  return `<section class="tri-card" id="ssrCard-${domain.key}" data-ssr-domain="${domain.key}" data-ssr-source="${domain.source}" data-ssr-freshness="${domain.freshness}"${
    domain.generatedAt ? ` data-generated-at="${escapeHtml(domain.generatedAt)}"` : ''
  }><div class="widget-header"><h3 class="widget-label">${
    escapeHtml(title)
  }</h3><div class="widget-header-right"><span class="widget-timestamp">${domain.source} / ${domain.freshness}</span></div></div><div class="widget-body"><p>Generated: ${generated}</p>${content}</div></section>`
}

function renderHealth(domain: SnapshotDomain<'health'>): string {
  const body = domain.data
    ? `<p>Date: <time datetime="${escapeHtml(domain.data.date)}">${escapeHtml(domain.data.date)}</time></p><dl>${
      Object.entries(domain.data.quantities).map(([name, quantity]) =>
        `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(quantity.value)} ${escapeHtml(quantity.unit)}</dd></div>`
      ).join('')
    }</dl>`
    : ''
  return card(domain, 'Health', body)
}

function renderSleep(domain: SnapshotDomain<'sleep'>): string {
  const phases = ['awake', 'core', 'deep', 'rem'] as const
  const body = domain.data
    ? `<p>Date: <time datetime="${escapeHtml(domain.data.date)}">${escapeHtml(domain.data.date)}</time></p><dl>${
      phases.map((phase) => `<div><dt>${phase}</dt><dd>${escapeHtml(domain.data?.[phase]?.seconds ?? 0)} seconds</dd></div>`).join('')
    }</dl>`
    : ''
  return card(domain, 'Sleep', body)
}

function renderWorkouts(domain: SnapshotDomain<'workouts'>): string {
  const body = domain.data
    ? `<p>Date: <time datetime="${escapeHtml(domain.data.date)}">${escapeHtml(domain.data.date)}</time></p><ul>${
      domain.data.workouts.map((workout) =>
        `<li>${escapeHtml(workout.activityType)} — ${
          workout.duration === null ? 'duration unavailable' : `${escapeHtml(workout.duration)} seconds`
        } — source: ${escapeHtml(workout.source)}</li>`
      ).join('')
    }</ul>`
    : ''
  return card(domain, 'Workouts', body)
}

function renderGithub(domain: SnapshotDomain<'githubEvents'>): string {
  const body = domain.data
    ? `<ul>${
      domain.data.events.slice(0, 10).map((event) => {
        const repo = event.repo ?? ''
        let url = ''
        if (event.type === 'commit' && event.hash) {
          url = `https://github.com/${repo}/commit/${event.hash}`
        }
        if (event.type.startsWith('pr_') && event.number !== undefined) {
          url = `https://github.com/${repo}/pull/${event.number}`
        }
        if (event.type.startsWith('issue_') && event.number !== undefined) {
          url = `https://github.com/${repo}/issues/${event.number}`
        }
        return `<li>${url ? safeLink(url, event.title) : escapeHtml(event.title)} — ${escapeHtml(repo)} — <time datetime="${escapeHtml(event.date)}">${
          escapeHtml(event.date)
        }</time></li>`
      }).join('')
    }</ul>`
    : ''
  return card(domain, 'GitHub activity', body)
}

function renderArticles(domain: SnapshotDomain<'articles'>): string {
  const body = domain.data
    ? `<ul>${
      domain.data.articles.slice(0, 12).map((article) =>
        `<li>${safeLink(article.articleUrl, article.articleTitle)} — ${escapeHtml(article.sourceTitle ?? '')} — <time datetime="${
          escapeHtml(article.savedAt)
        }">${escapeHtml(article.savedAt)}</time></li>`
      ).join('')
    }</ul>`
    : ''
  return card(domain, 'Saved articles', body)
}

function renderBooks(domain: SnapshotDomain<'books'>): string {
  const body = domain.data
    ? `<ul>${
      domain.data.books.slice(0, 12).map((book) => {
        const progress = book.currentPage != null && book.totalPages != null
          ? ` — page ${escapeHtml(book.currentPage)} of ${escapeHtml(book.totalPages)}`
          : ''
        return `<li>${escapeHtml(book.title)} — ${escapeHtml(book.author)} — status: ${escapeHtml(book.status ?? 'unspecified')}${progress}</li>`
      }).join('')
    }</ul>`
    : ''
  return card(domain, 'Books', body)
}

function renderStarred(domain: SnapshotDomain<'starredRepos'>): string {
  const body = domain.data
    ? `<ul>${
      domain.data.repos.slice(0, 5).map((repo) =>
        `<li>${safeLink(repo.htmlUrl, `${repo.ownerLogin}/${repo.name}`)} — ${escapeHtml(repo.stargazersCount)} stars — <time datetime="${
          escapeHtml(repo.starredAt)
        }">${escapeHtml(repo.starredAt)}</time></li>`
      ).join('')
    }</ul>`
    : ''
  return card(domain, 'Starred repositories', body)
}

export function snapshotProvenance(snapshot: DashboardSnapshot): Record<string, {source: string; freshness: string; generatedAt: string | null}> {
  const live = Object.fromEntries(DOMAIN_ORDER.map((key) => {
    const domain = snapshot[key]
    return [key, {source: domain.source, freshness: domain.freshness, generatedAt: domain.generatedAt}]
  }))
  return {
    profile: {source: 'static', freshness: 'not-applicable', generatedAt: null},
    system: {source: 'static', freshness: 'not-applicable', generatedAt: null},
    ...live
  }
}

export function renderDashboardSnapshot(snapshot: DashboardSnapshot): string {
  return `<div id="ssrDashboardSnapshot" class="triptych-column triptych-column-body" data-location-export="excluded"><h2 class="column-header column-header-pink">Body</h2>${
    renderHealth(snapshot.health)
  }${renderSleep(snapshot.sleep)}${
    renderWorkouts(snapshot.workouts)
  }</div><div class="triptych-column triptych-column-mind"><h2 class="column-header column-header-green">Mind</h2>${renderGithub(snapshot.githubEvents)}${
    renderArticles(snapshot.articles)
  }${renderStarred(snapshot.starredRepos)}${renderBooks(snapshot.books)}</div>`
}
