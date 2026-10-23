// @vitest-environment node
//
// The Worker's read of the published page data (atlas decision 0164, Variant D;
// src/lib/composed/published.ts `readPublished`). The five privacy invariants of the concurrent
// CloudFront read (tests/unit/composed-read-concurrent.test.ts), restated over the two KV keys:
//
// 1. Fragments only under a VISIBLE `focus` read in the same request AND admitted fragments.
// 2. The gate wins: the backend writes the gate's value-free fragments, and the Worker serves what
//    it finds under a visible value; it never serves fragments over a hiding one.
// 3. Hiding never touches fragment bytes: the value is never read, parsed or logged.
// 4. An unreadable `focus` (missing, malformed, stale, future, a failed read) fails closed.
// 5. No Cache API, and no `waitUntil` after the answer.
//
// Then each closed-set reason and the 512 KiB cap.
import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {COMPOSED_FRAGMENT_IDS, type WireFacts} from '../../src/lib/composed/artifact'
import {
  FOCUS_CACHE_TTL_S,
  type PageStore,
  PUBLISHED_MAX_BYTES,
  publishedFocusValue,
  type PublishedRead,
  type PublishedReadOptions,
  readPublished
} from '../../src/lib/composed/published'
import type {Shell} from '../../src/lib/composed/shell'

const fixture = (name: string) => readFileSync(new URL(`../fixtures/composed/${name}`, import.meta.url), 'utf8')
const VALUE = fixture('kv-fragments.json')
const METADATA = JSON.parse(fixture('kv-fragments.metadata.json')) as {build: string; composedAt: string; summary: string}
const FACTS = (JSON.parse(VALUE) as {facts: WireFacts}).facts
const NOW = Date.parse(METADATA.composedAt) + 60_000
const VISIBLE = publishedFocusValue({currentFocus: 'None', publishedAt: new Date(NOW - 10_000).toISOString()})
const HIDING: ReadonlySet<string> = new Set(HIDING_FOCUS_MODES)

/** A shell every fixture fragment fits: each slot carries its fragment's own hashes and root shape. */
const SHELL: Shell = {
  pieces: ['<head>', ...COMPOSED_FRAGMENT_IDS.map(() => '|'), '</body>'],
  slots: ['summary', ...COMPOSED_FRAGMENT_IDS],
  scopes: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, new Set(FACTS.scopes[id])])) as Shell['scopes'],
  roots: Object.fromEntries(
    COMPOSED_FRAGMENT_IDS.map((id) => [id, {firstClass: FACTS.roots[id].classes[0] ?? null, scopes: new Set(FACTS.roots[id].scopes)}])
  ) as Shell['roots'],
  ids: new Set(['identityName']),
  headers: new Headers({'Content-Type': 'text/html; charset=utf-8'})
}

interface Traced {
  store: PageStore
  /** Every read of the fragments value's text. */
  valueReads: number
  calls: {get: {key: string; options: unknown}[]; getWithMetadata: string[]}
}

/** A KV double. `value` is behind a getter, so any read of the fragments bytes is counted. */
function traced(
  focus: string | null | Error,
  value: string | null = VALUE,
  metadata: unknown = METADATA,
  delays: {focusMs?: number; fragmentsMs?: number} = {}
): Traced {
  const trace: Traced = {store: undefined as unknown as PageStore, valueReads: 0, calls: {get: [], getWithMetadata: []}}
  const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
  trace.store = {
    async get(key, options) {
      trace.calls.get.push({key, options})
      await wait(delays.focusMs)
      if (focus instanceof Error) {
        throw focus
      }
      return focus
    },
    async getWithMetadata(key) {
      trace.calls.getWithMetadata.push(key)
      await wait(delays.fragmentsMs)
      const result = {metadata}
      Object.defineProperty(result, 'value', {
        enumerable: true,
        get() {
          trace.valueReads++
          return value
        }
      })
      return result as {value: string | null; metadata: unknown}
    }
  }
  return trace
}

