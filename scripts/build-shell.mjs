#!/usr/bin/env node
/* Cuts the data-free page at build time (atlas decision 0164, Variant D, Phase 1.2) into the
 * generated module src/lib/composed/shell.generated.ts, which the Worker compiles in
 * (src/lib/composed/compiled-shell.ts). git ignores its output. Every `pnpm build` runs it between
 * two `astro build` passes (scripts/build-site.mjs): the first pass writes the page, the second
 * compiles its cut into the Worker. The page does not depend on the Worker bundle, so the second
 * pass writes the same page; `--check` proves it, and that the Worker bundle holds the shell.
 *
 * The cut is the one the Worker makes once per isolate today (src/lib/composed/shell.ts `cutShell`),
 * made here instead: parse5 gives the source offsets of the robots meta and of the 13 replaced
 * elements (start tag to the end of the end tag), and `cutAt` puts the Worker's own markers at those
 * offsets and runs `cutMarked`. The page is sliced, never re-serialized, so the pieces are bytes of
 * dist/client/index.html. tests/build/shell-cut.test.ts checks the cut against the page and against
 * the Worker's HTMLRewriter cut of the same page.
 *
 * Headers: the shell carries `Access-Control-Allow-Origin: *` (the asset plane's header) and
 * `Content-Type: text/html; charset=utf-8`. The Worker took the asset response's headers at run
 * time; at build time there is no response. Every other header of
 * the answer to `/` is set when it is served: the cache policy and `X-SSR-Data` by
 * src/lib/data-plane/ssr-response.ts `withDashboardHeaders` (which also drops the asset validators),
 * the security headers by the site middleware (src/lib/edge/middleware.ts).
 *
 * Run with tsx: it imports the TypeScript cut from src/. */
import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'parse5'
import {COMPOSED_FRAGMENT_IDS} from '../src/lib/composed/artifact.ts'
import {compileShell, cutAt} from '../src/lib/composed/shell.ts'
import {ASSET_PLANE_HEADERS} from '../src/lib/edge/security-headers.ts'
import {buildId} from './lib/build-id.mjs'
import {clientDir, serverDir} from './lib/build-paths.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const SHELL_MODULE = path.join(ROOT, 'src/lib/composed/shell.generated.ts')
/**
 * The headers the compiled shell carries (see the header comment): the asset plane's own header,
 * which `_headers` adds to the page the run-time cut read (src/lib/edge/security-headers.ts
 * ASSET_PLANE_HEADERS), and the content type. Measured 2026-10-23 on wrangler dev: with these, the
 * published `/` carries exactly the headers of the composed `/` from the same fragments.
 */
export const SHELL_HEADERS = Object.freeze([...ASSET_PLANE_HEADERS, ['Content-Type', 'text/html; charset=utf-8']])

/** Every element under `node`, in document order. */
function* elements(node) {
  for (const child of node.childNodes ?? []) {
    if (child.tagName !== undefined) {
      yield child
      // A <template>'s children sit in its content fragment.
      yield* elements(child.tagName === 'template' ? child.content : child)
    }
  }
}

const attr = (element, name) => element.attrs.find((a) => a.name === name)?.value

/**
 * The cut offsets of the page, read from parse5's source locations. Throws unless the page holds
 * exactly one robots meta and exactly one element with each fragment id, each with an end tag.
 */
export function shellOffsets(html) {
  // scriptingEnabled false: parse5 then reads <noscript> content as elements, as HTMLRewriter does.
  const document = parse(html, {sourceCodeLocationInfo: true, scriptingEnabled: false})
  const robots = []
  const found = new Map(COMPOSED_FRAGMENT_IDS.map((id) => [id, []]))
  for (const element of elements(document)) {
    if (element.tagName === 'meta' && attr(element, 'name') === 'robots') {
      robots.push(element)
    }
    const id = attr(element, 'id')
    if (id !== undefined && found.has(id)) {
      found.get(id).push(element)
    }
  }
  if (robots.length !== 1) {
    throw new Error(`the data-free page holds ${robots.length} robots meta elements, not 1`)
  }
  const slots = {}
  for (const [id, list] of found) {
    if (list.length !== 1) {
      throw new Error(`the data-free page holds ${list.length} elements with id ${id}, not 1`)
    }
    const location = list[0].sourceCodeLocation
    if (location?.endTag === undefined) {
      throw new Error(`#${id} has no end tag in the data-free page`)
    }
    slots[id] = {start: location.startOffset, end: location.endTag.endOffset}
  }
  return {summary: robots[0].sourceCodeLocation.endOffset, slots}
}

/** The generated module's source for `html`, the data-free page of build `build`. */
export function shellModule(html, build) {
  const compiled = compileShell(cutAt(html, shellOffsets(html), new Headers(SHELL_HEADERS)))
  const sha256 = createHash('sha256').update(html).digest('hex')
  return [
    '// GENERATED by scripts/build-shell.mjs from dist/client/index.html (atlas decision 0164). Do not',
    '// edit: every build rewrites it, and git ignores it.',
    "import {type CompiledShell, shellFromCompiled} from './shell'",
    '',
    '/** The build the page was cut from (scripts/lib/build-id.mjs). */',
    `export const SHELL_BUILD = ${JSON.stringify(build)}`,
    '/** The sha256 of the page the shell was cut from. */',
    `export const SHELL_PAGE_SHA256 = ${JSON.stringify(sha256)}`,
    '',
    `const COMPILED: CompiledShell = ${JSON.stringify(compiled)}`,
    '',
    '/** The data-free page, cut. */',
    'export const SHELL = shellFromCompiled(COMPILED)',
    ''
  ].join('\n')
}

/** The Worker bundle's modules that name `sha256`: exactly one when the shell is compiled in. */
export function bundlesNaming(sha256, dir = serverDir(ROOT)) {
  return readdirSync(dir, {recursive: true}).map(String).filter((name) =>
    name.endsWith('.mjs') && readFileSync(path.join(dir, name), 'utf8').includes(sha256)
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = path.join(clientDir(ROOT), 'index.html')
  const html = readFileSync(page, 'utf8')
  const source = shellModule(html, buildId())
  if (process.argv.includes('--check')) {
    // After the second `astro build` (package.json `build`): the module that build compiled in must be
    // the cut of the page it shipped, and the Worker bundle must hold it.
    if (!existsSync(SHELL_MODULE) || readFileSync(SHELL_MODULE, 'utf8') !== source) {
      throw new Error('[build-shell] the compiled shell is not the cut of dist/client/index.html; the page changed between the two builds')
    }
    const sha256 = createHash('sha256').update(html).digest('hex')
    const holders = bundlesNaming(sha256)
    if (holders.length !== 1) {
      throw new Error(`[build-shell] ${holders.length} Worker modules hold the compiled shell, not 1`)
    }
    console.log(`[build-shell] OK: dist/server/${holders[0]} holds the cut of dist/client/index.html (sha256 ${sha256.slice(0, 12)})`)
  } else {
    writeFileSync(SHELL_MODULE, source)
    console.log(`[build-shell] wrote ${path.relative(ROOT, SHELL_MODULE)} (${source.length} bytes) from ${path.relative(ROOT, page)}`)
  }
}
