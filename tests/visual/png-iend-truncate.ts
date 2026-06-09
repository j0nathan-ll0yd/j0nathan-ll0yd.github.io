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
 * We use `lastIndexOf` for safety against the astronomically-unlikely case of the
 * literal sequence appearing inside compressed IDAT data — scanning from the end
 * guarantees we cut at the actual trailing IEND.
 */

const IEND_SIGNATURE = Buffer.from([
  0x49, 0x45, 0x4e, 0x44, // "IEND" chunk type
  0xae, 0x42, 0x60, 0x82, // pre-computed CRC for empty IEND
]);

export function truncateAtIEND(buf: Buffer): Buffer {
  if (!Buffer.isBuffer(buf) || buf.length < IEND_SIGNATURE.length + 8) {
    // 8 = PNG signature size; not enough room for a valid PNG
    return buf;
  }
  const idx = buf.lastIndexOf(IEND_SIGNATURE);
  if (idx === -1) return buf;
  const end = idx + IEND_SIGNATURE.length;
  return end === buf.length ? buf : buf.subarray(0, end);
}
