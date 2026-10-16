import {readFileSync} from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {clientDir} from '../../scripts/lib/build-paths.mjs'

// The composed page's containment (atlas decision 0160, PR B; review 2026-10-16, round 4). A
// composed card may carry its component's own absolute layers; `.tri-card` keeps them inside the card
// because it is their containing block. Its `transform` is `none` once the card is revealed (and in
// print), so `container-type` is what holds. A design-system change that drops it would let a
// card's own layers cover its column, so the built page pins it.

const page = readFileSync(path.join(clientDir(), 'index.html'), 'utf8')
const triCardRules = [...page.matchAll(/(?:^|[{}\s,])\.tri-card\{([^}]*)\}/g)].map((match) => match[1] ?? '')

describe('.tri-card is the containing block of a card', () => {
  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it('sets container-type in its base rule', () => {
    expect(triCardRules.some((rule) => /(?:^|;)container-type:(?:inline-size|size)(?:;|$)/.test(rule))).toBe(true)
  })

  it('never resets container-type or contain in a later rule', () => {
    expect(triCardRules.filter((rule) => /container-type:normal|contain:none/.test(rule))).toEqual([])
  })

  it('clips its overflow', () => {
    expect(triCardRules.some((rule) => /(?:^|;)overflow:hidden(?:;|$)/.test(rule))).toBe(true)
  })
})
