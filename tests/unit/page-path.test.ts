import {describe, expect, it} from 'vitest'
import {pagePath} from '../../src/lib/page-path'

describe('pagePath', () => {
  it.each([
    ['/index.html', '/'],
    ['/', '/'],
    ['/about.html', '/about'],
    ['/about', '/about'],
    ['/about/', '/about'],
    ['/404.html', '/404'],
    ['/docs/index.html', '/docs']
  ])('%j serves at %j', (pathname, served) => {
    expect(pagePath(pathname)).toBe(served)
  })
})
