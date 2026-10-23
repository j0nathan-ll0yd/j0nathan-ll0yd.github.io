// @vitest-environment node
//
// The composer's facts and the KV values the backend publishes (atlas decision 0164, Variant D,
// Phase 1.3 and 1.4). The composer adds `facts` to the artifact body: what the Worker's own fragment
// check reads from its fragments, as plain arrays. The S3 read path ignores the field. The fixtures
// in tests/fixtures/composed/ hold the same composition as the artifact and as the two KV values.
import {readFileSync} from 'node:fs'
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {describe, expect, it} from 'vitest'
import {checkArtifact, COMPOSED_FRAGMENT_IDS, fromWireFacts, toWireFacts, type WireFacts} from '../../src/lib/composed/artifact'
import {
  PUBLISHED_FOCUS_KEY,
  PUBLISHED_MAX_BYTES,
  PUBLISHED_METADATA_MAX_BYTES,
  PUBLISHED_TTL_S,
  publishedEntry,
  publishedFocusValue,
  type PublishedFragments,
  publishedFragmentsKey
} from '../../src/lib/composed/published'

const fixture = (name: string) => readFileSync(new URL(`../fixtures/composed/${name}`, import.meta.url), 'utf8')
const DASHBOARD = fixture('dashboard.json')
const ARTIFACT = JSON.parse(DASHBOARD) as {composedAt: string; currentFocus: string; summary: string; fragments: Record<string, string>; facts: WireFacts}
const NOW = Date.parse(ARTIFACT.composedAt)
const HIDING: ReadonlySet<string> = new Set(HIDING_FOCUS_MODES)

describe('the artifact body carries the facts (atlas decision 0164)', () => {
  it('holds the Worker check of its own fragments, every fragment id a key', () => {
    const checked = checkArtifact(DASHBOARD, NOW, 'fixture', HIDING)
    expect(checked.ok).toBe(true)
    expect(checked.ok && toWireFacts(checked.facts)).toEqual(ARTIFACT.facts)
    expect(Object.keys(ARTIFACT.facts.scopes)).toEqual([...COMPOSED_FRAGMENT_IDS])
    expect(Object.keys(ARTIFACT.facts.roots)).toEqual([...COMPOSED_FRAGMENT_IDS])
  })

  it('is still admitted by checkArtifact with the added field, exactly as without it', () => {
    const {facts: _facts, ...without} = ARTIFACT
    const withField = checkArtifact(DASHBOARD, NOW, 'fixture', HIDING)
    const withoutField = checkArtifact(JSON.stringify(without), NOW, 'fixture', HIDING)
    expect(withField.ok && withoutField.ok).toBe(true)
    expect(withField).toEqual(withoutField)
    // The checked artifact keeps only the fields the Worker uses.
    expect(withField.ok && 'facts' in withField.artifact).toBe(false)
  })

  it('round-trips between the wire arrays and the sets the shell check reads', () => {
    expect(toWireFacts(fromWireFacts(ARTIFACT.facts))).toEqual(ARTIFACT.facts)
  })
})

describe('the KV values (src/lib/composed/published.ts)', () => {
  it('names the two keys and bounds them', () => {
    expect(PUBLISHED_FOCUS_KEY).toBe('focus')
    expect(publishedFragmentsKey('abc123')).toBe('fragments:abc123')
    expect(PUBLISHED_TTL_S).toBe(690)
    expect(PUBLISHED_MAX_BYTES).toBe(512 * 1024)
  })

  it('encodes the fragments entry with only the three published fields, and its metadata', () => {
    const source = {...ARTIFACT, extra: 'dropped'} as unknown as PublishedFragments
    const entry = publishedEntry(source, 'abc123', ARTIFACT.composedAt)
    expect(entry.key).toBe('fragments:abc123')
    expect(Object.keys(JSON.parse(entry.value) as object)).toEqual(['fragments', 'facts', 'summary'])
    expect(entry.metadata).toEqual({build: 'abc123', composedAt: ARTIFACT.composedAt, summary: ARTIFACT.summary})
  })

  it('refuses metadata over the KV limit', () => {
    const source = ARTIFACT as unknown as PublishedFragments
    expect(() => publishedEntry(source, 'b'.repeat(PUBLISHED_METADATA_MAX_BYTES), ARTIFACT.composedAt)).toThrow(/metadata limit/)
  })

  it('encodes the focus value with only its two fields', () => {
    const value = publishedFocusValue(
      {currentFocus: 'None', publishedAt: ARTIFACT.composedAt, extra: 1} as unknown as Parameters<typeof publishedFocusValue>[0]
    )
    expect(JSON.parse(value)).toEqual({currentFocus: 'None', publishedAt: ARTIFACT.composedAt})
  })
})

describe('the KV fixtures (tests/fixtures/composed/generate.mjs)', () => {
  it('hold the artifact fragments, facts and summary, under the fixture build', () => {
    const value = fixture('kv-fragments.json')
    expect(value).toBe(publishedEntry(ARTIFACT as unknown as PublishedFragments, 'fixture', ARTIFACT.composedAt).value)
    expect(value.length).toBeLessThan(PUBLISHED_MAX_BYTES)
    expect(JSON.parse(fixture('kv-fragments.metadata.json'))).toEqual({build: 'fixture', composedAt: ARTIFACT.composedAt, summary: 'live'})
  })

  it('hold the focus value the artifact was composed under, published at the composition time', () => {
    expect(fixture('kv-focus.json')).toBe(publishedFocusValue({currentFocus: ARTIFACT.currentFocus, publishedAt: ARTIFACT.composedAt}))
    expect((JSON.parse(fixture('focus.json')) as {currentFocus: string}).currentFocus).toBe(ARTIFACT.currentFocus)
  })
})
