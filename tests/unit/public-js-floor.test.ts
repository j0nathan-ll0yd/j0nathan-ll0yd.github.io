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

  it('applies the floor to .mjs and .cjs files too', async () => {
    for (const file of ['public/js/probe.mjs', 'public/js/probe.cjs']) {
      const found = await messages(file, 'var a = window.x?.y;\n')
      expect(found.some((m) => m.fatal === true)).toBe(true)
    }
  })

  it('parses .mjs as a module and .js as a script', async () => {
    expect(await messages('public/js/probe.mjs', 'import x from "y";\nwindow.x = x;\n')).toEqual([])
  })

  it('flags unused variables and functions but tolerates unused catch bindings', async () => {
    const unused = await messages('public/js/probe.js', 'var a = 1;\nfunction f() {}\n')
    expect(unused.map((m) => m.ruleId)).toEqual(['no-unused-vars', 'no-unused-vars'])
    expect(await messages('public/js/probe.js', 'try { window.x() } catch (e) {}\n')).toEqual([])
  })

  it('flags empty blocks except an empty catch', async () => {
    const found = await messages('public/js/probe.js', 'if (window.x) {}\n')
    expect(found.map((m) => m.ruleId)).toEqual(['no-empty'])
  })

  it('flags a redeclared var', async () => {
    const found = await messages('public/js/probe.js', 'var a = 1;\nvar a = 2;\nwindow.a = a;\n')
    expect(found.map((m) => m.ruleId)).toContain('no-redeclare')
  })
})
