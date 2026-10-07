import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {classifySource, judgeCurrency, WATCHED_SOURCES, watchedRecords} from '../checks/b2-check-spec-currency.mjs'

// The vendored agent-discovery schemas (atlas decision 0158) are upstream blobs, byte
// for byte. A hand edit would make b2-check-wellknown validate against a schema no
// upstream published, so the recorded digest is recomputed here on every run.
const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'agent-discovery')
const SOURCES = JSON.parse(readFileSync(join(VENDOR_DIR, 'SOURCES.json'), 'utf8')).files as Array<
  {file: string; url: string; commit: string; sha256: string}
>

describe('vendored agent-discovery schemas', () => {
  it.each(SOURCES.map((s) => [s.file, s]))('%s matches its recorded sha256 and commit-pinned URL', (_file, source) => {
    const bytes = readFileSync(join(VENDOR_DIR, source.file))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256)
    expect(source.url).toContain(`/${source.commit}/`)
    expect(classifySource(source.url).kind).toBe('github-raw')
  })

  it('every vendored schema is watched by the currency probe at the pin it was vendored from', () => {
    const watched = WATCHED_SOURCES.map((s) => s.pinnedAt)
    for (const source of SOURCES) {
      expect(watched).toContain(source.url)
    }
  })

  it('watches the WebMCP draft, the MCP server-card extension, and ARD', () => {
    const urls = WATCHED_SOURCES.map((s) => s.pinnedAt).join('\n')
    expect(urls).toContain('webmachinelearning/webmcp/')
    expect(urls).toContain('modelcontextprotocol/ext-server-card/')
    expect(urls).toContain('seps/2127-mcp-server-cards.md')
    expect(urls).toContain('ards-project/ard-spec/')
    for (const source of WATCHED_SOURCES) {
      expect(classifySource(source.pinnedAt).kind).toBe('github-raw')
    }
  })

  // A watched source carries no quote, so a revision can only prompt a re-read; it can
  // never be judged as a falsified rule.
  it('a revised watched source is spec-source-moved, never quote-absent', () => {
    const [record] = watchedRecords()
    const url = record!.rule.derivedFrom.pinnedAt
    const sources = new Map([[url, {...classifySource(url), held: true, pinnedText: 'v1', currentText: 'v2', currentCommit: null}]])
    const findings = judgeCurrency([record], sources, {nowMs: Date.parse(record!.rule.derivedFrom.retrieved)})
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['spec-source-moved'])
  })
})
