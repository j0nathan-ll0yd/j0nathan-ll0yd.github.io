import { describe, it, expect } from 'vitest';
import { truncateAtIEND } from '../visual/png-iend-truncate';

const IEND_SIG = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('truncateAtIEND', () => {
  it('returns empty buffer unchanged', () => {
    const buf = Buffer.alloc(0);
    expect(truncateAtIEND(buf)).toBe(buf);
  });

  it('returns undersized buffer unchanged (no room for header + IEND)', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(truncateAtIEND(buf)).toBe(buf);
  });

  it('returns unchanged when buffer ends exactly at IEND signature', () => {
    const buf = Buffer.concat([PNG_HEADER, Buffer.alloc(20), IEND_SIG]);
    expect(truncateAtIEND(buf)).toBe(buf);
  });

  it('truncates trailing garbage after IEND signature', () => {
    const trailing = Buffer.from([0x00, 0xff, 0xab, 0xcd, 0x12]);
    const dirty = Buffer.concat([PNG_HEADER, Buffer.alloc(20), IEND_SIG, trailing]);
    const cleaned = truncateAtIEND(dirty);
    expect(cleaned.length).toBe(PNG_HEADER.length + 20 + IEND_SIG.length);
    expect(cleaned.subarray(-IEND_SIG.length)).toEqual(IEND_SIG);
  });

  it('uses lastIndexOf so multiple IEND literals do not cut prematurely', () => {
    const decoy = IEND_SIG; // embedded literal earlier in the buffer
    const real = IEND_SIG;
    const trailing = Buffer.from([0xaa, 0xbb]);
    const dirty = Buffer.concat([PNG_HEADER, decoy, Buffer.alloc(50), real, trailing]);
    const cleaned = truncateAtIEND(dirty);
    expect(cleaned.length).toBe(dirty.length - trailing.length);
    expect(cleaned.subarray(-IEND_SIG.length)).toEqual(IEND_SIG);
  });

  it('returns buffer unchanged when IEND signature is absent', () => {
    const buf = Buffer.concat([PNG_HEADER, Buffer.alloc(30)]);
    expect(truncateAtIEND(buf)).toBe(buf);
  });

  it('passes through non-Buffer inputs unchanged (defensive)', () => {
    // @ts-expect-error — testing runtime guard
    expect(truncateAtIEND('not a buffer')).toBe('not a buffer');
  });

  it('truncated buffer can be re-truncated idempotently', () => {
    const trailing = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const dirty = Buffer.concat([PNG_HEADER, Buffer.alloc(10), IEND_SIG, trailing]);
    const once = truncateAtIEND(dirty);
    const twice = truncateAtIEND(once);
    expect(twice.length).toBe(once.length);
    expect(twice).toEqual(once);
  });
});
