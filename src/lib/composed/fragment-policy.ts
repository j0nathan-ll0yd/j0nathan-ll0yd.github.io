// The Worker-side guarantee on a composed fragment (atlas decision 0160, PR B; review 2026-10-16, H1).
//
// The artifact is not authenticated: any writer of the data-plane bucket can replace it. So the
// Worker splices a fragment into the apex page only when the fragment is markup the design system's
// own components could have rendered. A strict tokenizer reads each fragment once, as a browser would
// read it, and admits only:
//
// - well-formed elements from an ALLOWLIST (HTML_ELEMENTS, SVG_ELEMENTS), each with attributes from
//   an allowlist, every value double-quoted, no element the HTML parser would reparent, at most
//   MAX_DEPTH deep;
// - class tokens from FRAGMENT_CLASS_TOKENS, per fragment: the page CSS styles some classes as fixed
//   full-viewport layers or fixed badges, so a class is not inert, and one card may not borrow another
//   component's class;
// - at most MAX_ATTRIBUTES attributes and one scoped-style hash per element, `aria-*` from a closed set;
// - `data-*` values in the grammar of what the client runtime parses from them (DATA_GRAMMAR):
//   `data-book` feeds the Book modal's `innerHTML`, so it is a closed schema, not text;
// - text, and character references;
// - exactly one `div` root whose `id` is the fragment's id, with no `style` or `popover` (the overlay
//   roots may show only in a value-free page), plus, for a card that emits one, its hidden data
//   carrier (`#<id>Data[hidden]`, empty).
//
// Everything else is refused: comments, doctypes, processing instructions, raw-text elements
// (`script`, `style`, `textarea`, `plaintext`, `noscript`, `iframe`, `template`), `form`, `object`,
// `embed`, `link`, `meta`, `base`, any `on*` or unknown attribute, a URL that is not a first-party
// path or an allowlisted https host (an encoded dot, slash or backslash included; the one exception is
// the Reading card's article link, ARTICLE_LINK below, and the Bookshelf tile link, BOOK_LINK), a `style`
// attribute outside the declaration grammar below, and `popover` anywhere but System Status's tooltip
// (the UA styles `[popover]` as a fixed full-viewport layer, shown by any author `display`).
//
// The allowlists are what the composer emits, walked from the parity oracle's renders
// (tests/oracle/composer-parity.test.ts asserts every fresh render passes, and that every allowlisted
// element, class token, `data-*` name and link host is one the renders use). A design-system change
// that emits new markup reds that test before it can ship; in production it would answer the
// data-free page, never a partial render.
//
// The composer emits `style` attributes (bar widths, animation delays, skeleton sizes), so a
// blanket ban would refuse every artifact. A `style` value is admitted only when every declaration
// names an allowlisted property with a value in that property's grammar: no `position` but
// `relative`, no offsets beyond 0 to 100 percent, no size above MAX_PX, no `url()`, no escape, no
// `!important`.
//
// Cost: one linear pass. Every per-element check is O(1) (counters, not stack scans), and the
// caller caps the artifact size (./artifact.ts COMPOSED_MAX_BYTES).
import {CLOUDFRONT_BASE, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {isRelativeStyle} from '@j0nathan-ll0yd/web/runtime/relative-time'
import {WIDGET_STATES} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {FRAGMENT_CLASS_TOKENS, FRAGMENT_ROOT_CLASS_TOKENS} from './fragment-classes'
import {READING_LINKS} from './reading-option'

/** Why a fragment is refused. A closed set: it reaches the log line, which carries no data value. */
export type FragmentRejection =
  | 'markup'
  | 'element'
  | 'attribute'
  | 'class'
  | 'data'
  | 'url'
  | 'style'
  | 'nesting'
  | 'root'
  | 'id'
  | 'carrier'

export interface FragmentFacts {
  /** Every `id` the fragment carries, its root's included. */
  ids: string[]
  /** Every scoped-style hash the fragment carries (`data-astro-cid-<hash>`). */
  scopes: string[]
  /** The root element's class tokens and scoped-style hash: its shape, which the shell checks (`fitsShell`). */
  root: {classes: string[]; scopes: string[]}
}

export type FragmentCheck = {ok: true; facts: FragmentFacts} | {ok: false; reason: FragmentRejection}

export interface FragmentOptions {
  /**
   * The latest `data-generated-at` the fragment may name, in ms: the composition stamp plus the
   * allowed skew. A later stamp would freeze the card, because the client repaints only from a
   * strictly newer one. Null: the fragment may name none (a value-free page).
   */
  maxGeneratedAtMs: number | null
  /** True for a value-free page, where a hiding value's overlay root shows (`style="display: flex"`). */
  overlayMayShow: boolean
}

/** Cards that emit a hidden data carrier beside their root, in a data state. */
const CARRIERS: Readonly<Record<string, string>> = Object.freeze({cardHydration: 'cardHydrationData'})
/** The overlay roots: hidden unless the page is the value-free page of their hiding value. */
const OVERLAY_ROOTS: ReadonlySet<string> = new Set(['focusOverlay', 'dndOverlay'])
const OVERLAY_STYLES: ReadonlySet<string> = new Set(['display: flex', 'display: none'])

/** Attributes any allowed element may carry. `aria-*` and `data-astro-cid-*` are matched by pattern. */
const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set(['class', 'id', 'hidden', 'role', 'tabindex', 'style'])

/** A size in px above this is not one a card renders. */
const MAX_PX = 480
/** Deeper than any render (9 levels in the oracle's renders). */
export const MAX_DEPTH = 32
const MAX_TEXT_FIELD = 4_000

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const WORD = /^[a-z][a-zA-Z0-9-]{0,39}$/
const WIDGET_STATE_SET: ReadonlySet<string> = new Set(WIDGET_STATES)
const BOOK_STATUSES: ReadonlySet<string> = new Set(['pending', 'reading', 'upNext', 'finished'])
/** The one host a book's link names (Bookshelf.astro builds it). */
const BOOK_LINK_HOST = 'www.amazon.com'

/** The `data-*` attributes the components emit, each with the grammar of its value. */
const DATA_GRAMMAR: Readonly<Record<string, (value: string, options: FragmentOptions) => boolean>> = Object.freeze({
  'data-book': (value) => bookAllowed(value),
  'data-bpm': (value) => /^\d{1,3}$/.test(value),
  'data-hrv': (value) => /^\d{1,3}$/.test(value),
  'data-stroke': (value) => SVG_PAINT.test(value),
  'data-fallback': (value) => imageAllowed(value),
  'data-local-covers': (value) => jsonOf(value, (parsed) => Array.isArray(parsed) && parsed.every((path) => typeof path === 'string' && imageAllowed(path))),
  'data-hydration-fixture': (value) => jsonOf(value, (parsed) => plainData(parsed, 0)),
  'data-generated-at': (value, options) => ISO_INSTANT.test(value) && options.maxGeneratedAtMs !== null && Date.parse(value) <= options.maxGeneratedAtMs,
  // The relative label form the browser writes into a server-rendered <time> (web 4.4.0, fillRelativeTimes).
  'data-relative': (value) => isRelativeStyle(value),
  'data-ssr-state': (value) => WIDGET_STATE_SET.has(value),
  'data-state-notice': (value) => WIDGET_STATE_SET.has(value),
  'data-state-scaffold': (value) => value === '',
  'data-live-label': (value) => /^[a-z ]{0,20}$/.test(value),
  'data-mv-metric': (value) => WORD.test(value),
  'data-phase': (value) => WORD.test(value),
  'data-sa-link-event': (value) => /^[a-z_]{1,40}$/.test(value),
  'data-source': (value) => WORD.test(value)
})
export const DATA_ATTRIBUTES: ReadonlySet<string> = new Set(Object.keys(DATA_GRAMMAR))

const SVG_PRESENTATION = [
  'class',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'filter'
]

/** HTML elements, each with the attributes it may carry beyond the global ones. */
export const HTML_ELEMENTS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  a: new Set(['href', 'rel', 'target']),
  button: new Set(['type', 'popovertarget', 'popovertargetaction']),
  canvas: new Set(['width', 'height']),
  div: new Set(['popover']),
  h2: new Set<string>(),
  h3: new Set<string>(),
  img: new Set(['src', 'srcset', 'alt', 'width', 'height', 'loading', 'decoding', 'referrerpolicy']),
  li: new Set<string>(),
  p: new Set<string>(),
  picture: new Set<string>(),
  source: new Set(['srcset', 'type']),
  span: new Set(['title']),
  time: new Set(['datetime']),
  ul: new Set<string>()
})

