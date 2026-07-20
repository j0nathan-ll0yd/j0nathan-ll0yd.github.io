/**
 * Strip trailing bytes after the PNG IEND chunk's CRC.
 *
 * Chromium's CDP Page.captureScreenshot in CI Docker occasionally emits PNG bytes
 * with garbage after the IEND chunk's CRC trailer. Per W3C TR/png §11.2.5, the
 * IEND chunk marks end-of-stream; trailing bytes are non-conformant. Playwright's
 * bundled pngjs strict-rejects these buffers with "unrecognised content at end of
 * stream" (sync-reader.js:43). PIL and `file` ignore the garbage.
 *
 * The PNG IEND chunk has format:
 *   length(4)   = 00 00 00 00
 *   type(4)     = 49 45 4E 44 ("IEND")
 *   data(0)     = (empty)
 *   CRC(4)      = AE 42 60 82  (pre-computed constant since type+data are constant)
 *
 * The 8-byte trailing signature `49 45 4E 44 AE 42 60 82` is unique to PNG end-of-stream.
 * We use `indexOf` (FIRST occurrence) because pngjs's parser stops at the FIRST
 * IEND chunk it sees. If Chromium emits a buffer where the trailing garbage
 * contains a partial or duplicate IEND signature near the end, lastIndexOf would
 * find the trailing one and not cut, leaving pngjs to barf on everything after
 * the first IEND. indexOf cuts at the same position pngjs's parser stops at.
 *
 * IDAT data is deflate-compressed; the chance of the 8-byte literal sequence
 * appearing inside IDAT bytes is ~1/2^64 per offset (astronomically unlikely).
 */

const IEND_SIGNATURE = Buffer.from([
  0x49,
  0x45,
  0x4e,
  0x44, // "IEND" chunk type
  0xae,
  0x42,
  0x60,
  0x82 // pre-computed CRC for empty IEND
])

export function truncateAtIEND(buf: Buffer): Buffer {
  if (!Buffer.isBuffer(buf) || buf.length < IEND_SIGNATURE.length + 8) {
    // 8 = PNG signature size; not enough room for a valid PNG
    return buf
  }
  const idx = buf.indexOf(IEND_SIGNATURE)
  if (idx === -1) {
    return buf
  }
  const end = idx + IEND_SIGNATURE.length
  return end === buf.length ? buf : buf.subarray(0, end)
}
