import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {load} from 'cheerio'
import {describe, expect, it} from 'vitest'
import {clientDir} from '../../scripts/lib/build-paths.mjs'
import {decodeEmail, EMAIL_DECODE_SCRIPT, EMAIL_FALLBACK_PATH} from '../../src/lib/email/obfuscate'

// The built /privacy carries the address only encoded (atlas decision 0158), and security.txt keeps
// its clear Contact line (RFC 9116).

const copyRequire = createRequire(import.meta.url)
const identity = copyRequire('@j0nathan-ll0yd/copy/identity.flat.json') as {person: {email: string}; contact: {title: string}}
const client = clientDir()

describe('built /privacy', () => {
  const html = readFileSync(path.join(client, 'privacy.html'), 'utf8')
  const $ = load(html)

  it('names no address and no mailto in clear', () => {
    expect(html).not.toContain(identity.person.email)
    expect(html).not.toMatch(/mailto:/i)
  })

  it('renders each address as a real link to the contact page that decodes to the copy address', () => {
    const links = $('a[data-email]')
    expect(links.length).toBe(2)
    links.each((_i, element) => {
      expect($(element).attr('href')).toBe(EMAIL_FALLBACK_PATH)
      expect($(element).text()).toBe(identity.contact.title)
      expect(decodeEmail($(element).attr('data-email') ?? '')).toBe(identity.person.email)
    })
  })

  it('loads the first-party decoder once, deferred, with no inline script', () => {
    const scripts = $(`script[src="${EMAIL_DECODE_SCRIPT}"]`)
    expect(scripts.length).toBe(1)
    expect(scripts.attr('defer')).toBeDefined()
  })
})

describe('built security.txt', () => {
  it('keeps the clear Contact line RFC 9116 requires', () => {
    const text = readFileSync(path.join(client, '.well-known', 'security.txt'), 'utf8')
    expect(text).toMatch(new RegExp(`^Contact: mailto:${identity.person.email.replace('.', '\\.')}$`, 'm'))
  })
})