/** SVG elements (inside `svg` only), each with its attributes. Names keep their SVG case. */
export const SVG_ELEMENTS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  svg: new Set(['xmlns', 'viewBox', 'width', 'height', 'focusable', 'preserveAspectRatio', ...SVG_PRESENTATION]),
  circle: new Set(['cx', 'cy', 'r', ...SVG_PRESENTATION]),
  line: new Set(['x1', 'x2', 'y1', 'y2', ...SVG_PRESENTATION]),
  path: new Set(['d', ...SVG_PRESENTATION]),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', ...SVG_PRESENTATION]),
  defs: new Set<string>(),
  filter: new Set<string>(),
  feGaussianBlur: new Set(['stdDeviation', 'result']),
  feMerge: new Set<string>(),
  feMergeNode: new Set(['in'])
})

const VOID_ELEMENTS: ReadonlySet<string> = new Set(['img', 'source'])
/** Elements whose start tag closes an open `p` in a browser: never inside a `p` here. */
const CLOSES_P: ReadonlySet<string> = new Set(['div', 'p', 'ul', 'h2', 'h3'])
/** Elements that hold phrasing content only: a block child would be reparented or is invalid. */
const PHRASING_ONLY: ReadonlySet<string> = new Set(['p', 'h2', 'h3', 'span', 'time', 'button'])
const PHRASING: ReadonlySet<string> = new Set(['a', 'span', 'time', 'img', 'picture', 'canvas', 'button', 'svg'])
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The https hosts a link may name: the repository and review hosts, the authored System Status links,
 * and the Barry's Bootcamp share link Workouts names for an `Other` workout (DS ACTIVITY_TYPE_MAP).
 */
export const LINK_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'share.barrys.com',
  'www.coasttocoastreviews.com',
  'coasttocoastreviews.com',
  'www.apple.com',
  'www.livelarq.com',
  'acaia.co',
  'feedly.com',
  'www.squarespace.com'
])
/**
 * The one link that may name any https host: a Reading card article title (DS ReadingFeed,
 * `articleItemHtml`). Articles come from any publisher, so no host list can hold them (owner decision
 * pending: option A admits them here; option B would strip the href on the server). The link is
 * admitted only in its exact DS shape, `a.article-list-title` in `cardReading` with
 * `target="_blank"` and `rel="noopener noreferrer"`, so no other card or element gains the rule.
 * Under READING_LINKS 'strip' (option B) the exception is off (./reading-option.ts).
 */
