// @vitest-environment node
//
// The Worker's fragment allowlist against a browser parser (atlas decision 0160, PR B; review
// 2026-10-16, N2). Seeded random mutations of the committed fixture's fragments, each injected with
// dangerous tokens. Every mutation the allowlist ADMITS is spliced into a slot of a whole page, as the
// Worker splices it, and parsed with parse5 (the WHATWG tree builder): the slot must hold one root
// with the fragment's id (plus Hydration's carrier), every element and attribute must be on the
// allowlist, there must be no comment, and the element after the slot must still be the page's own,
// so no admitted fragment swallowed or reparented the rest of the page.
import {readFileSync} from 'node:fs'
import fc from 'fast-check'
import {parse} from 'parse5'
import {describe, expect, it} from 'vitest'
import {COMPOSED_FRAGMENT_IDS, COMPOSED_MAX_FUTURE_SKEW_MS} from '../../src/lib/composed/artifact'
import {checkFragment} from '../../src/lib/composed/fragment-policy'
import {mutateFragment, mutation, parsedShape, sourceShape, treeProblems} from '../shared/fragment-mutations'

const ARTIFACT = JSON.parse(readFileSync(new URL('../fixtures/composed/dashboard.json', import.meta.url), 'utf8')) as {
  composedAt: string
  fragments: Record<string, string>
}
const OPTIONS = {maxGeneratedAtMs: Date.parse(ARTIFACT.composedAt) + COMPOSED_MAX_FUTURE_SKEW_MS, overlayMayShow: false}

describe('checkFragment against parse5 (review 2026-10-16, N2)', () => {
  it('reads the same shape from source and from parse5 for well-nested markup, and a different one for a reparented block', () => {
    expect(sourceShape('<div id="a"><span class="x"></span><img src="/i"></div>')).toBe('(div[id](span[class])(img[src]))')
    expect(parsedShape(parse('<body><div id="a"><span class="x"></span><img src="/i"></div></body>').childNodes)).toContain(
      '(div[id](span[class])(img[src]))'
    )
    expect(treeProblems('<div id="cardHR"><p><div></div></p></div>', 'cardHR').some((p) => p.startsWith('tree differs'))).toBe(true)
  })

  it('admits the unmutated fixture fragments, and parse5 reads each as an allowlisted tree', () => {
    for (const id of COMPOSED_FRAGMENT_IDS) {
      const fragment = ARTIFACT.fragments[id] ?? ''
      expect(checkFragment(fragment, id, OPTIONS).ok, id).toBe(true)
      expect(treeProblems(fragment, id), id).toEqual([])
    }
  })

  it('every admitted mutation parses into an allowlisted tree with one root and the right id', () => {
    let admitted = 0
    let refused = 0
    fc.assert(fc.property(mutation, ({id, edits}) => {
      const fragment = mutateFragment(ARTIFACT.fragments[id] ?? '', edits)
      if (!checkFragment(fragment, id, OPTIONS).ok) {
        refused++
        return true
      }
      admitted++
      const problems = treeProblems(fragment, id)
      if (problems.length > 0) {
        throw new Error(`${id}: admitted ${JSON.stringify(edits)} but parse5 reads ${problems.join('; ')}`)
      }
      return true
    }), {numRuns: 4_000, seed: 20261016})
    // Not vacuous: the run exercised both sides of the allowlist.
    expect(admitted).toBeGreaterThan(200)
    expect(refused).toBeGreaterThan(1_000)
  }, 20_000)
})
