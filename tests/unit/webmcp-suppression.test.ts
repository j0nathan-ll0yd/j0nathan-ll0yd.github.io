import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {describe, expect, it, vi} from 'vitest'

// Runs the GENERATED tool, not a string match on it: public/js/webmcp.js is evaluated with a stub
// navigator.modelContext that captures the tools it provides, and get_current_reading executes
// against stubbed fetch answers.
const source = readFileSync('public/js/webmcp.js', 'utf8')
const FOCUS_URL = 'https://d1pfm520aduift.cloudfront.net/focus.json'

interface Tool {
  name: string
  execute: () => Promise<{content: Array<{text: string}>}>
}

function readingTool(fetchImpl: (url: string) => Promise<Response>): Tool {
  let tools: Tool[] = []
  runInNewContext(source, {
    navigator: {modelContext: {provideContext: (context: {tools: Tool[]}) => (tools = context.tools)}},
    fetch: fetchImpl,
    JSON,
    Promise
  })
  const tool = tools.find((candidate) => candidate.name === 'get_current_reading')
  if (!tool) {
    throw new Error('get_current_reading was not provided')
  }
  return tool
}

async function run(fetchImpl: (url: string) => Promise<Response>): Promise<unknown> {
  return JSON.parse((await readingTool(fetchImpl).execute()).content[0].text)
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {status}))

describe('generated WebMCP reading tool', () => {
  it('reads the bookshelf only after a decoded visible focus value', async () => {
    const fetchImpl = vi.fn((url: string) => url === FOCUS_URL ? json({currentFocus: 'None'}) : json({books: [{status: 'reading', title: 'A'}]}))
    expect(await run(fetchImpl)).toEqual({reading: [{status: 'reading', title: 'A'}], upNext: [], recentlyFinished: []})
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('answers suppressed for a hiding focus value without reading the bookshelf', async () => {
    const fetchImpl = vi.fn((url: string) => url === FOCUS_URL ? json({currentFocus: 'Do Not Disturb'}) : json({books: []}))
    expect(await run(fetchImpl)).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  // covers: client-privacy#An unreadable focus value applies no gated data
  // The tool once fetched books.json whenever focusRes.ok was false.
  it.each<[string, () => Promise<Response>]>([
    ['an HTTP error', () => json({}, 503)],
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>'))],
    ['a body with no focus value', () => json({generatedAt: 'x'})]
  ])('fails closed on %s and never reads the bookshelf', async (_label, focusAnswer) => {
    const fetchImpl = vi.fn((url: string) => url === FOCUS_URL ? focusAnswer() : json({books: [{status: 'reading'}]}))
    expect(await run(fetchImpl)).toEqual({failed: true, reason: 'focus state unreadable'})
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('reports a gate suppression body on the bookshelf path', async () => {
    const fetchImpl = vi.fn((url: string) => url === FOCUS_URL ? json({currentFocus: 'None'}) : json({suppressed: true, reason: 'focus mode active'}, 403))
    expect(await run(fetchImpl)).toEqual({suppressed: true, reason: 'focus mode active'})
  })
})