function read(trace: Traced, options: Partial<PublishedReadOptions> = {}): Promise<PublishedRead> {
  return readPublished({store: trace.store, nowMs: NOW, build: 'fixture', shell: SHELL, hidingModes: HIDING, ...options})
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('invariant 1: fragments only under a visible focus AND admitted fragments', () => {
  // covers: dashboard-ssr#The Worker splices only fragments its own build's composer published, checked by that composer
  it('admits the published fixture under a visible focus, reading both keys together', async () => {
    const trace = traced(VISIBLE, VALUE, METADATA, {focusMs: 20})
    const pending = read(trace)
    // Both reads are in flight before the focus value answers.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(trace.calls.getWithMetadata).toEqual(['fragments:fixture'])
    const result = await pending
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.summary).toBe('live')
      expect(Object.keys(result.fragments)).toEqual([...COMPOSED_FRAGMENT_IDS])
      expect(result.fragmentsAgeMs).toBe(60_000)
      expect(result.focusAgeMs).toBe(10_000)
    }
  })

  // covers: dashboard-ssr#The focus value decides before any artifact byte is read
  it('reads focus with the 30 s cache bound and the fragments of its own build', async () => {
    const trace = traced(VISIBLE)
    await read(trace, {build: 'abc123', ...{}})
    expect(trace.calls.get).toEqual([{key: 'focus', options: {type: 'text', cacheTtl: FOCUS_CACHE_TTL_S}}])
    expect(FOCUS_CACHE_TTL_S).toBe(30)
    expect(trace.calls.getWithMetadata).toEqual(['fragments:abc123'])
  })
})

describe('invariant 2: the gate wins', () => {
  it('serves the gate value-free fragments the backend published under a visible value, as suppressed', async () => {
    const gate = JSON.stringify({...JSON.parse(VALUE) as object, summary: 'suppressed'})
    const result = await read(traced(VISIBLE, gate, {...METADATA, summary: 'suppressed'}))
    expect(result).toMatchObject({kind: 'ok', summary: 'suppressed'})
  })
})

describe('invariant 3: hiding never touches the fragment bytes', () => {
  // covers: dashboard-ssr#The focus value decides before any artifact byte is read
  it.each(HIDING_FOCUS_MODES)('a %s focus answers hiding and never reads the value', async (mode) => {
    const trace = traced(publishedFocusValue({currentFocus: mode, publishedAt: new Date(NOW).toISOString()}))
    const result = await read(trace)
    expect(result).toMatchObject({kind: 'hiding', currentFocus: mode, timing: {fragmentsMs: null}})
    // Let the fragments read settle: nothing reads its value afterwards either.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(trace.valueReads).toBe(0)
  })
})

describe('invariant 4: an unreadable focus fails closed, and the fragments are not read', () => {
  // covers: dashboard-ssr#The focus value decides before any artifact byte is read
  it.each([
    ['focus-missing', null],
    ['focus-shape', 'not json'],
    ['focus-shape', JSON.stringify({currentFocus: 'None'})],
    ['focus-shape', JSON.stringify({currentFocus: 'None', publishedAt: 'yesterday'})],
    ['focus-stale', publishedFocusValue({currentFocus: 'None', publishedAt: new Date(NOW - 690_001).toISOString()})],
    ['focus-future', publishedFocusValue({currentFocus: 'None', publishedAt: new Date(NOW + 300_001).toISOString()})],
    ['focus-error', new Error('kv down')]
  ] as [string, string | null | Error][])('%s', async (reason, focus) => {
    const trace = traced(focus)
    const result = await read(trace)
    expect(result).toMatchObject({kind: 'focus-unreadable', reason})
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(trace.valueReads).toBe(0)
  })

  it('admits a focus value exactly 690 s old', async () => {
    const result = await read(traced(publishedFocusValue({currentFocus: 'None', publishedAt: new Date(NOW - 690_000).toISOString()})))
    expect(result.kind).toBe('ok')
  })
})

