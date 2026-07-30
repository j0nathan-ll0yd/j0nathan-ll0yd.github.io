import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {validateLlmsTxt} from '../../scripts/audit/validate-llms-txt.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8')

// decisions/0011 Step 4.5: the clean-file, known-answer(llms-invalid.txt),
// missing-H1, and bare-URL-list-item cases formerly hand-written here now
// live as derived cases in specs/llms-txt/*.rule.json (llms-txt-h1.rule.json,
// llms-txt-blockquote.rule.json, llms-txt-non-link-list-item.rule.json),
// exercised against the SAME fixture files by tests/audit/spec-cases.test.ts
// -- deleted here as replacement, not as inconvenience. Retained below: BOM
// handling, "Optional" section semantics, and free-form pre-H2 prose, none of
// which the rule catalog declares a dedicated case for.
describe('validateLlmsTxt', () => {
  it('strips an optional BOM before validating', () => {
    const withBom = '﻿' + fixture('llms-valid.txt')
    const findings = validateLlmsTxt(withBom)
    expect(findings).toEqual([])
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
