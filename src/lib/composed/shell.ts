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
// hashes, and the website's CSS would not style it. The shell records every hash its page carries; a
// fragment that carries any other hash is refused (`scopesMatch`).
import {COMPOSED_FRAGMENT_IDS, type ComposedFragmentId} from './artifact'

const SENTINEL = (name: string) => ` ssr-shell:${name} `
const SUMMARY_SLOT = 'summary'
const SCOPE_PATTERN = /data-astro-cid-[a-z0-9]+/g

export interface Shell {
  /** The page, cut at every replaced element: pieces[i] comes before slots[i]. */
  pieces: string[]
  slots: (ComposedFragmentId | typeof SUMMARY_SLOT)[]
  /** Every scoped-style hash the website's own page carries. */
  scopes: ReadonlySet<string>
  /** The response headers of the data-free page. */
  headers: Headers
}

/** Cuts the data-free page. Throws when an element the artifact replaces is missing: a build defect. */
export async function cutShell(page: Response): Promise<Shell> {
  const headers = new Headers(page.headers)
  const html = await page.text()
  let rewriter = new HTMLRewriter().on('meta[name="robots"]', {element: (meta) => void meta.after(SENTINEL(SUMMARY_SLOT))})
  for (const id of COMPOSED_FRAGMENT_IDS) {
    rewriter = rewriter.on(`#${id}`, {element: (el) => void el.replace(SENTINEL(id))})
  }
  const cut = await rewriter.transform(new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}})).text()
  const pieces: string[] = []
  const slots: Shell['slots'] = []
  let last = 0
  for (const match of cut.matchAll(/ ssr-shell:([A-Za-z]+) /g)) {
    pieces.push(cut.slice(last, match.index))
    // Only the sentinels written above match this pattern.
    slots.push(match[1] as Shell['slots'][number])
    last = (match.index ?? 0) + match[0].length
  }
  pieces.push(cut.slice(last))
  if (slots.length !== COMPOSED_FRAGMENT_IDS.length + 1 || new Set(slots).size !== slots.length) {
    throw new Error(`data-free page cut into ${slots.length} slots`)
  }
  // The data-free page renders every replaced component (in its `loading` state), so it carries
  // every hash a correctly built fragment can carry.
  return {pieces, slots, scopes: new Set(html.match(SCOPE_PATTERN) ?? []), headers}
}

/** True when every scoped-style hash in the fragments is one the shell's own elements carry. */
export function scopesMatch(shell: Shell, fragments: Record<ComposedFragmentId, string>): boolean {
  for (const id of COMPOSED_FRAGMENT_IDS) {
    for (const scope of fragments[id].match(SCOPE_PATTERN) ?? []) {
      if (!shell.scopes.has(scope)) {
        return false
      }
    }
  }
  return true
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
