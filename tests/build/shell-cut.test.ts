// The data-free page cut at build time (atlas decision 0164, Variant D, Phase 1.2).
//
// scripts/build-shell.mjs cuts dist/client/index.html with parse5 source offsets into the generated
// module src/lib/composed/shell.generated.ts, which the Worker compiles in. This suite is the measurer
// of the seam between the built page and the compiled shell: the shell must be this build's page,
// cut where the Worker's own HTMLRewriter cut (src/lib/composed/shell.ts `markPage`) cuts it. The
// rewriter runs in workerd (Miniflare, through wrangler's own dependency), on the same bytes.
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {COMPOSED_FRAGMENT_IDS} from '../../src/lib/composed/artifact'
import {compileShell, cutAt, cutMarked} from '../../src/lib/composed/shell'
import {SHELL, SHELL_BUILD, SHELL_PAGE_SHA256} from '../../src/lib/composed/shell.generated'
import {buildId} from '../../scripts/lib/build-id.mjs'
import {clientDir} from '../../scripts/lib/build-paths.mjs'
import {SHELL_HEADERS, shellModule, shellOffsets} from '../../scripts/build-shell.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MARKER = / ssr-shell:(?:summary|start:[A-Za-z]+|end:[A-Za-z]+) /g

// wrangler's own esbuild and Miniflare: the versions that build and run this Worker.
const wranglerRequire = createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'))
interface Esbuild {
  build(options: object): Promise<{outputFiles: {text: string}[]}>
}
interface MiniflareLike {
  dispatchFetch(url: string, init: {method: string; body: string}): Promise<{text(): Promise<string>}>
  dispose(): Promise<void>
}

/** wrangler.jsonc's runtime pins: the rewriter runs under the Worker's own compatibility date and flags. */
function workerRuntime(): {compatibilityDate: string; compatibilityFlags: string[]} {
  const source = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
  // The file carries whole-line comments only (tests/unit/worker-routing.test.ts reads it the same way).
  const config = JSON.parse(source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')) as {
    compatibility_date: string
    compatibility_flags: string[]
  }
  return {compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags}
}

let html: string
let marked: string
let miniflare: MiniflareLike | undefined

/** The page as the Worker's HTMLRewriter pass marks it (src/lib/composed/shell.ts `markPage`). */
async function markInWorker(page: string): Promise<string> {
  if (miniflare === undefined) {
    throw new Error('Miniflare did not start')
  }
  return (await miniflare.dispatchFetch('http://shell.test/', {method: 'POST', body: page})).text()
}

beforeAll(async () => {
  html = readFileSync(path.join(clientDir(ROOT), 'index.html'), 'utf8')
  const esbuild = (await import(wranglerRequire.resolve('esbuild'))) as Esbuild
  const entry =
    "import {markPage} from './src/lib/composed/shell'\nexport default {fetch: async (request) => new Response(await markPage(await request.text()))}\n"
  const bundle = await esbuild.build({
    stdin: {contents: entry, resolveDir: ROOT, loader: 'ts'},
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'import'],
    write: false,
    logLevel: 'silent'
  })
  // Miniflare 5 takes its own option shape; wrangler converts the v4 shape the same way.
  const {Miniflare, convertV4MiniflareOptions} = (await import(wranglerRequire.resolve('miniflare'))) as {
    Miniflare: new(options: object) => MiniflareLike
    convertV4MiniflareOptions(options: object): object
  }
  miniflare = new Miniflare(
    convertV4MiniflareOptions({
      workers: [{name: 'shell-cut', ...workerRuntime(), modules: [{type: 'ESModule', path: 'shell-cut.mjs', contents: bundle.outputFiles[0]?.text ?? ''}]}]
    })
  )
  marked = await markInWorker(html)
}, 60_000)

afterAll(async () => {
  await miniflare?.dispose()
})

