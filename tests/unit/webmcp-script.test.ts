// @vitest-environment node
//
// The generated public/js/webmcp.js, executed. A fake ModelContext records what the
// script registers, and the script's fetch is routed into the real /mcp Function, so
// each WebMCP tool is proven to answer through the server's focus gate.

import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {TOOLS} from '../../src/lib/edge/agent-catalog.mjs'
import {onRequest as mcpRoute} from '../../src/pages/mcp/index'

const logger = vi.hoisted(() => ({info: vi.fn(), warn: vi.fn(), error: vi.fn()}))
vi.mock('@j0nathan-ll0yd/observability/edge', () => ({createEdgeLogger: () => logger}))

const SOURCE = readFileSync('public/js/webmcp.js', 'utf8')
const FOCUS_URL = `${CLOUDFRONT_BASE}${ENDPOINTS.focus}`
const BOOKS = {books: [{title: 'Reading A', status: 'reading'}]}

interface RegisteredTool {
  name: string
  description: string
  inputSchema: unknown
  annotations: Record<string, boolean>
  execute: (input: object, options?: {signal: AbortSignal}) => Promise<unknown>
}

let currentFocus = 'Personal'

beforeEach(() => {
  currentFocus = 'Personal'
  vi.stubGlobal('caches', {default: {match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined)}})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The browser's fetch: same-origin requests go to the /mcp Function, data-plane requests to a stub. */
function browserFetch(input: string, init?: RequestInit): Promise<Response> {
  if (input.startsWith(CLOUDFRONT_BASE)) {
    // CloudFront stamps x-amz-cf-id on every answer; the proxy admits no 200 without it.
    return Promise.resolve(new Response(JSON.stringify(input === FOCUS_URL ? {currentFocus} : BOOKS), {headers: {'x-amz-cf-id': 'test'}}))
  }
  const url = new URL(input, SITE_URL)
  const headers = new Headers(init?.headers)
  headers.set('host', url.host)
  headers.set('origin', SITE_URL)
  return mcpRoute({request: new Request(url, {...init, headers}), waitUntil: () => {}})
}

/** Run the script with the given globals; return what it registered and on which object. */
function run(globals: {document?: unknown; navigator?: unknown}) {
  // The server's CloudFront reads also go through the global fetch.
  vi.stubGlobal('fetch', browserFetch)
  new Function('document', 'navigator', 'fetch', SOURCE)(globals.document, globals.navigator, browserFetch)
}

function fakeModelContext() {
  const registered: RegisteredTool[] = []
  return {
    registered,
    registerTool: vi.fn((tool: RegisteredTool) => {
      registered.push(tool)
      return Promise.resolve()
    })
  }
}

describe('generated WebMCP script', () => {
  it('registers every catalog tool through document.modelContext.registerTool', () => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    expect(modelContext.registered.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
    for (const tool of modelContext.registered) {
      expect(tool.annotations.readOnlyHint).toBe(true)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toEqual({type: 'object', properties: {}})
    }
  })

  it('marks only the tools that carry third-party text untrustedContentHint', () => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    const hinted = modelContext.registered.filter((t) => t.annotations.untrustedContentHint === true).map((t) => t.name)
    expect(hinted).toEqual(TOOLS.filter((t) => t.untrustedContent).map((t) => t.name))
    expect(hinted).toContain('get_current_reading')
  })

  it('falls back to navigator.modelContext only when document.modelContext is absent', () => {
    const legacy = fakeModelContext()
    run({document: {}, navigator: {modelContext: legacy}})
    expect(legacy.registered).toHaveLength(TOOLS.length)

    const current = fakeModelContext()
    const unused = fakeModelContext()
    run({document: {modelContext: current}, navigator: {modelContext: unused}})
    expect(unused.registerTool).not.toHaveBeenCalled()
  })

  it('does nothing where no model context exists', () => {
    expect(() => run({document: {}, navigator: {}})).not.toThrow()
  })

  it.each(TOOLS.filter((t) => t.kind === 'static').map((t) => t.name))('executes %s through /mcp and returns the catalog payload', async (name) => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    const tool = modelContext.registered.find((t) => t.name === name)!
    const catalog = TOOLS.find((t) => t.name === name)!
    expect(await tool.execute({}, {signal: new AbortController().signal})).toEqual(JSON.parse(JSON.stringify('payload' in catalog ? catalog.payload : null)))
  })

  it('executes get_current_reading through the server focus gate', async () => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    const tool = modelContext.registered.find((t) => t.name === 'get_current_reading')!
    expect(await tool.execute({})).toEqual({reading: [{title: 'Reading A', status: 'reading'}], upNext: [], recentlyFinished: []})
    currentFocus = HIDING_FOCUS_MODES[1]
    expect(await tool.execute({})).toEqual({suppressed: true, reason: 'focus mode active'})
  })

  // covers: client-privacy#An unreadable focus value applies no gated data
  // The tool once fetched books.json whenever focusRes.ok was false. It now reads through /mcp,
  // whose focus gate fails closed, so the tool rejects and the bookshelf is never requested.
  it.each<[string, () => Promise<Response>]>([
    ['an HTTP error', () => Promise.resolve(new Response('{}', {status: 503}))],
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>'))],
    ['a body with no focus value', () => Promise.resolve(new Response(JSON.stringify({generatedAt: 'x'})))]
  ])('fails closed on %s and never reads the bookshelf', async (_label, focusAnswer) => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    const dataReads: string[] = []
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
      if (input.startsWith(CLOUDFRONT_BASE)) {
        dataReads.push(input)
        return input === FOCUS_URL ? focusAnswer() : browserFetch(input, init)
      }
      return browserFetch(input, init)
    })
    const tool = modelContext.registered.find((t) => t.name === 'get_current_reading')!
    await expect(tool.execute({})).rejects.toThrow(/failed/)
    expect(dataReads.length).toBeGreaterThan(0)
    expect(dataReads.every((url) => url === FOCUS_URL)).toBe(true)
  })

  it('returns the suppression document when the gate answers 403 over a visible focus value', async () => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      input.startsWith(CLOUDFRONT_BASE) && input !== FOCUS_URL
        ? Promise.resolve(new Response(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 403, headers: {'x-amz-cf-id': 'test'}}))
        : browserFetch(input, init))
    const tool = modelContext.registered.find((t) => t.name === 'get_current_reading')!
    expect(await tool.execute({})).toEqual({suppressed: true, reason: 'focus mode active'})
  })

  it('rejects, rather than returning data, when the server reports a tool error', async () => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    vi.stubGlobal('fetch',
      (input: string, init?: RequestInit) => input === FOCUS_URL ? Promise.resolve(new Response('nope', {status: 404})) : browserFetch(input, init))
    const tool = modelContext.registered.find((t) => t.name === 'get_current_reading')!
    await expect(tool.execute({})).rejects.toThrow(/failed/)
  })

  it('keeps registering after one registration throws', () => {
    const registered: string[] = []
    const modelContext = {
      registerTool: (tool: RegisteredTool) => {
        if (tool.name === TOOLS[0]!.name) {
          throw new Error('InvalidStateError')
        }
        registered.push(tool.name)
        return Promise.resolve()
      }
    }
    run({document: {modelContext}, navigator: {}})
    expect(registered).toEqual(TOOLS.slice(1).map((t) => t.name))
  })

  // LLM-channel data policy (SKILL.md decision 4, atlas decision 0096): WebMCP shares the catalog,
  // so no browser tool returns a raw health, sleep, or workouts export or names its URL.
  it('no tool result names or carries a raw health, sleep, or workouts export', async () => {
    const modelContext = fakeModelContext()
    run({document: {modelContext}, navigator: {}})
    for (const tool of modelContext.registered) {
      const text = JSON.stringify(await tool.execute({}))
      // Stated independently of the catalog policy under test.
      for (const url of [ENDPOINTS.health, ENDPOINTS.sleep, ENDPOINTS.workouts].map((path) => `${CLOUDFRONT_BASE}${path}`)) {
        expect(text, tool.name).not.toContain(url)
      }
    }
    expect(SOURCE).not.toMatch(/health\.json|sleep\.json|workouts\.json/)
  })

  it('carries no data host and no tool logic of its own', () => {
    expect(SOURCE).not.toContain(CLOUDFRONT_BASE)
    expect(SOURCE).not.toContain('provideContext')
  })

  // AGENTS.md: raw-served scripts are ES2017. TypeScript leaves ES2017 syntax untouched at
  // an ES2017 target and rewrites anything newer, so identical output at ES2017 and ESNext
  // proves the script uses nothing past ES2017.
  it('uses no syntax newer than ES2017', () => {
    const transpile = (target: ts.ScriptTarget) => ts.transpileModule(SOURCE, {compilerOptions: {target, module: ts.ModuleKind.None}}).outputText
    expect(transpile(ts.ScriptTarget.ES2017)).toBe(transpile(ts.ScriptTarget.ESNext))
  })
})
