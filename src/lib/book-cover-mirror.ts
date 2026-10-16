import {readdirSync} from 'node:fs'
import {join} from 'node:path'

// The committed book-cover mirror (`scripts/fetch-images.mjs`), listed at BUILD time in Node.
//
// astro.config.mjs passes the list to every bundle as the `__MIRRORED_BOOK_COVERS__` constant, so the
// Worker's server render (atlas decision 0160, PR B) needs no filesystem: workerd has none to read.

/** The compile-time constant that carries the list. */
export const MIRRORED_BOOK_COVERS_DEFINE = '__MIRRORED_BOOK_COVERS__'

/** Root-relative paths of the committed book-cover mirror, sorted, dot files skipped. */
export function mirroredBookCovers(publicDir: string = join(process.cwd(), 'public')): string[] {
  return readdirSync(join(publicDir, 'images', 'books')).filter((name) => !name.startsWith('.')).sort().map((name) => `/images/books/${name}`)
}
