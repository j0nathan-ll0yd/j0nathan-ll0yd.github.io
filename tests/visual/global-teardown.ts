import {createRequire} from 'node:module'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'path'
import type {FullConfig} from '@playwright/test'

/**
 * Front-loaded lossless PNG optimization for the committed visual baselines.
 *
 * Runs ONLY on a snapshot-regeneration pass (`--update-snapshots`), never on a
 * compare pass, so it optimizes the exact bytes that get committed while never
 * rewriting baselines during a validation run. Both invocation paths that
 * regenerate baselines execute this teardown inside the identical native
 * linux/arm64 Playwright-noble container (locally via scripts/run-in-docker.sh,
 * in CI on the self-hosted arm64 runner built FROM the same image), so the
 * optimization is byte-for-byte identical across them — the load-bearing
 * property the whole suite depends on.
 *
 * Optimizer: oxipng via @napi-rs/image's `losslessCompressPngSync`.
 *   - The plain `oxipng` npm package is NOT usable here: it branches only on
 *     process.platform (never process.arch) and blindly execs a bundled
 *     x86_64-unknown-linux-musl binary on any Linux. In this container that is
 *     an aarch64 host with no QEMU/Rosetta, so the x86_64 ELF fails with
 *     `Exec format error`. It ships no aarch64 binary at all.
 *   - @napi-rs/image ships a real linux-arm64-gnu prebuilt (resolved from
 *     node_modules by npm's platform-optional-dependency mechanism, no
 *     postinstall network fetch) and is verified deterministic + idempotent on
 *     arm64: opt(x) == opt(x) and opt(opt(x)) == opt(x).
 *
 * Options rationale:
 *   - filter: [0..4] tries all five canonical PNG row filters (None, Sub, Up,
 *     Average, Paeth) — maximal filter search for the smallest lossless result.
 *   - strip: false — keep every ancillary chunk. This is stricter than the
 *     plan's `--strip safe`; @napi-rs exposes only all-or-nothing stripping,
 *     and dropping colour-management chunks (gAMA/sRGB/iCCP) could shift how a
 *     reviewer's colour-managed viewer renders the PNG. Chromium screenshots
 *     carry negligible metadata, so keeping it costs ~nothing in size.
 *
 * The optimization is lossless (decoded RGBA is unchanged), which the very next
 * `pnpm run test:visual` compare proves by staying green against the optimized
 * baselines.
 */

const require = createRequire(import.meta.url)
const {losslessCompressPngSync} = require('@napi-rs/image') as {
  losslessCompressPngSync: (input: Buffer, options?: {filter?: number[]; strip?: boolean}) => Buffer
}

const OXIPNG_OPTIONS: {filter: number[]; strip: boolean} = {filter: [0, 1, 2, 3, 4], strip: false}
const SCREENSHOTS_DIR = path.join(import.meta.dirname, '__screenshots__')

/** Recursively collect every .png under a directory. */
function collectPngs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectPngs(full))
    } else if (entry.isFile() && entry.name.endsWith('.png')) {
      out.push(full)
    }
  }
  return out
}

export default async function globalTeardown(config: FullConfig): Promise<void> {
  // Only rewrite bytes on a regeneration pass. A bare compare run leaves
  // updateSnapshots as 'missing'/'none' and must not touch committed baselines.
  if (config.updateSnapshots !== 'all' && config.updateSnapshots !== 'changed') {
    return
  }

  const files = collectPngs(SCREENSHOTS_DIR)
  if (files.length === 0) {
    // A regeneration pass that produced no baselines is a real failure, not a
    // no-op — fail loudly rather than silently "succeeding".
    throw new Error(`[teardown] oxipng: no PNG baselines found under ${SCREENSHOTS_DIR}`)
  }

  let optimized = 0
  for (const file of files) {
    const input = readFileSync(file)
    let output: Buffer
    try {
      output = losslessCompressPngSync(input, {...OXIPNG_OPTIONS})
    } catch (err) {
      // Throw on failure so a broken optimizer fails the run instead of
      // committing un-optimized (or partially-optimized) baselines.
      throw new Error(`[teardown] oxipng failed on ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (Buffer.compare(input, output) !== 0) {
      writeFileSync(file, output)
      optimized++
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[teardown] oxipng optimized ${optimized} of ${files.length} files`)
}
