// The built `/` carries no fixture data (atlas decision 0160, PR 0a).
//
// The HTML a client without JavaScript reads is exactly dist/index.html, so these assertions are
// the no-JavaScript view of the page: no fixture value, every live card in its honest `loading`
// state with its <noscript> note, and the authored identity content from @j0nathan-ll0yd/copy.
// tests/behavioral/data-free-shell.test.ts asserts the same page in a real scripts-off browser,
// where the note must also be VISIBLE.
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {load} from 'cheerio'
import {beforeAll, describe, expect, it} from 'vitest'
import {getDashboardFixture} from '@j0nathan-ll0yd/fixtures'
import {identity, profile as profileCopy, widgets} from '@j0nathan-ll0yd/copy'
import {terminalLinesFromBlocks} from '../../src/lib/identity-profile'
import {FIXTURE_SENTINELS, LIVE_CARD_IDS, RETIRED_OVERLAY_ROWS} from '../shared/fixture-sentinels'

const distDir = path.resolve(process.cwd(), 'dist')
let html: string
let $: ReturnType<typeof load>

beforeAll(() => {
  html = readFileSync(path.join(distDir, 'index.html'), 'utf-8')
  $ = load(html)
})

/** The value at a dot path of an object, or undefined. */
function at(root: unknown, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((node, key) => (node == null ? undefined : (node as Record<string, unknown>)[key]), root)
}

/** Every user-visible text node of the built page (scripts and styles excluded), whitespace-collapsed. */
function visibleText(): string {
  const doc = load(html)
  doc('script, style').remove()
  return doc('body').text().replace(/\s+/g, ' ')
}

describe('data-free / (atlas decision 0160, PR 0a)', () => {
  // covers: dashboard-shell#The built page carries no fixture value
  it('each sentinel is a real value of the fixtures baseline the old page rendered', () => {
    const baseline = getDashboardFixture('baseline')
    for (const {text, source} of FIXTURE_SENTINELS) {
      const value = at(baseline, source)
      const rendered = typeof value === 'number' ? value.toLocaleString('en-US') : value
      expect(rendered, `${source} in @j0nathan-ll0yd/fixtures baseline`).toBe(text)
    }
  })

  it('renders no fixture sentinel anywhere in the HTML', () => {
    for (const {text} of FIXTURE_SENTINELS) {
      expect(html, `fixture value "${text}" in dist/index.html`).not.toContain(text)
    }
    for (const row of RETIRED_OVERLAY_ROWS) {
      expect(html, `retired DndOverlay row "${row}" in dist/index.html`).not.toContain(row)
    }
  })

  it('renders no title, name or label from any fixture baseline collection', () => {
    // Derived, not hand-picked: every list the old page rendered, so a new fixture row cannot slip
    // past a fixed sentinel list.
    const baseline = getDashboardFixture('baseline')
    const derived = [
      ...baseline.books.books.map((b) => b.title),
      ...baseline.starredRepos.map((r) => `${r.owner}/${r.name}`),
      ...(baseline.github.devActivity ?? []).map((e) => e.title),
      ...baseline.reading.articles.map((a) => a.title),
      ...baseline.health.workouts.map((w) => w.activity_type)
    ]
    expect(derived.length).toBeGreaterThan(10)
    const text = visibleText()
    for (const value of derived) {
      expect(html, `fixture value "${value}" in dist/index.html`).not.toContain(value)
      expect(text).not.toContain(value)
    }
  })

  it('renders no measured value in the heart-rate readouts', () => {
    for (const id of ['pulseBpm', 'hrZoneBadge', 'hrHrv']) {
      const node = $(`#${id}`)
      if (node.length > 0) {
        expect(node.text().trim(), `#${id}`).toBe('')
      }
    }
    expect($('[data-generated-at]')).toHaveLength(0)
  })

  // covers: dashboard-shell#Every live card renders its honest loading state
  it('renders every live card in the loading state with its noscript note', () => {
    expect($('[data-ssr-state]').map((_, el) => $(el).attr('id')).get().sort()).toEqual([...LIVE_CARD_IDS].sort())
    for (const id of LIVE_CARD_IDS) {
      const card = $(`#${id}`)
      expect(card, `#${id}`).toHaveLength(1)
      expect(card.attr('data-ssr-state'), `#${id}`).toBe('loading')
      expect(card.hasClass('is-loading'), `#${id} skeleton`).toBe(true)
      const note = load(card.find('noscript').html() ?? '')('p.widget-noscript[data-state-notice="loading"]')
      expect(note.text().trim(), `#${id} noscript note`).toBe(widgets.widgetState.needsJavaScript)
    }
  })

  it('renders the System Status rows without a status, age or timestamp', () => {
    const rows = $('#systemStatus .sys-line')
    expect(rows.length).toBe(7)
    rows.each((_, row) => {
      const value = $(row).find('[class*="sys-val"]').text().trim()
      expect(value).toBe('—')
      expect($(row).find('time')).toHaveLength(0)
      expect($(row).attr('data-ssr-state')).toBeUndefined()
    })
    expect($('#systemStatus').text()).not.toMatch(/ACTIVE|OFFLINE|PENDING/)
  })

  // covers: dashboard-shell#The identity content is authored copy and renders without JavaScript
  it('renders the authored identity content from @j0nathan-ll0yd/copy', () => {
    const text = visibleText()
    expect(text).toContain(identity.person.name)
    expect(text).toContain(identity.person.jobTitle)
    expect(text).toContain(identity.person.flavorBio)
    expect(text).toContain(profileCopy.tagline)
    // BioTerminal renders the `$`/`→` marker in its own span, so compare with whitespace removed.
    const squash = (value: string): string => value.replace(/\s+/g, '')
    const terminal = squash($('#cardBio').text())
    const lines = terminalLinesFromBlocks(profileCopy.terminal).filter((line) => line.text !== '')
    expect(lines.length).toBeGreaterThan(5)
    for (const line of lines) {
      expect(terminal, `terminal line ${line.text}`).toContain(squash(line.text))
    }
    for (const url of identity.person.sameAs) {
      expect($(`a[href="${url}"]`).length, url).toBeGreaterThan(0)
    }
  })
})
