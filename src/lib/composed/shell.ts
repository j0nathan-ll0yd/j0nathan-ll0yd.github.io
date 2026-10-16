// The data-free page as a shell for composed fragments (atlas decision 0160, PR B; owner decision
// 2026-10-16, option 1).
//
// Once per isolate the Worker cuts the prerendered data-free page (dist/client/index.html) at every
// element a composed artifact replaces, with one HTMLRewriter pass. Each request then joins the cut
// pieces with the artifact's fragments: string work only, no parsing and no rendering. The website
// owns everything outside the fragments (the head, the hashed asset names, the client runtime), so a
// website deploy changes the shell and never the artifact.
//
// Scoped styles: Astro marks a component's elements with `data-astro-cid-<hash>`, a hash of the
// component's file path. A fragment rendered from a different install layout would carry different
// hashes, and the website's CSS would not style it. The shell records, per replaced element, every
// hash that element carries in the data-free page; a fragment that carries any other hash is refused
// (`fitsShell`), so a fragment cannot borrow another component's scoped styles either.
//
// Ids: the shell also records every id its own page keeps outside the replaced elements. A fragment
// that carries one of them is refused, so a fragment never answers a getElementById meant for the
// page around it.
import {type ArtifactFacts, COMPOSED_FRAGMENT_IDS, type ComposedFragmentId} from './artifact'

const SENTINEL = (name: string) => ` ssr-shell:${name} `
const SUMMARY_SLOT = 'summary'
const SCOPE_PATTERN = /data-astro-cid-[a-z0-9]+/g

export interface Shell {
  /** The page, cut at every replaced element: pieces[i] comes before slots[i]. */
  pieces: string[]
  slots: (ComposedFragmentId | typeof SUMMARY_SLOT)[]
  /** Per replaced element, every scoped-style hash it carries in the data-free page. */
  scopes: Readonly<Record<ComposedFragmentId, ReadonlySet<string>>>
  /**
   * Per replaced element, its root's shape in the data-free page: the first class token (the
   * component's kind; later tokens are state, such as `is-loading`, or data, such as an accent) and
   * its scoped-style hash. A fragment root must keep both: `.tri-card` is the containing block for
   * the card's own absolute layers, and an overlay's hash is what keeps it `display: none`.
   */
  roots: Readonly<Record<ComposedFragmentId, {firstClass: string | null; scopes: ReadonlySet<string>}>>
  /** Every id the page keeps outside the replaced elements. */
  ids: ReadonlySet<string>
  /** The response headers of the data-free page. */
  headers: Headers
}

const START = (id: string) => ` ssr-shell:start:${id} `
const END = (id: string) => ` ssr-shell:end:${id} `
const MARKER = / ssr-shell:(?:(summary)|start:([A-Za-z]+)|end:([A-Za-z]+)) /g

/** Cuts the data-free page. Throws when an element the artifact replaces is missing: a build defect. */
export async function cutShell(page: Response): Promise<Shell> {
  const headers = new Headers(page.headers)
  const html = await page.text()
  // One pass marks each replaced element's start and end; the cut itself is string work (`cutMarked`).
  let rewriter = new HTMLRewriter().on('meta[name="robots"]', {element: (meta) => void meta.after(SENTINEL(SUMMARY_SLOT))})
  for (const id of COMPOSED_FRAGMENT_IDS) {
    rewriter = rewriter.on(`#${id}`, {
      element: (el) => {
        el.before(START(id))
        el.onEndTag((end) => void end.after(END(id)))
      }
    })
  }
  const marked = await rewriter.transform(new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}})).text()
  return cutMarked(marked, headers)
}

/**
 * The shell from a page whose replaced elements are marked (`cutShell`). Each replaced element
 * becomes a slot; its own markup gives that slot's scoped-style hashes. The data-free page renders
 * every replaced component (in its `loading` state), so each slot carries every hash a correctly
 * built fragment of that component can carry.
 */
