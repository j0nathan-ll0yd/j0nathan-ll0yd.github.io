import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {llm} from '@j0nathan-ll0yd/copy'
import {NOT_FOUND_MARKDOWN} from '../../src/lib/edge/not-found-markdown.mjs'
import {OUTPUT_PATH, renderNotFoundMarkdown, renderNotFoundModule} from '../../scripts/generate-not-found.mjs'

// The markdown 404 body is generated at prebuild into a dependency-free module, so a copy defect
// fails the build rather than the Worker's start (src/lib/edge/agent-paths.mjs states the rule).

const clone = () => JSON.parse(JSON.stringify(llm))

describe('generated markdown 404 module', () => {
  it('is fresh: the committed module equals what the generator renders from the installed copy', () => {
    expect(readFileSync(OUTPUT_PATH, 'utf8')).toBe(renderNotFoundModule())
    expect(NOT_FOUND_MARKDOWN).toBe(renderNotFoundMarkdown())
  })

  it('imports nothing, and the middleware imports no copy or catalog module', () => {
    expect(readFileSync(OUTPUT_PATH, 'utf8')).not.toMatch(/^\s*import\b/m)
    const middleware = readFileSync('src/lib/edge/middleware.ts', 'utf8')
    // Import statements only: the middleware's comments may name the package they avoid.
    expect(middleware).not.toMatch(/^import[^\n]*from '@j0nathan-ll0yd\/copy/m)
    expect(middleware).not.toMatch(/^import[^\n]*from '[^']*agent-catalog/m)
  })
})

describe('renderNotFoundMarkdown fails the build, naming the key, on a copy defect', () => {
  it('rejects a missing llm.notFound', () => {
    const copy = clone()
    delete copy.notFound
    expect(() => renderNotFoundMarkdown(copy)).toThrow(/llm\.notFound\.heading/)
  })

  it('rejects a body shorter than 20 characters', () => {
    const copy = clone()
    copy.notFound.body = 'Not here.'
    expect(() => renderNotFoundMarkdown(copy)).toThrow(/shorter than 20 characters/)
  })

  it.each(['linkLlmsTxt', 'linkIndexMd', 'linkSitemap', 'linkDevelopers'])('rejects a missing llm.notFound.%s', (key) => {
    const copy = clone()
    delete copy.notFound[key]
    expect(() => renderNotFoundMarkdown(copy)).toThrow(new RegExp(`llm\\.notFound\\.${key}`))
  })

  it('rejects a link whose {siteUrl} template names another URL than its contract path', () => {
    const copy = clone()
    copy.notFound.linkDevelopers.url = '{siteUrl}/docs'
    expect(() => renderNotFoundMarkdown(copy)).toThrow(/does not name the contract path/)
  })
})
