import {describe, expect, it} from 'vitest'
import {existsSync, readdirSync, readFileSync, statSync} from 'fs'
import path from 'path'
import {createRequire} from 'module'
import {load} from 'cheerio'
import {isAllowedImageUrl, srcsetCandidates} from '../image-url-allowlist'

const rootDir = process.cwd()
const distDir = path.resolve(rootDir, 'dist')

function htmlFilesUnder(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return htmlFilesUnder(full)
    }
    return path.extname(entry.name) === '.html' ? [full] : []
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
    it('allowlists every emitted img/source src and srcset candidate', () => {
      const offenders: Array<{file: string; element: string; attribute: string; url: string}> = []
      let candidateCount = 0

      for (const file of htmlFilesUnder(distDir)) {
        const $ = load(readFileSync(file, 'utf-8'))
        for (const element of ['img', 'source']) {
          $(element).each((_index, node) => {
            const src = $(node).attr('src')
            const srcset = $(node).attr('srcset')
            const candidates = [
              ...(src ? [{attribute: 'src', url: src}] : []),
              ...srcsetCandidates(srcset || '').map((url) => ({attribute: 'srcset', url}))
            ]
            candidateCount += candidates.length
            for (const candidate of candidates) {
              if (!isAllowedImageUrl(candidate.url)) {
                offenders.push({file: path.relative(distDir, file), element, ...candidate})
              }
            }
          })
        }
      }

      expect(candidateCount).toBeGreaterThan(0)
      expect(offenders).toEqual([])
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
