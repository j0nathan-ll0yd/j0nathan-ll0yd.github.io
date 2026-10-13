import {readdirSync} from 'node:fs'
import {join} from 'node:path'
import {composeSystemLines} from '@j0nathan-ll0yd/web/runtime/view-models'
import {type IdentityProfile, identityProfile} from './identity-profile'

/**
 * The data `/` renders at build time: authored identity content and nothing measured.
 *
 * Production `/` carries no fixture data (atlas decision 0160, PR 0a). Every live widget renders
 * its `loading` state with the `<noscript>` note, and the client runtime
 * (`src/lib/runtime/live-data.ts`) fills live data after load. This version is the rollback target
 * for every later 0160 change (D9); there is no fixture rollback.
 *
 * `@j0nathan-ll0yd/fixtures` is a devDependency for tests only. The `forbid-fixtures` Vite plugin
 * (`scripts/vite-forbid-fixtures.mjs`) fails the build when any module resolves to it.
 */
export interface DashboardData {
  /** IdentityCard and BioTerminal props, from `@j0nathan-ll0yd/copy`. */
  profile: IdentityProfile
  /** System Status rows: one per source, each showing the no-reading mark until the client reads it. */
  system: {lines: ReturnType<typeof loadingSystemLines>}
  /** Same-origin cover paths mirrored under `public/images/books/` (Bookshelf `localCovers`). */
  localCovers: string[]
}

/**
 * System Status rows with no export read yet. A row names no status, age or timestamp: OFFLINE
 * would be a claim the page has not measured. The rows reuse the design system's non-data row
 * shape (`composeSystemLines` with `suppressed`) without the suppressed marker, so
 * `updateSystemStatus` fills them as soon as the client reads an export.
 */
export function loadingSystemLines() {
  return composeSystemLines({}, 0, {suppressed: true}).map((line) => {
    const row = {...line}
    delete row.suppressed
    return row
  })
}

/** Root-relative paths of the committed book-cover mirror (`scripts/fetch-images.mjs`). */
export function mirroredBookCovers(publicDir: string = join(process.cwd(), 'public')): string[] {
  return readdirSync(join(publicDir, 'images', 'books')).filter((name) => !name.startsWith('.')).sort().map((name) => `/images/books/${name}`)
}

/** Runs only at Astro build time. The build reads no network and no fixture. */
export function loadDashboardData(): DashboardData {
  return {profile: identityProfile(), system: {lines: loadingSystemLines()}, localCovers: mirroredBookCovers()}
}