export const ARTICLE_LINK = Object.freeze({fragment: 'cardReading', className: 'article-list-title', target: '_blank', rel: 'noopener noreferrer'})
/**
 * The Bookshelf tile link (DS Bookshelf, web 4.6.0; atlas decision 0160 D5): the title text of each
 * tile is a real link to the book, so a visitor or crawler without JavaScript reaches it. Its href is
 * the DS `amazonBookUrl(asin)`: BOOK_LINK_HOST, the path `/dp/<BOOK_ASIN>` and the exact affiliate query
 * BOOK_LINK_QUERY. The link is admitted only in its exact DS shape, `a.shelf-book-link` in `cardBooks`
 * with `target="_blank"` and `rel="sponsored noopener noreferrer"`. The `sponsored` token stands only
 * in this shape, and BOOK_LINK_HOST never joins LINK_HOSTS, so no other card or element gains it.
 */
export const BOOK_LINK = Object.freeze({fragment: 'cardBooks', className: 'shelf-book-link', target: '_blank', rel: 'sponsored noopener noreferrer'})
/** The query string `amazonBookUrl` appends (tests/unit/composed-book-link.test.ts tethers it to the DS). */
export const BOOK_LINK_QUERY = '?tag=lifegames04-20&linkCode=ll2&language=en_US&ref_=as_li_ss_tl'
/**
 * An ASIN: exactly 10 upper-case letters or digits, as the one production writer requires
 * (mantle-LifegamesPortal `addBookRequestSchema`) and the `@j0nathan-ll0yd/fixtures` variations carry
 * since 1.6.6 (an ISBN-10, which may end in `X`, or a `B0` Amazon id).
 */
const BOOK_ASIN = '[A-Z0-9]{10}'
const BOOK_LINK_HREF = new RegExp(`^https://${BOOK_LINK_HOST.replaceAll('.', '\\.')}/dp/${BOOK_ASIN}${BOOK_LINK_QUERY.replaceAll(/[?.]/g, '\\$&')}$`)
/** Longer than any article URL the feed carries (123 characters in production, 2026-10-16). */
export const MAX_ARTICLE_HREF = 2_048
/**
 * A parsed host of two or more labels with an alphabetic or punycode last label, and an optional
 * trailing dot: no IP literal, no single-label host. `_` is admitted because publishers use it.
 */
const ARTICLE_HOST = /^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})\.?$/
/**
 * Hosts an article link may not name: the site and the data plane. An article leaves the site; a
 * first-party link stays under `hrefAllowed`, whose encoded-escape rule this exception does not apply.
 */
const FIRST_PARTY_HOST = new RegExp(
  `(?:^|\\.)(?:${[new URL(SITE_URL).hostname, new URL(CLOUDFRONT_BASE).hostname, 'workers.dev'].map((host) => host.replaceAll('.', '\\.')).join('|')})\\.?$`
)
/** True when `href` holds a C0 control (tab and newline among them), DEL or a backslash. */
function hasRefusedHrefCharacter(href: string): boolean {
  for (let index = 0; index < href.length; index++) {
    const code = href.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f || code === 0x5c) {
      return true
    }
  }
  return false
}
/**
 * A `title` value: escaped text (no raw angle bracket), at most this long. The DS joins every note
 * on an article into one title and caps none, so the bound sits far above a real note; the artifact
 * cap (COMPOSED_MAX_BYTES) bounds the whole page.
 */
export const MAX_TITLE = 16_384
/** The one off-origin image host: the data plane's `/images/` (the CSP's img-src names it too). */
const IMAGE_ORIGIN = new URL(CLOUDFRONT_BASE).origin

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/
const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/
const SCOPE_ATTRIBUTE = /^data-astro-cid-[a-z0-9]+$/
/** The `aria-*` attributes the components emit: a closed set, so no element carries an unbounded list. */
export const ARIA_ATTRIBUTES: ReadonlySet<string> = new Set(['aria-details', 'aria-hidden', 'aria-label', 'aria-live'])
/** More attributes than any rendered element carries (about ten): the duplicate check stays O(1) per attribute. */
export const MAX_ATTRIBUTES = 24
/** The one element that carries `popover`: System Status's tooltip (`div.sys-tooltip` in `cardSystem`). */
const POPOVER_FRAGMENT = 'cardSystem'
const POPOVER_CLASS = 'sys-tooltip'
/** A same-origin path: one leading slash, no backslash, no scheme, no whitespace or control. */
const SAME_ORIGIN_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/
/** A percent-encoded dot, slash or backslash: a URL parser resolves it into a dot segment or a new path. */
const ENCODED_PATH_ESCAPE = /%(?:2e|2f|5c)/i
const IMAGE_PATH = /^\/images\/[A-Za-z0-9\-._~%/]+$/
const SVG_PATH_DATA = /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]*$/
const SVG_NUMBER_LIST = /^[0-9.\s-]*$/
const SVG_PAINT =
  /^(?:none|currentColor|transparent|#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\)|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/
const SIZE_ATTRIBUTE = /^\d{1,3}(?:\.\d+)?%?$/

/** Fixed attribute values. */
const FIXED_VALUES: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  target: new Set(['_blank']),
  loading: new Set(['lazy']),
  decoding: new Set(['async']),
  referrerpolicy: new Set(['no-referrer']),
  type: new Set(['button', 'image/avif', 'image/webp']),
  popovertargetaction: new Set(['toggle']),
  popover: new Set(['', 'auto', 'manual']),
  tabindex: new Set(['0', '-1']),
  focusable: new Set(['false']),
  preserveAspectRatio: new Set(['none']),
  xmlns: new Set([SVG_NS])
})

