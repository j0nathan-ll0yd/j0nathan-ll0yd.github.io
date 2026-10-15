import {createRequire} from 'node:module'
import {expect, test} from '@playwright/test'

// The obfuscated email links on /privacy and /contact, as a visitor uses them (atlas decision 0158). Behavioral DOM
// assertions: with JavaScript the link is a working mailto link with the address as its accessible
// name; without JavaScript it is a real link to the page's no-JavaScript target and the address
// appears nowhere.

const copyRequire = createRequire(import.meta.url)
const identity = copyRequire('@j0nathan-ll0yd/copy/identity.flat.json') as {person: {email: string}; contact: {title: string}}

// /privacy names the address twice and falls back to /contact; /contact names it in the email
// channel and the security note and falls back to security.txt (owner ruling 2026-10-15).
const PAGES = [
  {path: '/privacy', fallback: '/contact'},
  {path: '/contact', fallback: '/.well-known/security.txt'}
]
for (const {path, fallback} of PAGES) {
  test.describe(`email obfuscation on ${path}`, () => {
    test('decodes to a keyboard-reachable mailto link with the address as its name', async ({page}) => {
      await page.goto(path)
      const link = page.getByRole('link', {name: identity.person.email}).first()
      await expect(link).toHaveAttribute('href', `mailto:${identity.person.email}`)
      await expect(page.locator('a[data-email]')).toHaveCount(0)
      await link.focus()
      await expect(link).toBeFocused()
    })

    test.describe('without JavaScript', () => {
      test.use({javaScriptEnabled: false})

      test(`shows real links to ${fallback} and no address`, async ({page}) => {
        await page.goto(path)
        const placeholders = page.locator('a[data-email]')
        await expect(placeholders).toHaveCount(2)
        for (const placeholder of await placeholders.all()) {
          await expect(placeholder).toHaveAttribute('href', fallback)
        }
        await expect(placeholders.first()).toHaveText(identity.contact.title)
        expect(await page.content()).not.toContain(identity.person.email)
      })
    })
  })
}
