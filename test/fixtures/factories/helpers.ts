/**
 * Shared utilities for test fixture factories.
 */

/**
 * Returns an ISO date string (YYYY-MM-DD) for a given number of days ago.
 */
export function isoDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns an ISO timestamp string for a given number of days ago.
 */
export function isoTimestamp(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
  'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore',
  'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam',
  'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip',
];

/**
 * Returns a lorem-style placeholder string with the requested number of words.
 */
export function placeholderText(words: number): string {
  const result: string[] = [];
  for (let i = 0; i < words; i++) {
    result.push(LOREM_WORDS[i % LOREM_WORDS.length]);
  }
  return result.join(' ');
}

export interface Last90DaysEntry {
  date: string;
  count: number;
  uniquePlaces: number;
  totalDurationMinutes: number;
}

/**
 * Generates an array of 90 daily entries for location heatmap testing.
 * - 'full': every day has activity
 * - 'sparse': roughly 1 in 3 days has activity
 * - 'normal': roughly 2 in 3 days has activity
 */
export function last90DaysEntries(density: 'sparse' | 'full' | 'normal'): Last90DaysEntry[] {
  const entries: Last90DaysEntry[] = [];
  for (let i = 89; i >= 0; i--) {
    const hasActivity =
      density === 'full'
        ? true
        : density === 'normal'
        ? i % 3 !== 0
        : i % 3 === 0;

    entries.push({
      date: isoDate(i),
      count: hasActivity ? 2 + (i % 4) : 0,
      uniquePlaces: hasActivity ? 1 + (i % 3) : 0,
      totalDurationMinutes: hasActivity ? 60 + (i % 5) * 30 : 0,
    });
  }
  return entries;
}