// The style declaration grammar. Each property names the one shape its value may take.
const NUM = String.raw`\d+(?:\.\d+)?`
const PX = `(?:0|${NUM}px)`
const PCT = `${NUM}%`
const COLOR = String.raw`(?:#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\)|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)|transparent)`
const MIX = String.raw`color-mix\(in srgb,\s*${COLOR}\s+${PCT},\s*${COLOR}\)`
const exact = (source: string) => new RegExp(`^(?:${source})$`)
const STYLE_GRAMMAR: Readonly<Record<string, RegExp>> = Object.freeze({
  width: exact(`${PX}|${PCT}`),
  height: exact(`${PX}|${PCT}`),
  'min-height': exact(PX),
  left: exact(PCT),
  bottom: exact(PCT),
  'margin-top': exact(PX),
  'margin-bottom': exact(PX),
  'padding-top': exact(PX),
  padding: exact(`${PX}(?:\\s+${PX}){0,3}`),
  gap: exact(PX),
  'border-radius': exact(`${PX}|${PCT}`),
  'animation-delay': exact(`${NUM}s`),
  position: exact('relative'),
  display: exact('flex|grid|none|block'),
  'justify-content': exact('space-between|space-around|flex-start|flex-end|center'),
  'align-items': exact('center|baseline|flex-start|flex-end'),
  'flex-direction': exact('column|row'),
  'flex-wrap': exact('wrap|nowrap'),
  flex: exact('\\d+'),
  overflow: exact('hidden'),
  opacity: exact('0|1|0?\\.\\d+'),
  color: exact(COLOR),
  'border-color': exact(COLOR),
  background: exact(`${COLOR}|${MIX}`),
  border: exact(`1px solid ${COLOR}`),
  'border-top': exact(`1px solid ${COLOR}`),
  'text-shadow': exact(`0 0 ${PX} ${COLOR}(?:,\\s*0 0 ${PX} ${COLOR})*`),
  'grid-template-columns': exact(`${PX} 1fr`),
  'clip-path': exact(`inset\\(${PCT} 0 0 0\\)`)
})

const NAMED_REFERENCES: Readonly<Record<string, string>> = Object.freeze({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"})

/** An attribute value with its character references decoded, or null when one is not a plain reference. */
function decode(value: string): string | null {
  let failed = false
  const out = value.replace(/&([^;\s&]*);?/g, (match, body: string) => {
    if (!match.endsWith(';')) {
      failed = true
      return ''
    }
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = /^#[xX][0-9a-fA-F]{1,6}$/.test(body) ? Number.parseInt(body.slice(2), 16) : Number.NaN
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ((failed = true), '')
    }
    if (body.startsWith('#')) {
      const code = /^#\d{1,7}$/.test(body) ? Number.parseInt(body.slice(1), 10) : Number.NaN
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ((failed = true), '')
    }
    const named = NAMED_REFERENCES[body]
    return named ?? ((failed = true), '')
  })
  return failed ? null : out
}

function jsonOf(value: string, test: (parsed: unknown) => boolean): boolean {
  try {
    return test(JSON.parse(value))
  } catch {
    return false
  }
}

/** Plain data: numbers, booleans, null, short words, and objects or arrays of them, a few levels deep. */
function plainData(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return true
  }
  if (typeof value === 'string') {
    return /^[A-Za-z0-9 .:_%+-]{0,64}$/.test(value)
  }
  if (depth >= 4 || typeof value !== 'object') {
    return false
  }
  return Array.isArray(value) ? value.every((item) => plainData(item, depth + 1)) : Object.values(value).every((item) => plainData(item, depth + 1))
}

const BOOK_TEXT = ['title', 'author', 'asin', 'notes', 'finishedAt', 'startedAt', 'series', 'publicationDate', 'desc']
const BOOK_NUMBERS: Readonly<Record<string, [number, number]>> = Object.freeze({
  rating: [0, 5],
  progress: [0, 100],
  seriesNumber: [0, 1_000],
  seriesTotal: [0, 1_000],
  pages: [0, 100_000],
  year: [-5_000, 9_999]
})
const BOOK_KEYS: ReadonlySet<string> = new Set([
  ...BOOK_TEXT,
  ...Object.keys(BOOK_NUMBERS),
  'status',
  'statusLabel',
  'link',
  'genres',
  'mainImage',
  'mainImageAvif'
])

/**
 * A book's `data-book` JSON, in the closed shape Bookshelf.astro writes. The Book modal writes several
 * fields into `innerHTML` unescaped (`pages`, `year`, `status`, `statusLabel`, `seriesNumber`,
 * `seriesTotal`, `progress`), so each of those is a number or a closed word here; the escaped text
 * fields may hold any text.
 */
