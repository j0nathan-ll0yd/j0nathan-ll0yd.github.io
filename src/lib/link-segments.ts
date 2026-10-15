import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'

export type Segment = {text: string; href?: string}

const escaped = SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A site URL runs to the next whitespace. Trailing sentence punctuation is not part of it.
const SITE_URL_PATTERN = new RegExp(`${escaped}(?:/\\S*)?`, 'g')

/**
 * Split copy prose into text and link segments, so a site URL the copy names becomes a
 * link without the page restating it. Only SITE_URL addresses are linked: the copy is the
 * one source of the URL, and an external host in prose stays text.
 */
export function linkSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of text.matchAll(SITE_URL_PATTERN)) {
    const href = match[0].replace(/[.,;:!?)]+$/, '')
    const start = match.index
    if (start > last) {
      segments.push({text: text.slice(last, start)})
    }
    segments.push({text: href, href})
    last = start + href.length
  }
  if (last < text.length) {
    segments.push({text: text.slice(last)})
  }
  return segments
}