describe('invariant 5: no Cache API, no waitUntil', () => {
  // covers: dashboard-ssr#Gated page data rests only in KV, for at most 690 s
  it('never opens the Cache API on any outcome', async () => {
    const open = vi.fn()
    vi.stubGlobal('caches', {open, default: {match: open, put: open}})
    try {
      for (const focus of [VISIBLE, null, publishedFocusValue({currentFocus: 'Work', publishedAt: new Date(NOW).toISOString()})]) {
        await read(traced(focus))
      }
      expect(open).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('takes no waitUntil and opens no cache anywhere on the published answer', () => {
    for (const file of ['composed/published.ts', 'data-plane/ssr-response.ts', 'data-plane/request.ts', 'data-plane/published-seam.ts']) {
      const source = readFileSync(new URL(`../../src/lib/${file}`, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/waitUntil\(|caches\./)
    }
  })
})

describe('each closed-set fragments reason', () => {
  const parsed = JSON.parse(VALUE) as {fragments: Record<string, string>; facts: WireFacts; summary: string}
  const variant = (change: (value: typeof parsed) => void) => {
    const copy = JSON.parse(VALUE) as typeof parsed
    change(copy)
    return JSON.stringify(copy)
  }
  // covers: dashboard-ssr#The Worker splices only fragments its own build's composer published, checked by that composer
  it.each([
    ['fragments-missing', null, METADATA],
    ['fragments-shape', VALUE, null],
    ['fragments-shape', VALUE, {build: 'fixture'}],
    ['fragments-build', VALUE, {...METADATA, build: 'other'}],
    ['fragments-shape', VALUE, {...METADATA, composedAt: 'soon'}],
    ['fragments-stale', VALUE, {...METADATA, composedAt: new Date(NOW - 690_001).toISOString()}],
    ['fragments-future', VALUE, {...METADATA, composedAt: new Date(NOW + 300_001).toISOString()}],
    ['fragments-shape', '{not json', METADATA],
    ['fragments-shape', variant((v) => delete v.fragments.cardHR), METADATA],
    ['fragments-shape', variant((v) => delete (v.facts.scopes as Record<string, unknown>).cardHR), METADATA],
    ['fragments-shape', variant((v) => (v.summary = 'great')), METADATA],
    ['fragments-shape', VALUE, {...METADATA, summary: 'stale'}],
    ['shell-misfit', variant((v) => v.facts.ids.push('identityName')), METADATA],
    ['shell-misfit', variant((v) => v.facts.scopes.cardHR.push('data-astro-cid-borrowed')), METADATA]
  ] as [string, string | null, unknown][])('%s', async (reason, value, metadata) => {
    const result = await read(traced(VISIBLE, value, metadata))
    expect(result).toMatchObject({kind: 'refused', reason})
  })

  it('fragments-build for a Worker without a build id, even when the metadata says the same', async () => {
    const result = await read(traced(VISIBLE, VALUE, {...METADATA, build: 'unknown'}), {build: 'unknown'})
    expect(result).toMatchObject({kind: 'refused', reason: 'fragments-build'})
  })

  it('fragments-error when the fragments read throws', async () => {
    const store = traced(VISIBLE).store
    const failing: PageStore = {get: store.get, getWithMetadata: () => Promise.reject(new Error('kv down'))}
    expect(await readPublished({store: failing, nowMs: NOW, build: 'fixture', shell: SHELL, hidingModes: HIDING})).toMatchObject({
      kind: 'refused',
      reason: 'fragments-error'
    })
  })

  // covers: dashboard-ssr#The Worker splices only fragments its own build's composer published, checked by that composer
  it('caps the value at 512 KiB in UTF-8 bytes: one byte over is refused before it is parsed', async () => {
    const bytes = (text: string) => new TextEncoder().encode(text).byteLength
    const padded = (pad: string) => `${VALUE.slice(0, -1)},"pad":"${pad}"}`
    const room = PUBLISHED_MAX_BYTES - bytes(padded(''))
    const parse = vi.spyOn(JSON, 'parse')
    const over = padded('x'.repeat(room + 1))
    expect(bytes(over)).toBe(PUBLISHED_MAX_BYTES + 1)
    parse.mockClear()
    expect(await read(traced(VISIBLE, over))).toMatchObject({kind: 'refused', reason: 'fragments-oversize'})
    // Only the focus value was parsed.
    expect(parse).toHaveBeenCalledTimes(1)
    // Multi-byte text under the cap in characters and over it in bytes is refused too.
    const euros = padded('\u20ac'.repeat(Math.floor(room / 3) + 1))
    expect(euros.length).toBeLessThan(PUBLISHED_MAX_BYTES)
    expect(bytes(euros)).toBeGreaterThan(PUBLISHED_MAX_BYTES)
    expect(await read(traced(VISIBLE, euros))).toMatchObject({kind: 'refused', reason: 'fragments-oversize'})
    // At the cap exactly, it is read.
    const at = padded('x'.repeat(room))
    expect(bytes(at)).toBe(PUBLISHED_MAX_BYTES)
    expect((await read(traced(VISIBLE, at))).kind).toBe('ok')
  })
})