/** The original markup of each slot in the Worker's marked page, by slot. */
function slotContents(): Map<string, string> {
  const contents = new Map<string, string>([['summary', '']])
  for (const id of COMPOSED_FRAGMENT_IDS) {
    const start = ` ssr-shell:start:${id} `
    const from = marked.indexOf(start) + start.length
    contents.set(id, marked.slice(from, marked.indexOf(` ssr-shell:end:${id} `, from)))
  }
  return contents
}

describe('the build-time shell cut (atlas decision 0164)', () => {
  it('is the module this build wrote, from this build page', () => {
    expect(SHELL_BUILD).toBe(buildId())
    expect(SHELL_PAGE_SHA256).toBe(createHash('sha256').update(html).digest('hex'))
    const generated = readFileSync(path.join(ROOT, 'src/lib/composed/shell.generated.ts'), 'utf8')
    expect(generated).toBe(shellModule(html, buildId()))
  })

  it('cuts 13 fragment slots plus the summary slot, each once', () => {
    expect(SHELL.slots).toHaveLength(COMPOSED_FRAGMENT_IDS.length + 1)
    expect([...SHELL.slots].sort()).toEqual(['summary', ...COMPOSED_FRAGMENT_IDS].sort())
    expect(SHELL.pieces).toHaveLength(SHELL.slots.length + 1)
  })

  it('rebuilds index.html byte for byte from its pieces and the original slot contents', () => {
    // The Worker's marks are only inserted: without them its marked page is the page.
    expect(marked.replace(MARKER, '')).toBe(html)
    const contents = slotContents()
    let page = SHELL.pieces[0] ?? ''
    SHELL.slots.forEach((slot, i) => {
      page += (contents.get(slot) ?? '<missing>') + (SHELL.pieces[i + 1] ?? '')
    })
    expect(page).toBe(html)
    for (const id of COMPOSED_FRAGMENT_IDS) {
      expect(contents.get(id)).toMatch(new RegExp(`^<div\\b[^>]* id="${id}"`))
    }
  })

  it('equals the shell cutMarked derives from the Worker HTMLRewriter marks: pieces, slots, scopes, roots and ids', () => {
    const runtime = compileShell(cutMarked(marked, new Headers(SHELL_HEADERS as [string, string][])))
    expect(compileShell(SHELL)).toEqual(runtime)
    // A cut that read no scoped style at all is blind: the page carries some (four slots, measured 2026-10-23).
    expect(COMPOSED_FRAGMENT_IDS.some((id) => SHELL.scopes[id].size > 0)).toBe(true)
  })

  // The built page has whitespace between every cut, so it never meets a tie at one offset.
  it('orders the markers at one offset as the rewriter does: a root that ends where the next begins, the meta just before a root', async () => {
    const roots = COMPOSED_FRAGMENT_IDS.map((id) => `<div class="tri-card" id="${id}"><span>${id}</span></div>`).join('')
    const pages = [
      `<!DOCTYPE html><html><head><meta name="robots" content="index"></head><body><main>${roots}</main></body></html>`,
      // A <noscript> before the roots: parse5 reads its content as elements, as the rewriter does.
      `<!DOCTYPE html><html><head><meta name="robots" content="index"><noscript><p>x</p></noscript></head><body>${roots}</body></html>`,
      `<!DOCTYPE html><html><head></head><body><meta name="robots" content="index">${roots}</body></html>`
    ]
    for (const page of pages) {
      const fromWorker = cutMarked(await markInWorker(page), new Headers())
      expect(compileShell(cutAt(page, shellOffsets(page), new Headers()))).toEqual(compileShell(fromWorker))
      // Touching roots leave empty pieces between their slots: the tie was met.
      expect(fromWorker.pieces.filter((piece) => piece === '').length).toBeGreaterThanOrEqual(COMPOSED_FRAGMENT_IDS.length - 1)
    }
  })

  it('carries only the content type; the rest of the headers are set when the page is served', () => {
    expect([...SHELL.headers]).toEqual([['content-type', 'text/html; charset=utf-8']])
  })
})
