/**
 * Pure-function predicates extracted from tests/visual/helpers.ts navigateAndWait.
 * Used inside page.waitForFunction(...) — serialized into the browser context.
 *
 * IMPORTANT: page.waitForFunction serializes its callback to a string, so these
 * predicates CANNOT be imported by reference inside the callback. They are
 * exported here for vitest unit testing only; helpers.ts contains an inlined
 * copy of the same logic. If you modify one, update the other.
 */

/** Returns true if all images in the array report complete=true. Empty array returns true. */
export function allImagesComplete(imgs: ReadonlyArray<{complete: boolean}>): boolean {
  return imgs.every((img) => img.complete)
}

/** Returns true if all scrollHeight reads are equal (i.e., layout has stabilized). */
export function scrollHeightStable(reads: ReadonlyArray<number>): boolean {
  if (reads.length === 0) {
    return true
  }
  return reads.every((v) => v === reads[0])
}
