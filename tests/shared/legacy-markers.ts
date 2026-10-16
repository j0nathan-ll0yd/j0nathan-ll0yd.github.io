// The values the pre-0160 page rendered as if they were live, as a marker set for the server render
// (atlas decision 0160, plan Step 6.3).
//
// The set is the legacy post-adapter `baseline` fixtures of @j0nathan-ll0yd/fixtures (the data the
// page shipped before PR 0a), minus every value the `ssr-known-answer` inputs carry, minus every
// value the data-free page legitimately holds (authored identity copy). A correct render of the
// known-answer inputs therefore cannot trip a marker, and a leaked legacy value always does.
//
// The fixtures package ships TypeScript sources that Playwright's runner cannot load from
// node_modules, so this module reads the package's JSON files directly.
import {readdirSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {FIXTURE_SENTINELS, RETIRED_OVERLAY_ROWS} from './fixture-sentinels'

const require = createRequire(import.meta.url)
const fixturesRoot = path.dirname(require.resolve('@j0nathan-ll0yd/fixtures/fixture-map.json'))
const postAdapterDir = path.join(fixturesRoot, 'src', 'post-adapter')

/** The smallest string worth treating as a marker: shorter ones collide with ordinary page text. */
const MIN_MARKER_LENGTH = 12

function stringLeaves(node: unknown, into: Set<string>): void {
  if (typeof node === 'string') {
    into.add(node)
  } else if (Array.isArray(node)) {
    node.forEach((child) => stringLeaves(child, into))
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((child) => stringLeaves(child, into))
  }
}

/** Every string leaf of the legacy post-adapter baseline data (the authored profile excluded). */
export function legacyBaselineStrings(): string[] {
  const strings = new Set<string>()
  for (const file of readdirSync(postAdapterDir).filter((name) => name.endsWith('.baseline.json') && !name.startsWith('profile.'))) {
    stringLeaves(JSON.parse(readFileSync(path.join(postAdapterDir, file), 'utf8')), strings)
  }
  return [...strings]
}

/**
 * The marker strings: long legacy values, plus the named sentinels, minus any value that appears in
 * `allowedText` (the known-answer inputs and the data-free page text).
 */
export function legacyMarkers(allowedText: string): string[] {
  const candidates = [...legacyBaselineStrings().filter((value) => value.length >= MIN_MARKER_LENGTH), ...FIXTURE_SENTINELS.map((s) => s.text)]
  return [...new Set(candidates)].filter((value) => !allowedText.includes(value))
}

export { RETIRED_OVERLAY_ROWS }
