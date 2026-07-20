import {describe, expect, it} from 'vitest'
import {allImagesComplete, scrollHeightStable} from '../visual/predicates'

describe('allImagesComplete', () => {
  it('returns true for empty array', () => {
    expect(allImagesComplete([])).toBe(true)
  })
  it('returns true when all images report complete', () => {
    expect(allImagesComplete([{complete: true}, {complete: true}])).toBe(true)
  })
  it('returns false when any image is incomplete', () => {
    expect(allImagesComplete([{complete: true}, {complete: false}])).toBe(false)
  })
  it('returns false when single image is incomplete', () => {
    expect(allImagesComplete([{complete: false}])).toBe(false)
  })
})

describe('scrollHeightStable', () => {
  it('returns true for empty array (no reads yet)', () => {
    expect(scrollHeightStable([])).toBe(true)
  })
  it('returns true for single read', () => {
    expect(scrollHeightStable([100])).toBe(true)
  })
  it('returns true for four equal reads', () => {
    expect(scrollHeightStable([100, 100, 100, 100])).toBe(true)
  })
  it('returns false if any read differs', () => {
    expect(scrollHeightStable([100, 100, 100, 101])).toBe(false)
  })
  it('returns false for first-read divergence', () => {
    expect(scrollHeightStable([100, 200, 100, 100])).toBe(false)
  })
  // [0,0,0,0] returns true (semantically: stable at zero); real usage wraps
  // this in waitForFunction timeout to fail if page never loads.
  it('returns true for [0,0,0,0] (caller guards against zero via timeout)', () => {
    expect(scrollHeightStable([0, 0, 0, 0])).toBe(true)
  })
})