function bookAllowed(value: string): boolean {
  return jsonOf(value, (parsed) => {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false
    }
    const book = parsed as Record<string, unknown>
    for (const [key, field] of Object.entries(book)) {
      if (!BOOK_KEYS.has(key)) {
        return false
      }
      if (field === null || field === undefined) {
        continue
      }
      const range = BOOK_NUMBERS[key]
      if (range !== undefined) {
        if (typeof field !== 'number' || !Number.isFinite(field) || field < range[0] || field > range[1]) {
          return false
        }
      } else if (BOOK_TEXT.includes(key)) {
        if (typeof field !== 'string' || field.length > MAX_TEXT_FIELD) {
          return false
        }
      } else if (key === 'status') {
        if (typeof field !== 'string' || !BOOK_STATUSES.has(field)) {
          return false
        }
      } else if (key === 'statusLabel') {
        if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z ]{0,30}$/.test(field)) {
          return false
        }
      } else if (key === 'link') {
        if (typeof field !== 'string' || !httpsUrlAllowed(field, new Set([BOOK_LINK_HOST]))) {
          return false
        }
      } else if (key === 'genres') {
        if (!Array.isArray(field) || field.length > 20 || !field.every((genre) => typeof genre === 'string' && genre.length <= 200)) {
          return false
        }
      } else if (typeof field !== 'string' || !imageAllowed(field)) {
        // mainImage, mainImageAvif
        return false
      }
    }
    return true
  })
}

function sizeWithinBounds(value: string): boolean {
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(px|%)/g)) {
    const amount = Number(match[1])
    if ((match[2] === 'px' && amount > MAX_PX) || (match[2] === '%' && amount > 100)) {
      return false
    }
  }
  return true
}

/** True when every declaration of a decoded `style` value is in the grammar. */
export function styleAllowed(style: string): boolean {
  if (/[\\@<>{}]|\/\*|!/.test(style)) {
    return false
  }
  for (const declaration of style.split(';')) {
    if (declaration.trim() === '') {
      continue
    }
    const colon = declaration.indexOf(':')
    if (colon < 0) {
      return false
    }
    const grammar = STYLE_GRAMMAR[declaration.slice(0, colon).trim()]
    const value = declaration.slice(colon + 1).trim()
    if (grammar === undefined || !grammar.test(value) || !sizeWithinBounds(value)) {
      return false
    }
  }
  return true
}

