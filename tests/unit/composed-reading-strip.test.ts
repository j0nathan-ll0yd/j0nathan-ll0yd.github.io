// @vitest-environment node
//
// Option B ('strip', src/lib/composed/reading-option.ts): the Worker refuses an any-host article link,
// so flipping READING_LINKS closes the host allowlist on the Worker as well as in the composer.
import {readFileSync} from 'node:fs'
import {describe, expect, it, vi} from 'vitest'
import {COMPOSED_MAX_FUTURE_SKEW_MS} from '../../src/lib/composed/artifact'
import {checkFragment} from '../../src/lib/composed/fragment-policy'

vi.mock('../../src/lib/composed/reading-option', () => ({READING_LINKS: 'strip'}))

const ARTIFACT = JSON.parse(readFileSync(new URL('../fixtures/composed/dashboard.json', import.meta.url), 'utf8')) as {
  composedAt: string
  fragments: Record<string, string>
}
const OPTIONS = {maxGeneratedAtMs: Date.parse(ARTIFACT.composedAt) + COMPOSED_MAX_FUTURE_SKEW_MS, overlayMayShow: false}

describe("the Worker under READING_LINKS 'strip'", () => {
  it('refuses the any-host article link it admits under option A', () => {
    expect(ARTIFACT.fragments.cardReading).toContain('class="article-list-title" href="https://articles.known-answer-kappa-7731.invalid/')
    expect(checkFragment(ARTIFACT.fragments.cardReading, 'cardReading', OPTIONS)).toMatchObject({ok: false, reason: 'url'})
  })

  it('still admits the Reading fragment with its titles as text', () => {
    const text = ARTIFACT.fragments.cardReading.replace(/<a class="article-list-title" href="[^"]*" target="_blank" rel="noopener noreferrer">([^<]*)<\/a>/g,
      '<span class="article-list-title">$1</span>')
    expect(checkFragment(text, 'cardReading', OPTIONS)).toMatchObject({ok: true})
  })
})