export function cutMarked(marked: string, headers: Headers): Shell {
  const pieces: string[] = []
  const slots: Shell['slots'] = []
  const scopes: Partial<Record<ComposedFragmentId, ReadonlySet<string>>> = {}
  const roots: Partial<Record<ComposedFragmentId, {firstClass: string | null; scopes: ReadonlySet<string>}>> = {}
  let last = 0
  let open: {id: ComposedFragmentId; from: number} | null = null
  for (const match of marked.matchAll(MARKER)) {
    const at = match.index ?? 0
    const [, summary, start, end] = match
    if (summary !== undefined && open === null) {
      pieces.push(marked.slice(last, at))
      slots.push(SUMMARY_SLOT)
      last = at + match[0].length
    } else if (start !== undefined && open === null && (COMPOSED_FRAGMENT_IDS as readonly string[]).includes(start)) {
      pieces.push(marked.slice(last, at))
      // Checked against the fragment ids just above.
      open = {id: start as ComposedFragmentId, from: at + match[0].length}
    } else if (end !== undefined && open !== null && end === open.id) {
      const slot = marked.slice(open.from, at)
      scopes[open.id] = new Set(slot.match(SCOPE_PATTERN) ?? [])
      const rootTag = /^\s*<div\b[^>]*>/.exec(slot)?.[0] ?? ''
      roots[open.id] = {firstClass: / class="([^" ]+)/.exec(rootTag)?.[1] ?? null, scopes: new Set(rootTag.match(SCOPE_PATTERN) ?? [])}
      slots.push(open.id)
      open = null
      last = at + match[0].length
    } else {
      throw new Error('data-free page marked out of order')
    }
  }
  pieces.push(marked.slice(last))
  if (open !== null || slots.length !== COMPOSED_FRAGMENT_IDS.length + 1 || new Set(slots).size !== slots.length) {
    throw new Error(`data-free page cut into ${slots.length} slots`)
  }
  // The page is this build's own output, so a pattern reads the ids it keeps around the slots exactly.
  const ids = new Set(pieces.flatMap((piece) => [...piece.matchAll(/ id="([^"]*)"/g)].map((match) => match[1] ?? '')))
  // Every fragment id was cut above.
  return {pieces, slots, scopes: scopes as Record<ComposedFragmentId, ReadonlySet<string>>, roots: roots as Shell['roots'], ids, headers}
}

/**
 * Null when the fragments fit the shell: each fragment root keeps its slot root's shape (first class
 * token and scoped-style hash), each fragment's hashes are ones its own slot carries, and no id is
 * one the page keeps. Otherwise the reason, for the log line.
 */
export function fitsShell(shell: Shell, facts: ArtifactFacts): 'scopes' | 'root' | 'ids' | null {
  for (const id of COMPOSED_FRAGMENT_IDS) {
    const slotRoot = shell.roots[id]
    const root = facts.roots[id]
    if ((slotRoot.firstClass !== null && !root.classes.has(slotRoot.firstClass)) || [...slotRoot.scopes].some((scope) => !root.scopes.has(scope))) {
      return 'root'
    }
    for (const scope of facts.scopes[id]) {
      if (!shell.scopes[id].has(scope)) {
        return 'scopes'
      }
    }
  }
  for (const id of facts.ids) {
    if (shell.ids.has(id)) {
      return 'ids'
    }
  }
  return null
}

/** The page: the shell's pieces joined with the fragments and the summary meta. String work only. */
export function assemble(shell: Shell, fragments: Record<ComposedFragmentId, string>, summary: string): string {
  let out = shell.pieces[0] ?? ''
  for (let i = 0; i < shell.slots.length; i++) {
    const slot = shell.slots[i]
    // The summary is one of a closed set of words (SsrSummary), never an export value.
    out += (slot === SUMMARY_SLOT ? `<meta name="ssr-data" content="${summary}">` : fragments[slot as ComposedFragmentId]) + (shell.pieces[i + 1] ?? '')
  }
  return out
}

let cached: {key: string; shell: Promise<Shell>} | null = null

/** The cut shell, once per isolate and build (`key` is the build id). A failed cut is not kept. */
export function shellFor(key: string, read: () => Promise<Response>): Promise<Shell> {
  if (!cached || cached.key !== key) {
    const shell = read().then(cutShell)
    cached = {key, shell}
    shell.catch(() => {
      if (cached?.shell === shell) {
        cached = null
      }
    })
  }
  return cached.shell
}

export function resetShellForTest(): void {
  cached = null
}
