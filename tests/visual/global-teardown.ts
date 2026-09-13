import {createRequire} from 'node:module'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'path'
import type {FullConfig} from '@playwright/test'

/**
 * Optimizes committed PNG baselines only during snapshot regeneration. Local and CI regeneration
 * use the same native linux/arm64 container, so output stays byte-identical.
 *
 * `@napi-rs/image` supplies the required arm64 oxipng binary. Trying every PNG filter minimizes
 * losslessly; metadata remains because stripping color profiles can change review-tool rendering.
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
