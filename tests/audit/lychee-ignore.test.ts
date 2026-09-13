import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const ignorePatterns = readFileSync(resolve(process.cwd(), '.lycheeignore'), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) =>
  line.length > 0 && !line.startsWith('#')
)

describe('.lycheeignore scope', () => {
  it('contains only reviewed host/path-specific bot-noise exclusions', () => {
    expect(ignorePatterns).toEqual([
      'm\\.media-amazon\\.com',
      'images-na\\.ssl-images-amazon\\.com',
      'basemaps\\.cartocdn\\.com',
      '^https://www\\.linkedin\\.com/in/lifegames/?$',
      '^https://jonathanlloyd\\.me/cdn-cgi/l/email-protection$'
    ])
  })

  it('does not suppress GitHub or HTTP status errors broadly', () => {
    expect(ignorePatterns.some((pattern) => /github/i.test(pattern))).toBe(false)
    expect(ignorePatterns.some((pattern) => /40[0-9]|50[0-9]|999/.test(pattern))).toBe(false)
  })
})
