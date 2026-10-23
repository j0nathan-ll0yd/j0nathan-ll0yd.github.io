// The page data the backend publishes to Workers KV for `/` (atlas decision 0164, Variant D): the
// data contract between the LP runner and this Worker.
//
// - `focus`: the focus state, written by LP `focus.post.ts` before it returns and rewritten by
//   `ReconcileFocusGate` every 5 minutes when it differs or is older than 300 s.
// - `fragments:<build>`: the fragments this build's composer rendered and checked, with the facts its
//   check produced (./artifact.ts `WireFacts`) and the summary, written by the ComposeDashboard runner
//   after its composer run. While the focus value hides, the gate is shut or the signal is
//   unreadable, the runner writes that state's value-free fragments to the same key (decision D1), so
//   no gated bytes rest in KV while hiding.
//
// Both keys expire after PUBLISHED_TTL_S. The Worker judges `focus` first and never reads the
// fragments' bytes before that verdict. The composer exports `publishedEntry`, so the runner writes
// exactly the shape this module defines.
import type {SsrSummary} from '../data-plane/render-model'
import {COMPOSED_MAX_AGE_MS, type ComposedFragmentId, type WireFacts} from './artifact'

/** The KV key of the focus state. */
export const PUBLISHED_FOCUS_KEY = 'focus'

/** The KV key of build `build`'s fragments. A preview never finds its build's key. */
export function publishedFragmentsKey(build: string): string {
  return `fragments:${build}`
}

/** Both keys' TTL, in seconds: the composed artifact's age bound (690 s). */
export const PUBLISHED_TTL_S = COMPOSED_MAX_AGE_MS / 1000

/** The largest fragments value the Worker reads: 512 KiB. */
export const PUBLISHED_MAX_BYTES = 512 * 1024

/** KV's limit on a key's metadata, serialized. */
export const PUBLISHED_METADATA_MAX_BYTES = 1024

/** The `focus` value. */
export interface PublishedFocus {
  currentFocus: string
  publishedAt: string
}

/** The `fragments:<build>` value. */
export interface PublishedFragments {
  fragments: Record<ComposedFragmentId, string>
  facts: WireFacts
  summary: SsrSummary
}

/** The `fragments:<build>` metadata: what the Worker checks before it parses the value. */
export interface PublishedMetadata {
  build: string
  composedAt: string
  summary: SsrSummary
}

/** One `fragments:<build>` entry, as the runner writes it. */
export interface PublishedEntry {
  key: string
  value: string
  metadata: PublishedMetadata
}

/**
 * The `fragments:<build>` entry for one composition (a composed artifact, or a value-free page) of
 * build `build`, composed at `composedAt` (ISO 8601). Only the three published fields are kept.
 */
export function publishedEntry(source: PublishedFragments, build: string, composedAt: string): PublishedEntry {
  const value: PublishedFragments = {fragments: source.fragments, facts: source.facts, summary: source.summary}
  const metadata: PublishedMetadata = {build, composedAt, summary: source.summary}
  if (JSON.stringify(metadata).length > PUBLISHED_METADATA_MAX_BYTES) {
    throw new Error('the fragments metadata is over the KV metadata limit')
  }
  return {key: publishedFragmentsKey(build), value: JSON.stringify(value), metadata}
}

/** The `focus` value. */
export function publishedFocusValue(focus: PublishedFocus): string {
  return JSON.stringify({currentFocus: focus.currentFocus, publishedAt: focus.publishedAt})
}