function httpsUrlAllowed(href: string, hosts: ReadonlySet<string>): boolean {
  if (!/^https:\/\/[a-z0-9.-]+(?:[/?#][\x21-\x7e]*)?$/.test(href) || href.includes('\\') || ENCODED_PATH_ESCAPE.test(href)) {
    return false
  }
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && hosts.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * HTML splits a token list (`rel`) and a `srcset` on ASCII whitespace only. JavaScript's `\s` also
 * matches U+00A0, U+000B, U+FEFF and the Unicode spaces, so a value the policy split with `\s` could
 * hold a token the browser never sees. A value with such a character is refused outright.
 */
const ASCII_WHITESPACE = /[\t\n\f\r ]+/
const NON_ASCII_WHITESPACE = /(?![\t\n\f\r ])\s/

/** True for a Bookshelf tile link's href: exactly what `amazonBookUrl` builds for a BOOK_ASIN. */
export function bookHrefAllowed(href: string): boolean {
  return BOOK_LINK_HREF.test(href) && httpsUrlAllowed(href, new Set([BOOK_LINK_HOST]))
}

/** True for a link this page may carry: a same-origin path, or https to an allowlisted host. */
export function hrefAllowed(href: string): boolean {
  if (SAME_ORIGIN_PATH.test(href)) {
    return !ENCODED_PATH_ESCAPE.test(href)
  }
  return httpsUrlAllowed(href, LINK_HOSTS)
}

/**
 * True for an article link's href: what the DS emits for any https article URL (`safeHttpsUrl` passes
 * the feed's string through unchanged), so the policy admits the forms a publisher really uses (an
 * upper-case host, `:443`, non-ASCII or a space in the path, `_` in a label, an IDN TLD). It must start
 * `https://` in any case (no other scheme, no protocol-relative form), hold no control character or
 * backslash (the browser's parser would strip or reinterpret them), parse as https with no userinfo
 * and the default port, name a DNS host that is not first-party, and be at most MAX_ARTICLE_HREF
 * long. An encoded dot, slash or backslash is not refused, unlike `hrefAllowed`: that rule keeps a
 * first-party path off a gated route, and this link names no first-party host.
 */
export function articleHrefAllowed(href: string): boolean {
  if (href.length > MAX_ARTICLE_HREF || !/^https:\/\//i.test(href) || hasRefusedHrefCharacter(href)) {
    return false
  }
  try {
    const url = new URL(href)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      ARTICLE_HOST.test(url.hostname) &&
      !FIRST_PARTY_HOST.test(url.hostname)
    )
  } catch {
    return false
  }
}

/** True for an image source: a same-origin `/images/` path, or the data plane's `/images/`. */
export function imageAllowed(src: string): boolean {
  const path = src.startsWith(`${IMAGE_ORIGIN}/`) ? src.slice(IMAGE_ORIGIN.length) : src
  return IMAGE_PATH.test(path) && !path.includes('..') && !path.includes('//') && !ENCODED_PATH_ESCAPE.test(path)
}

function srcsetAllowed(srcset: string): boolean {
  if (NON_ASCII_WHITESPACE.test(srcset)) {
    return false
  }
  return srcset.split(',').every((candidate) => {
    const [url, descriptor, extra] = candidate.trim().split(/\s+/)
    return url !== undefined && extra === undefined && imageAllowed(url) && (descriptor === undefined || /^\d+(?:\.\d+)?[wx]$/.test(descriptor))
  })
}

function sizeAttributeAllowed(value: string): boolean {
  return SIZE_ATTRIBUTE.test(value) && Number.parseFloat(value) <= (value.endsWith('%') ? 100 : MAX_PX)
}

/** Attributes whose decoded value is checked below; every other allowed value is inert text. */
const VALUE_CHECKED: ReadonlySet<string> = new Set([
  'id',
  'class',
  'href',
  'src',
  'srcset',
  'style',
  'rel',
  'd',
  'viewBox',
  'filter',
  'fill',
  'stroke',
  'width',
  'height',
  'datetime',
  'role',
  'title'
])

/** The href exceptions an attribute raised, judged once the whole tag is read. */
type DeferredHref = {book: boolean; article: boolean}

type LinkShape = Readonly<{fragment: string; className: string; target: string; rel: string}>

/** True when a tag is the exact DS shape of an exception link: its element, card, class, rel and target. */
function linkShaped(shape: LinkShape, name: string, id: string, classValue: string | null, relValue: string | null, targetValue: string | null): boolean {
  return name === 'a' && id === shape.fragment && classValue === shape.className && relValue === shape.rel && targetValue === shape.target
}

function checkAttribute(
  element: string,
  svg: boolean,
  name: string,
  raw: string | null,
  facts: FragmentFacts,
  options: FragmentOptions,
  classTokens: ReadonlySet<string>,
  deferred: DeferredHref
): FragmentRejection | null {
  if (SCOPE_ATTRIBUTE.test(name)) {
    if (raw !== null && raw !== '') {
      return 'attribute'
    }
    facts.scopes.push(name)
    return null
  }
  const dataGrammar = svg ? undefined : DATA_GRAMMAR[name]
  const allowed = svg
    ? SVG_ELEMENTS[element]?.has(name) || name === 'id' || name === 'role' || ARIA_ATTRIBUTES.has(name)
    : GLOBAL_ATTRIBUTES.has(name) || ARIA_ATTRIBUTES.has(name) || dataGrammar !== undefined || HTML_ELEMENTS[element]?.has(name) === true
  if (!allowed) {
    return 'attribute'
  }
  const fixed = FIXED_VALUES[name]
  if (fixed === undefined && dataGrammar === undefined && !VALUE_CHECKED.has(name)) {
    // An inert value: an attribute that names no URL, style, class or script and that no runtime
    // parses (`alt`, `aria-*`, `stroke-width` and the like). It may hold a raw `<` (Astro escapes
    // only `&` and `"` in a value); no allowlisted element reads its content as raw text, so a
    // browser never reads markup inside a quoted value.
    return null
  }
  const value = raw === null ? '' : raw.includes('&') ? decode(raw) : raw
  if (value === null) {
    return 'attribute'
  }
  if (fixed !== undefined && !fixed.has(value)) {
    return 'attribute'
  }
  if (dataGrammar !== undefined) {
    return dataGrammar(value, options) ? null : 'data'
  }
  switch (name) {
    case 'id':
      if (!ID.test(value)) {
        return 'id'
      }
      facts.ids.push(value)
      return null
    case 'class':
      return value.split(/[ \t\n]+/).every((token) => token === '' || classTokens.has(token)) ? null : 'class'
    case 'href':
      if (hrefAllowed(value)) {
        return null
      }
      // Not a first-party or allowlisted link: admitted only as a book link or an article link, judged
      // once the whole tag is read (its class, rel and target may follow the href).
      deferred.book = bookHrefAllowed(value)
      deferred.article = READING_LINKS === 'allow' && articleHrefAllowed(value)
      return deferred.book || deferred.article ? null : 'url'
    case 'src':
      return imageAllowed(value) ? null : 'url'
    case 'srcset':
      return srcsetAllowed(value) ? null : 'url'
    case 'style':
      return styleAllowed(value) ? null : 'style'
    case 'rel':
      // The tag-level checks (noopener, `sponsored`, the link shapes) read the raw value, so a
      // character reference, which no component writes here, would hide a token from them.
      if ((raw !== null && raw.includes('&')) || NON_ASCII_WHITESPACE.test(value)) {
        return 'attribute'
      }
      // `sponsored` is judged once the whole tag is read: it stands only in the book link's shape.
      return value.split(ASCII_WHITESPACE).every((token) => token === 'noopener' || token === 'noreferrer' || token === 'sponsored') ? null : 'attribute'
    case 'role':
      return /^[a-z]{1,20}$/.test(value) ? null : 'attribute'
    case 'title':
      return raw !== null && !/[<>]/.test(raw) && value.length <= MAX_TITLE ? null : 'attribute'
    case 'datetime':
      return /^[0-9T:.Z+-]{4,30}$/.test(value) ? null : 'attribute'
    case 'width':
    case 'height':
      return sizeAttributeAllowed(value) ? null : 'attribute'
    case 'd':
      return SVG_PATH_DATA.test(value) ? null : 'attribute'
    case 'viewBox':
      return SVG_NUMBER_LIST.test(value) ? null : 'attribute'
    case 'filter':
      return /^url\(#[A-Za-z][A-Za-z0-9_-]*\)$/.test(value) || value === '' ? null : 'url'
    case 'fill':
    case 'stroke':
      return SVG_PAINT.test(value) ? null : 'attribute'
    default:
      return null
  }
}

interface OpenElement {
  name: string
  svg: boolean
}

/** How many open elements of each kind the nesting rules ask about: O(1) per check. */
interface OpenCounts {
  p: number
  interactive: number
  heading: number
}

/** True when `name` may open here without a browser reparenting it. */
function nestingAllowed(name: string, svg: boolean, parent: OpenElement | undefined, open: OpenCounts): boolean {
  if (svg) {
    return parent !== undefined && (parent.svg || name === 'svg')
  }
  if (CLOSES_P.has(name) && open.p > 0) {
    return false
  }
  if (parent !== undefined && PHRASING_ONLY.has(parent.name) && !PHRASING.has(name)) {
    return false
  }
  if ((name === 'a' || name === 'button') && open.interactive > 0) {
    return false
  }
  if ((name === 'h2' || name === 'h3') && open.heading > 0) {
    return false
  }
  if (name === 'li' && parent?.name !== 'ul') {
    return false
  }
  if (name === 'source' && parent?.name !== 'picture') {
    return false
  }
  return true
}

function count(open: OpenCounts, name: string, by: 1 | -1): void {
  if (name === 'p') {
    open.p += by
  } else if (name === 'a' || name === 'button') {
    open.interactive += by
  } else if (name === 'h2' || name === 'h3') {
    open.heading += by
  }
}

function rootClassesAllowed(id: string, classValue: string | null): boolean {
  const allowed: ReadonlySet<string> = Object.hasOwn(FRAGMENT_ROOT_CLASS_TOKENS, id)
    ? FRAGMENT_ROOT_CLASS_TOKENS[id as keyof typeof FRAGMENT_ROOT_CLASS_TOKENS]
    : new Set()
  return (classValue ?? '').split(/[ \t\n]+/).every((token) => token === '' || allowed.has(token))
}

interface TopLevel {
  name: string
  id: string | null
  hidden: boolean
  empty: boolean
  attributes: readonly string[]
}

/** The only attributes a data carrier holds: it is an empty hidden element with one data value. */
const CARRIER_ATTRIBUTES: ReadonlySet<string> = new Set(['id', 'hidden', 'data-hydration-fixture'])

const NON_SPACE = /[^ \t\n\r\f]/
const START_TAG = /<([A-Za-z][A-Za-z0-9]*)/y
const END_TAG = /<\/([A-Za-z][A-Za-z0-9]*)>/y
/** One attribute: whitespace, a name, and optionally `="value"` (double quotes only). */
const ATTRIBUTE = /[ \t\n]+([^\s"'<>/=]+)(?:="([^"]*)")?/y
const TAG_END = /[ \t\n]*(\/?)>/y

/**
 * Checks one fragment against the allowlist. `id` is the element it replaces. The tokenizer is
 * stricter than a browser: whatever it admits, a browser reads as the same tree.
 */
export function checkFragment(fragment: string, id: string, options: FragmentOptions): FragmentCheck {
  // Only a known fragment has class tokens of its own; any other id is refused at its root.
  const classTokens: ReadonlySet<string> = Object.hasOwn(FRAGMENT_CLASS_TOKENS, id)
    ? FRAGMENT_CLASS_TOKENS[id as keyof typeof FRAGMENT_CLASS_TOKENS]
    : new Set()
  const facts: FragmentFacts = {ids: [], scopes: [], root: {classes: [], scopes: []}}
  const stack: OpenElement[] = []
  const open: OpenCounts = {p: 0, interactive: 0, heading: 0}
  const top: TopLevel[] = []
  let pos = 0
  while (pos < fragment.length) {
    const lt = fragment.indexOf('<', pos)
    const text = fragment.slice(pos, lt < 0 ? fragment.length : lt)
    if (text.includes('\u0000')) {
      return {ok: false, reason: 'markup'}
    }
    if (NON_SPACE.test(text)) {
      const current = top.at(-1)
      if (stack.length === 0 || current === undefined) {
        return {ok: false, reason: 'root'}
      }
      current.empty = false
    }
    if (lt < 0) {
      break
    }
    END_TAG.lastIndex = lt
    const end = END_TAG.exec(fragment)
    if (end !== null) {
      const closed = stack.pop()
      if (closed === undefined || closed.name !== end[1]) {
        return {ok: false, reason: 'nesting'}
      }
      count(open, closed.name, -1)
      pos = END_TAG.lastIndex
      continue
    }
    START_TAG.lastIndex = lt
    const start = START_TAG.exec(fragment)
    const name = start?.[1]
    if (name === undefined) {
      // A comment, a doctype, a processing instruction, a stray `<` or a malformed end tag.
      return {ok: false, reason: 'markup'}
    }
    const parent = stack.at(-1)
    const svg = name === 'svg' || parent?.svg === true
    if (!(svg ? Object.hasOwn(SVG_ELEMENTS, name) : Object.hasOwn(HTML_ELEMENTS, name))) {
      return {ok: false, reason: 'element'}
    }
    const isRoot = stack.length === 0
    if (isRoot ? name !== 'div' : !nestingAllowed(name, svg, parent, open)) {
      return {ok: false, reason: isRoot ? 'root' : 'nesting'}
    }
    if (stack.length >= MAX_DEPTH) {
      return {ok: false, reason: 'nesting'}
    }
    let cursor = START_TAG.lastIndex
    const seen = new Set<string>()
    let scopes = 0
    let ownId: string | null = null
    let hidden = false
    let noopener = false
    let style: string | null = null
    let classValue: string | null = null
    let relValue: string | null = null
    let targetValue: string | null = null
    const deferred: DeferredHref = {book: false, article: false}
    for (;;) {
      ATTRIBUTE.lastIndex = cursor
      const attr = ATTRIBUTE.exec(fragment)
      const attrName = attr?.[1]
      if (attr === null || attrName === undefined) {
        break
      }
      const key = attrName.toLowerCase()
      if (!ATTRIBUTE_NAME.test(attrName) || seen.has(key) || seen.size >= MAX_ATTRIBUTES) {
        return {ok: false, reason: 'attribute'}
      }
      seen.add(key)
      // A component carries one scoped-style hash per element (its own).
      if (SCOPE_ATTRIBUTE.test(attrName) && ++scopes > 1) {
        return {ok: false, reason: 'attribute'}
      }
      const idsBefore = facts.ids.length
      const rejection = checkAttribute(name, svg, attrName, attr[2] ?? null, facts, options, classTokens, deferred)
      if (rejection !== null) {
        return {ok: false, reason: rejection}
      }
      if (facts.ids.length > idsBefore) {
        ownId = facts.ids.at(-1) ?? null
      }
      hidden ||= attrName === 'hidden'
      noopener ||= attrName === 'rel' && (attr[2] ?? '').split(ASCII_WHITESPACE).includes('noopener')
      if (attrName === 'style') {
        style = attr[2] ?? ''
      } else if (attrName === 'class') {
        classValue = attr[2] ?? ''
      } else if (attrName === 'rel') {
        relValue = attr[2] ?? ''
      } else if (attrName === 'target') {
        targetValue = attr[2] ?? ''
      }
      cursor = ATTRIBUTE.lastIndex
    }
    TAG_END.lastIndex = cursor
    const close = TAG_END.exec(fragment)
    // A new browsing context opened by a link never gets a handle on this page.
    if (close === null || (seen.has('target') && !noopener)) {
      return {ok: false, reason: 'attribute'}
    }
    // A book link stands only in the book link's exact shape, an any-host link only in the article
    // link's, and the `sponsored` rel token only on a book link.
    const bookShape = linkShaped(BOOK_LINK, name, id, classValue, relValue, targetValue)
    if (
      (deferred.book || deferred.article) && !(deferred.book && bookShape) &&
      !(deferred.article && linkShaped(ARTICLE_LINK, name, id, classValue, relValue, targetValue))
    ) {
      return {ok: false, reason: 'url'}
    }
    if (relValue !== null && relValue.split(ASCII_WHITESPACE).includes('sponsored') && !(deferred.book && bookShape)) {
      return {ok: false, reason: 'attribute'}
    }
    // The UA styles `[popover]` as a fixed full-viewport layer; only `display: none` keeps it shut.
    // A top-level element carries no `style` or `popover`, so it cannot become a layer over the page.
    // The one exception: a value-free page shows its hiding value's overlay root.
    const overlayShown = options.overlayMayShow && top.length === 0 && OVERLAY_ROOTS.has(id) && style !== null && OVERLAY_STYLES.has(style)
    if (isRoot && (seen.has('popover') || (style !== null && !overlayShown))) {
      return {ok: false, reason: 'root'}
    }
    // The root names only its kind, state and accent: none of its component's absolute layers.
    if (isRoot && top.length === 0 && !rootClassesAllowed(id, classValue)) {
      return {ok: false, reason: 'root'}
    }
    // An author `display` (from `style` or from any class but the tooltip's own) would show it.
    if (seen.has('popover') && (style !== null || id !== POPOVER_FRAGMENT || classValue !== POPOVER_CLASS)) {
      return {ok: false, reason: style === null ? 'class' : 'style'}
    }
    const selfClosing = close[1] === '/'
    if (selfClosing && !svg && !VOID_ELEMENTS.has(name)) {
      return {ok: false, reason: 'markup'}
    }
    const current = top.at(-1)
    if (isRoot) {
      if (top.length === 0) {
        facts.root = {classes: (classValue ?? '').split(/[ \t\n]+/).filter(Boolean), scopes: facts.scopes.slice()}
      }
      top.push({name, id: ownId, hidden, empty: true, attributes: [...seen]})
    } else if (current !== undefined) {
      current.empty = false
    }
    if (!selfClosing && !VOID_ELEMENTS.has(name)) {
      stack.push({name, svg})
      count(open, name, 1)
    }
    pos = TAG_END.lastIndex
  }
  if (stack.length > 0) {
    return {ok: false, reason: 'nesting'}
  }
  const [root, carrier, ...rest] = top
  if (root === undefined || root.id !== id || rest.length > 0) {
    return {ok: false, reason: 'root'}
  }
  const carrierId = CARRIERS[id]
  const carrierAttributesAllowed = carrier?.attributes.every((attribute) => CARRIER_ATTRIBUTES.has(attribute)) === true
  if (
    carrier !== undefined &&
    (carrierId === undefined || carrier.id !== carrierId || carrier.name !== 'div' || !carrier.hidden || !carrier.empty || !carrierAttributesAllowed)
  ) {
    return {ok: false, reason: 'carrier'}
  }
  return {ok: true, facts}
}
