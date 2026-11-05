import {describe, expect, it} from 'vitest'
import {readdirSync, readFileSync} from 'fs'
import {load} from 'cheerio'
import path from 'path'
import {clientDir} from '../../scripts/lib/build-paths.mjs'

// Every built HTML page carries `<meta name="bingbot" content="nocache">` (atlas decision 0174 B1):
// Bing has no robots.txt training token, and NOCACHE limits Microsoft training and chat answers to
// URL, title and snippet. The tag sits immediately before the robots meta, so the composed shell's
// cut after the robots meta (src/lib/composed/shell.ts, scripts/build-shell.mjs) does not move.
// tests/behavioral/bingbot-nocache.spec.ts checks the pages the Worker answers.
const distDir = clientDir()

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return htmlFiles(full)
    }
    return entry.name.endsWith('.html') ? [path.relative(distDir, full)] : []
  })
}

describe('bingbot nocache', () => {
  const files = htmlFiles(distDir)

  it('finds the page types: home, text pages, 404, 500 and offline', () => {
    expect(files).toEqual(expect.arrayContaining(['index.html', 'about.html', 'privacy.html', '404.html', '500.html', 'offline.html']))
  })

  it.each(files)('%s carries one bingbot nocache meta, immediately before the robots meta', (file) => {
    const $ = load(readFileSync(path.join(distDir, file), 'utf8'))
    const bingbot = $('head meta[name="bingbot"]')
    expect(bingbot).toHaveLength(1)
    expect(bingbot.attr('content')).toBe('nocache')
    expect(bingbot.next().is('meta[name="robots"]')).toBe(true)
  })
})
