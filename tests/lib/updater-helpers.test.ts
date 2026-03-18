import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { esc, getCategoryColor, formatRelativeTime } from '../../src/lib/updaters';

describe('esc', () => {
  it('returns empty string for null', () => {
    expect(esc(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(esc(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(esc('')).toBe('');
  });

  it('escapes ampersands', () => {
    expect(esc('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes < and >', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(esc('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes a full XSS payload', () => {
    const input = '<img src="x" onerror="alert(1)">';
    const result = esc(input);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
    expect(result).toBe('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
  });

  it('escapes multiple ampersands', () => {
    expect(esc('a & b & c')).toBe('a &amp; b &amp; c');
  });

  it('passes through plain text unchanged', () => {
    expect(esc('Hello World')).toBe('Hello World');
  });

  it('does not escape single quotes', () => {
    expect(esc("it's fine")).toBe("it's fine");
  });
});

describe('getCategoryColor', () => {
  const categories = [
    ['Dining',             'var(--neon-orange, #ff6b00)'],
    ['Fitness & Outdoors', 'var(--neon-green, #06d6a0)'],
    ['Shopping',           'var(--neon-purple, #a855f7)'],
    ['Entertainment',      'var(--neon-pink, #ff006e)'],
    ['Travel',             'var(--neon-cyan, #00d4ff)'],
    ['Health',             'var(--neon-red, #ef4444)'],
    ['Work',               'var(--neon-blue, #3a86ff)'],
    ['Education',          'var(--neon-indigo, #818cf8)'],
    ['Services',           'var(--neon-amber, #f59e0b)'],
  ] as const;

  categories.forEach(([category, expectedColor]) => {
    it(`returns correct color for "${category}"`, () => {
      expect(getCategoryColor(category)).toBe(expectedColor);
    });
  });

  it('returns fallback color for null', () => {
    expect(getCategoryColor(null)).toBe('var(--text-muted, #9ca3af)');
  });

  it('returns fallback color for unknown category', () => {
    expect(getCategoryColor('UnknownCategory')).toBe('var(--text-muted, #9ca3af)');
  });

  it('returns fallback color for empty string', () => {
    expect(getCategoryColor('')).toBe('var(--text-muted, #9ca3af)');
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-03-17T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "0m ago" for a timestamp equal to now', () => {
    expect(formatRelativeTime('2026-03-17T12:00:00.000Z')).toBe('0m ago');
  });

  it('returns minutes for timestamps < 1 hour ago', () => {
    expect(formatRelativeTime('2026-03-17T11:30:00.000Z')).toBe('30m ago');
  });

  it('returns "1m ago" for 90 seconds ago', () => {
    expect(formatRelativeTime('2026-03-17T11:58:30.000Z')).toBe('1m ago');
  });

  it('returns "59m ago" for 59 minutes ago', () => {
    expect(formatRelativeTime('2026-03-17T11:01:00.000Z')).toBe('59m ago');
  });

  it('returns hours for timestamps 1-23 hours ago', () => {
    expect(formatRelativeTime('2026-03-17T10:00:00.000Z')).toBe('2h ago');
    expect(formatRelativeTime('2026-03-17T01:00:00.000Z')).toBe('11h ago');
  });

  it('boundary: exactly 60 minutes shows hours', () => {
    expect(formatRelativeTime('2026-03-17T11:00:00.000Z')).toBe('1h ago');
  });

  it('returns days for timestamps >= 24 hours ago', () => {
    expect(formatRelativeTime('2026-03-16T12:00:00.000Z')).toBe('1d ago');
    expect(formatRelativeTime('2026-03-10T12:00:00.000Z')).toBe('7d ago');
  });

  it('boundary: exactly 24 hours ago shows days', () => {
    expect(formatRelativeTime('2026-03-16T12:00:00.000Z')).toBe('1d ago');
  });

  it('returns "0m ago" for future timestamps (clamped at 0)', () => {
    // msAgo will be negative; minutesAgo is Math.max(0, ...)
    expect(formatRelativeTime('2026-03-17T13:00:00.000Z')).toBe('0m ago');
  });
});
