// @vitest-environment node
//
// The shell cut (atlas decision 0160, PR B; review 2026-10-16, H1): each replaced element of the
// data-free page becomes a slot that knows its own scoped-style hashes, so a fragment may carry only
// its own component's hashes, and the ids the page keeps around the slots are known. Node has no
// HTMLRewriter, so these tests feed `cutMarked` the marked page `cutShell` produces in the Worker.
import {describe, expect, it} from 'vitest'
import {type ArtifactFacts, COMPOSED_FRAGMENT_IDS, type ComposedFragmentId} from '../../src/lib/composed/artifact'
import {assemble, cutMarked, fitsShell} from '../../src/lib/composed/shell'

const scopeOf = (id: string) => `data-astro-cid-${id.toLowerCase().slice(0, 8)}`

const OVERLAYS: readonly string[] = ['focusOverlay', 'dndOverlay']

/** A data-free page as `cutShell` marks it: the robots meta, then one marked element per fragment. */
function markedPage(): string {
  const slots = COMPOSED_FRAGMENT_IDS.map((id) => {
    const kind = OVERLAYS.includes(id) ? '' : ' class="tri-card tri-card-accent-pink is-loading"'
    return ` ssr-shell:start:${id} <div${kind} id="${id}" ${scopeOf(id)}><span id="${id}Inner">loading</span></div> ssr-shell:end:${id} `
  })
  return `<html><head><meta name="robots" content="index"> ssr-shell:summary </head><body><h1 id="identityName">x</h1>${slots.join('<hr>')}</body></html>`
}

/** What the allowlist reads from well-shaped fragments, with the changes a test makes. */
function facts(
  scopes: Partial<Record<ComposedFragmentId, string[]>>,
  ids: string[] = [],
  roots: Partial<Record<ComposedFragmentId, {classes: string[]; scopes: string[]}>> = {}
): ArtifactFacts {
  return {
    ids: new Set(ids),
    scopes: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, new Set(scopes[id] ?? [scopeOf(id)])])) as ArtifactFacts['scopes'],
    roots: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => {
      const root = roots[id] ?? {classes: OVERLAYS.includes(id) ? [] : ['tri-card', 'tri-card-accent-red'], scopes: [scopeOf(id)]}
      return [id, {classes: new Set(root.classes), scopes: new Set(root.scopes)}]
    })) as ArtifactFacts['roots']
  }
}

describe('cutMarked', () => {
  it('cuts one slot per fragment plus the summary, and keeps every byte around them', () => {
    const shell = cutMarked(markedPage(), new Headers())
    expect(shell.slots).toEqual(['summary', ...COMPOSED_FRAGMENT_IDS])
    const fragments = Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, `[${id}]`])) as Record<ComposedFragmentId, string>
    const page = assemble(shell, fragments, 'live')
    expect(page).toContain('<meta name="robots" content="index"><meta name="ssr-data" content="live"></head>')
    expect(page).toContain('[cardHR]<hr>[cardMovement]')
    expect(page).not.toContain('ssr-shell:')
    expect(page).not.toContain('loading')
  })

  it("records each slot's own scoped-style hashes, and the ids the page keeps outside the slots", () => {
    const shell = cutMarked(markedPage(), new Headers())
    expect([...shell.scopes.cardHR]).toEqual([scopeOf('cardHR')])
    expect(shell.roots.cardHR).toEqual({firstClass: 'tri-card', scopes: new Set([scopeOf('cardHR')])})
    expect(shell.roots.dndOverlay).toEqual({firstClass: null, scopes: new Set([scopeOf('dndOverlay')])})
    expect([...shell.ids]).toEqual(['identityName'])
  })

  it('throws on a page whose markers are out of order or missing', () => {
    expect(() => cutMarked(markedPage().replace(' ssr-shell:end:cardHR ', ''), new Headers())).toThrow()
    expect(() => cutMarked(markedPage().replace(' ssr-shell:start:cardBooks ', ''), new Headers())).toThrow()
  })
})

describe('fitsShell (review 2026-10-16, H1)', () => {
  const shell = cutMarked(markedPage(), new Headers())

  it("admits fragments that carry their own component's hash and root shape (a data accent may differ)", () => {
    expect(fitsShell(shell, facts({}))).toBeNull()
  })

  // The round-3 reproducers (2026-10-16): each passed the allowlist and the per-slot scope check.
  it("refuses a card root without its slot's first class (its own absolute layers would reach the column)", () => {
    expect(fitsShell(shell, facts({}, [], {cardHydration: {classes: [], scopes: [scopeOf('cardHydration')]}}))).toBe('root')
  })

  it("refuses an overlay root without its slot's scoped-style hash (it would escape display: none)", () => {
    expect(fitsShell(shell, facts({}, [], {dndOverlay: {classes: [], scopes: []}}))).toBe('root')
  })

  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it("refuses a fragment that borrows another component's hash (a Privacy Mode badge drawn in another card)", () => {
    expect(fitsShell(shell, facts({cardStarredRepos: [scopeOf('cardStarredRepos'), scopeOf('dndOverlay')]}))).toBe('scopes')
  })

  it('refuses a fragment that carries an id the page keeps', () => {
    expect(fitsShell(shell, facts({}, ['identityName']))).toBe('ids')
  })
})
