import {createRequire} from 'node:module'
import {expect, test} from '@playwright/test'

// The obfuscated email link on /privacy, as a visitor uses it (atlas decision 0158). Behavioral DOM
// assertions: with JavaScript the link is a working mailto link with the address as its accessible
// name; without JavaScript it is a real link to the contact page and the address appears nowhere.

const copyRequire = createRequire(import.meta.url)
const identity = copyRequire('@j0nathan-ll0yd/copy/identity.flat.json') as {person: {email: string}; contact: {title: string}}

// /privacy names the address twice; /contact names it in the email channel and the security note.
for (const path of ['/privacy', '/contact']) {
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

      test('shows a link to the contact page and no address', async ({page}) => {
        await page.goto(path)
        const placeholders = page.locator('a[data-email]')
        await expect(placeholders).toHaveCount(2)
        await expect(placeholders.first()).toHaveAttribute('href', '/contact')
        await expect(placeholders.first()).toHaveText(identity.contact.title)
        expect(await page.content()).not.toContain(identity.person.email)
      })
    })
  })
}
