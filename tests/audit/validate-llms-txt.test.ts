import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {validateLlmsTxt} from '../../scripts/audit/validate-llms-txt.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8')

describe('validateLlmsTxt', () => {
  it('a fully spec-conformant file produces zero findings', () => {
    const findings = validateLlmsTxt(fixture('llms-valid.txt'))
    expect(findings).toEqual([])
  })

  it('known-answer fixture: bare bullets, an empty section, and no blockquote all flag', () => {
    const findings = validateLlmsTxt(fixture('llms-invalid.txt'))
    const ids = findings.map((f) => f.id)
    expect(ids).toContain('llms-txt-blockquote')
    expect(ids).toContain('llms-txt-non-link-list-item')
    expect(ids).toContain('llms-txt-h2-no-file-list')
  })

  it('missing H1 fails immediately and stops further parsing', () => {
    const findings = validateLlmsTxt('Not a heading at all\n\n> some quote\n')
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('llms-txt-h1')
  })

  it('strips an optional BOM before validating', () => {
    const withBom = '﻿' + fixture('llms-valid.txt')
    const findings = validateLlmsTxt(withBom)
    expect(findings).toEqual([])
  })

  it('a bare-URL list item (not a markdown link) is flagged', () => {
    const text = '# Site\n\n> Summary\n\n## Links\n\n- https://example.com/bare\n'
    const findings = validateLlmsTxt(text)
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('llms-txt-non-link-list-item')
  })

  it('an H2 section named "Optional" is validated the same as any other section', () => {
    const validOptional = '# Site\n\n> Summary\n\n## Optional\n\n- [Extra](https://example.com/extra)\n'
    expect(validateLlmsTxt(validOptional)).toEqual([])

    const invalidOptional = '# Site\n\n> Summary\n\n## Optional\n\n- bare bullet, no link\n'
    const findings = validateLlmsTxt(invalidOptional)
    expect(findings.map((f) => f.id)).toContain('llms-txt-non-link-list-item')
  })

  it('free-form prose before the first H2 is not flagged', () => {
    const text = '# Site\n\n> Summary\n\nSome paragraph.\n\n- a plain list item, not yet in an H2 section\n\n## Docs\n\n- [Doc](https://example.com/doc)\n'
    expect(validateLlmsTxt(text)).toEqual([])
  })
})
