// @vitest-environment node
import {ESLint} from 'eslint'
import {describe, expect, it} from 'vitest'

// public/js/*.js is served raw, so its syntax floor is ES2017 (AGENTS.md, W9). The
// floor lives in eslint.config.mjs. These cases lint in-memory text against that
// real config, so a change that drops or loosens the floor fails here and not
// silently in production browsers.
const eslint = new ESLint({cwd: process.cwd()})

async function messages(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, {filePath})
  return result.messages
}

describe('public/js syntax floor (ES2017)', () => {
  it.each([
    ['optional chaining', 'var a = window.x?.y;\n'],
    ['nullish coalescing', 'var a = window.x ?? 1;\n'],
    ['object spread', 'var a = {...window.x};\n'],
    ['class field', 'class A { x = 1 }\n'],
    ['top-level await', 'await window.fetch("/x");\n'],
    ['optional catch binding', 'try { window.x() } catch { }\n']
  ])('rejects %s as a parse error', async (_name, code) => {
    const found = await messages('public/js/probe.js', code)
    expect(found.some((m) => m.fatal === true)).toBe(true)
  })

  it('accepts ES2017 syntax', async () => {
    const code = 'const f = async (x) => `${await x}`;\nwindow.f = f;\n'
    expect(await messages('public/js/probe.js', code)).toEqual([])
  })

  it('treats files as classic scripts, not modules', async () => {
    const found = await messages('public/js/probe.js', 'import x from "y";\n')
    expect(found.some((m) => m.fatal === true)).toBe(true)
  })

  it('gives sw-purge.js service-worker globals and pages browser globals', async () => {
    const sw = 'self.addEventListener("activate", function () { caches.keys(); });\n'
    expect(await messages('public/js/sw-purge.js', sw)).toEqual([])
    const misuse = await messages('public/js/sw-purge.js', 'window.x = 1;\n')
    expect(misuse.map((m) => m.ruleId)).toContain('no-undef')
    expect(await messages('public/js/clock.js', 'window.x = document.title;\n')).toEqual([])
  })

  it('does not hand node globals to raw-served scripts', async () => {
    const found = await messages('public/js/probe.js', 'process.exit(1);\n')
    expect(found.map((m) => m.ruleId)).toContain('no-undef')
  })
})
