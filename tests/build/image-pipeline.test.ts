import {describe, expect, it} from 'vitest'
import {existsSync, readdirSync, readFileSync, statSync} from 'fs'
import path from 'path'
import {createRequire} from 'module'

const rootDir = process.cwd()
const distDir = path.resolve(rootDir, 'dist')

// atlas decision 0086 (W3). The CSP no longer allows these hosts, so a build
// that still emits one of them renders a broken cover in production rather than
// a hot-linked one. Asserting on the emitted output catches a widget regression
// that a source-level grep would miss.
const THIRD_PARTY_IMAGE_HOSTS = ['m.media-amazon.com', 'images.squarespace-cdn.com', 'books.google.com']

// Binary assets cannot contain a host string in a form that matters here, and
// reading them as utf-8 is wasted work on every run.
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.json', '.css', '.txt', '.xml', '.webmanifest', '.svg'])

function textFilesUnder(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return textFilesUnder(full)
    }
    return TEXT_EXTENSIONS.has(path.extname(entry.name)) ? [full] : []
  })
}

// Book-image coverage (every book ASIN has a pre-fetched local webp) is no
// longer asserted here: fixtures are DS-owned (Plan #04) and the SSR-shell
// books are synthetic, so they intentionally ship no local images. Real
// production book images are fetched from CloudFront at build (fetch:images)
// and cached by the service worker; that pipeline is unchanged.
describe('Image Pipeline', () => {
  describe('dist/ artifacts', () => {
    it('dist/sw.js exists', () => {
      const swPath = path.join(distDir, 'sw.js')
      expect(existsSync(swPath)).toBe(true)
    })

    it('dist/manifest.webmanifest exists', () => {
      const manifestPath = path.join(distDir, 'manifest.webmanifest')
      expect(existsSync(manifestPath)).toBe(true)
    })

    it('dist/manifest.webmanifest is valid JSON', () => {
      const manifestPath = path.join(distDir, 'manifest.webmanifest')
      const content = readFileSync(manifestPath, 'utf-8')
      expect(() => JSON.parse(content)).not.toThrow()
    })

    it('dist/manifest.webmanifest has required PWA fields', () => {
      const manifestPath = path.join(distDir, 'manifest.webmanifest')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(manifest.name).toBeTruthy()
      expect(manifest.icons).toBeDefined()
    })

    it('dist/index.html exists', () => {
      const indexPath = path.join(distDir, 'index.html')
      expect(existsSync(indexPath)).toBe(true)
    })

    it('dist/index.html is non-empty', () => {
      const indexPath = path.join(distDir, 'index.html')
      const stat = statSync(indexPath)
      expect(stat.size).toBeGreaterThan(0)
    })
  })

  describe('first-party image sources (atlas decision 0086)', () => {
    it.each(THIRD_PARTY_IMAGE_HOSTS)('no emitted file references %s', (host) => {
      const offenders = textFilesUnder(distDir).filter((file) => readFileSync(file, 'utf-8').includes(host)).map((file) => path.relative(distDir, file))
      expect(offenders).toEqual([])
    })

    it('every book cover resolves to CloudFront or a same-origin path', () => {
      const html = readFileSync(path.join(distDir, 'index.html'), 'utf-8')
      const covers = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((src) => src.includes('/images/'))
      expect(covers.length).toBeGreaterThan(0)
      for (const src of covers) {
        expect(src.startsWith('https://d1pfm520aduift.cloudfront.net/') || src.startsWith('/')).toBe(true)
      }
    })

    // The widget's fallback target is a bare path, so the consumer has to serve
    // the asset. Without this copy every broken cover 404s instead of degrading.
    it('serves the placeholder the widget falls back to, byte-identical to the package asset', () => {
      const served = path.join(rootDir, 'public', 'images', 'no-cover.svg')
      expect(existsSync(served)).toBe(true)
      const packaged = createRequire(import.meta.url).resolve('@j0nathan-ll0yd/web/assets/no-cover.svg')
      expect(readFileSync(served)).toEqual(readFileSync(packaged))
      expect(existsSync(path.join(distDir, 'images', 'no-cover.svg'))).toBe(true)
    })
  })
})
