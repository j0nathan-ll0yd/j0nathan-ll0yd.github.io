import {describe, expect, it} from 'vitest'
import {buildId} from '../../scripts/lib/build-id.mjs'

// The one build id (atlas decision 0160, PR B). The Worker deploys from GitHub Actions only, so the
// commit comes from GITHUB_SHA; the Pages fallback retired with the Pages project (decision 0160 D7).

describe('buildId', () => {
  it('names the GitHub Actions commit', () => {
    expect(buildId({GITHUB_SHA: 'a1b2e846'})).toBe('a1b2e846')
  })

  it('answers dev for a local build, and ignores the retired Pages commit variable', () => {
    expect(buildId({})).toBe('dev')
    expect(buildId({CF_PAGES_COMMIT_SHA: 'a1b2e846'})).toBe('dev')
  })

  it('refuses an id that is not a safe asset name', () => {
    expect(() => buildId({GITHUB_SHA: '../evil'})).toThrow(/not a safe asset name/)
  })
})
