import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  adaptHealth,
  adaptSleep,
  adaptWorkouts,
  adaptGithubEvents,
  adaptBooks,
  adaptArticles,
} from '../../src/lib/adapters';
import { HYDRATION, STATUS_LABELS } from '../../src/lib/constants';
import type { HealthExport, SleepExport, WorkoutsExport, BooksExport, GithubEventsExport, ArticlesExport } from '../../src/types/exports';

// ── Fixture factories ─────────────────────────────────────────────

function makeHealth(overrides: Partial<HealthExport['quantities']> = {}): HealthExport {
  return {
    date: '2026-01-15',
    generatedAt: '2026-01-15T10:30:00Z',
    quantities: {
      heartRate: { value: 72, unit: 'bpm' },
      stepCount: { value: 8432, unit: 'count' },
      activeEnergyBurned: { value: 450, unit: 'kcal' },
      basalEnergyBurned: { value: 1800, unit: 'kcal' },
      dietaryWater: { value: 2839.14, unit: 'mL' },   // ~96 oz
      dietaryCaffeine: { value: 0.28, unit: 'g' },    // 280 mg
      heartRateVariabilitySDNN: { value: 45, unit: 'ms' },
      exerciseTime: { value: 30, unit: 'min' },
      sleepScore: { value: 82, unit: 'score' },
      ...overrides,
    },
  };
}

function makeSleep(overrides: Partial<SleepExport> = {}): SleepExport {
  return {
    date: '2026-01-15',
    generatedAt: '2026-01-15T08:00:00Z',
    rem: { seconds: 5400 },    // 1h 30m
    deep: { seconds: 3600 },   // 1h 0m
    core: { seconds: 10800 },  // 3h 0m
    awake: { seconds: 900 },   // 15m
    ...overrides,
  };
}

function makeWorkouts(overrides: Partial<WorkoutsExport> = {}): WorkoutsExport {
  return {
    date: '2026-01-15',
    generatedAt: '2026-01-15T10:30:00Z',
    workouts: [
      { activityType: 'Other', duration: 55, energyBurned: 620, distance: null, source: 'Apple Watch' },
      { activityType: 'Running', duration: 32, energyBurned: 380, distance: 4.2, source: 'Apple Watch' },
    ],
    ...overrides,
  };
}

function makeGithubEvents(events: GithubEventsExport['events'] = []): GithubEventsExport {
  return {
    generatedAt: '2026-01-15T10:30:00Z',
    events,
  };
}

function makeBooks(bookOverrides: Partial<BooksExport['books'][0]>[] = []): BooksExport {
  const defaultBook: BooksExport['books'][0] = {
    asin: 'B000TEST01',
    title: 'Test Book',
    author: 'Test Author',
    series: null,
    seriesNumber: null,
    seriesTotal: null,
    description: 'A test book.',
    publicationDate: null,
    publishedYear: 2022,
    isbn10: null,
    isbn13: null,
    pageCount: 300,
    mainImage: null,
    mainImageThumb: null,
    images: null,
    averageRating: null,
    category: 'Technology > Software',
    status: 'reading',
    currentPage: 150,
    totalPages: 300,
    rating: null,
    notes: null,
  };
  return {
    generatedAt: '2026-01-15T10:30:00Z',
    books: bookOverrides.length > 0
      ? bookOverrides.map((o) => ({ ...defaultBook, ...o }))
      : [defaultBook],
  };
}

function makeArticles(articles: ArticlesExport['articles'] = []): ArticlesExport {
  return {
    generatedAt: '2026-01-15T10:30:00Z',
    articles,
  };
}

// ── adaptHealth ───────────────────────────────────────────────────

describe('adaptHealth', () => {
  it('renames heartRateVariabilitySDNN to hrvSDNN', () => {
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.quantities).toHaveProperty('hrvSDNN');
    expect(result.quantities).not.toHaveProperty('heartRateVariabilitySDNN');
  });

  it('preserves the hrvSDNN value after rename', () => {
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.quantities.hrvSDNN.value).toBe(45);
  });

  it('does not add hrvSDNN if heartRateVariabilitySDNN is absent', () => {
    const health = makeHealth();
    delete (health.quantities as any).heartRateVariabilitySDNN;
    const result = adaptHealth(health, makeSleep());
    expect(result.quantities).not.toHaveProperty('hrvSDNN');
  });

  it('defaults exerciseTime to 0 min when missing', () => {
    const health = makeHealth();
    delete (health.quantities as any).exerciseTime;
    const result = adaptHealth(health, makeSleep());
    expect(result.quantities.exerciseTime).toEqual({ value: 0, unit: 'min' });
  });

  it('does not override exerciseTime when already present', () => {
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.quantities.exerciseTime.value).toBe(30);
  });

  it('converts dietaryWater mL to oz (÷29.5735, rounded)', () => {
    // 2839.14 mL / 29.5735 ≈ 96
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.hydration.waterOz).toBe(96);
  });

  it('returns 0 waterOz when dietaryWater is absent', () => {
    const health = makeHealth();
    delete (health.quantities as any).dietaryWater;
    const result = adaptHealth(health, makeSleep());
    expect(result.hydration.waterOz).toBe(0);
  });

  it('converts dietaryCaffeine grams to mg (×1000, rounded)', () => {
    // 0.28g × 1000 = 280mg
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.hydration.caffeineMg).toBe(280);
  });

  it('returns 0 caffeineMg when dietaryCaffeine is absent', () => {
    const health = makeHealth();
    delete (health.quantities as any).dietaryCaffeine;
    const result = adaptHealth(health, makeSleep());
    expect(result.hydration.caffeineMg).toBe(0);
  });

  it('computes totalCalories = activeEnergyBurned + basalEnergyBurned', () => {
    // 450 + 1800 = 2250
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.derived.totalCalories).toBe(2250);
  });

  it('rounds totalCalories', () => {
    const health = makeHealth({
      activeEnergyBurned: { value: 450.7, unit: 'kcal' },
      basalEnergyBurned: { value: 1800.4, unit: 'kcal' },
    });
    const result = adaptHealth(health, makeSleep());
    expect(result.derived.totalCalories).toBe(2251);
  });

  it('defaults totalCalories to 0 when energy fields absent', () => {
    const health = makeHealth();
    delete (health.quantities as any).activeEnergyBurned;
    delete (health.quantities as any).basalEnergyBurned;
    const result = adaptHealth(health, makeSleep());
    expect(result.derived.totalCalories).toBe(0);
  });

  it('includes HYDRATION constants in hydration object', () => {
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.hydration.waterMax).toBe(HYDRATION.waterMax);
    expect(result.hydration.caffeineMax).toBe(HYDRATION.caffeineMax);
    expect(result.hydration.waterRangeLo).toBe(HYDRATION.waterRangeLo);
    expect(result.hydration.waterRangeHi).toBe(HYDRATION.waterRangeHi);
    expect(result.hydration.caffeineRangeLo).toBe(HYDRATION.caffeineRangeLo);
    expect(result.hydration.caffeineRangeHi).toBe(HYDRATION.caffeineRangeHi);
  });

  it('returns the health date', () => {
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.date).toBe('2026-01-15');
  });

  it('computes sleep percentages when sleepData provided', () => {
    // rem=5400, deep=3600, core=10800 → total=19800
    // deepPct=18, remPct=27, corePct=55
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.derived.deepPct).toBe(18);
    expect(result.derived.remPct).toBe(27);
    expect(result.derived.corePct).toBe(55);
  });

  it('returns zero sleep percentages when sleepData is null', () => {
    const result = adaptHealth(makeHealth(), null);
    expect(result.derived.deepPct).toBe(0);
    expect(result.derived.remPct).toBe(0);
    expect(result.derived.corePct).toBe(0);
  });

  it('returns empty sleepDurationFormatted when sleepData is null', () => {
    const result = adaptHealth(makeHealth(), null);
    expect(result.sleepDurationFormatted).toBe('');
  });

  it('formats sleepDurationFormatted when sleepData provided', () => {
    // rem+deep+core = 5400+3600+10800 = 19800s = 5h 30m
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.sleepDurationFormatted).toBe('5h 30m');
  });

  it('returns empty sleepPhaseFormatted when sleepData is null', () => {
    const result = adaptHealth(makeHealth(), null);
    expect(result.sleepPhaseFormatted).toEqual({});
  });

  it('returns formatted sleep phases when sleepData provided', () => {
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.sleepPhaseFormatted).toEqual({
      deep: '1h 0m',
      rem: '1h 30m',
      core: '3h 0m',
      awake: '15m',
    });
  });

  it('uses sleepScore from health quantities', () => {
    const result = adaptHealth(makeHealth(), makeSleep());
    expect(result.sleepScore).toBe(82);
  });
});

// ── adaptSleep ────────────────────────────────────────────────────

describe('adaptSleep', () => {
  it('isEmpty is false when sleep phases have seconds', () => {
    const result = adaptSleep(makeSleep(), makeHealth());
    expect(result.isEmpty).toBe(false);
  });

  it('isEmpty is true when all phases are 0 or absent', () => {
    const sleep: SleepExport = {
      date: '2026-01-15',
      generatedAt: '2026-01-15T08:00:00Z',
    };
    const result = adaptSleep(sleep, makeHealth());
    expect(result.isEmpty).toBe(true);
  });

  it('returns the sleep date', () => {
    const result = adaptSleep(makeSleep(), makeHealth());
    expect(result.date).toBe('2026-01-15');
  });

  it('uses sleepScore from healthData quantities', () => {
    const result = adaptSleep(makeSleep(), makeHealth());
    expect(result.sleepScore).toBe(82);
  });

  it('returns sleepScore 0 when healthData is null', () => {
    const result = adaptSleep(makeSleep(), null);
    expect(result.sleepScore).toBe(0);
  });

  it('formats sleepDurationFormatted correctly', () => {
    // rem+deep+core = 5400+3600+10800 = 19800s = 5h 30m
    const result = adaptSleep(makeSleep(), makeHealth());
    expect(result.sleepDurationFormatted).toBe('5h 30m');
  });

  it('formats sleepPhaseFormatted for each phase', () => {
    const result = adaptSleep(makeSleep(), makeHealth());
    expect(result.sleepPhaseFormatted.deep).toBe('1h 0m');
    expect(result.sleepPhaseFormatted.rem).toBe('1h 30m');
    expect(result.sleepPhaseFormatted.core).toBe('3h 0m');
    expect(result.sleepPhaseFormatted.awake).toBe('15m');
  });

  it('computes sleep percentages correctly', () => {
    // deep=3600, rem=5400, core=10800, total=19800
    const result = adaptSleep(makeSleep(), makeHealth());
    expect(result.derived.deepPct).toBe(18);
    expect(result.derived.remPct).toBe(27);
    expect(result.derived.corePct).toBe(55);
  });

  it('returns phases in seconds', () => {
    const result = adaptSleep(makeSleep(), makeHealth());
    expect(result.phases.rem).toBe(5400);
    expect(result.phases.deep).toBe(3600);
    expect(result.phases.core).toBe(10800);
    expect(result.phases.awake).toBe(900);
  });

  it('returns zero percentages when all phases are absent', () => {
    const sleep: SleepExport = {
      date: '2026-01-15',
      generatedAt: '2026-01-15T08:00:00Z',
    };
    const result = adaptSleep(sleep, makeHealth());
    expect(result.derived.deepPct).toBe(0);
    expect(result.derived.remPct).toBe(0);
    expect(result.derived.corePct).toBe(0);
  });
});

// ── adaptWorkouts ─────────────────────────────────────────────────

describe('adaptWorkouts', () => {
  it('returns null when input is null', () => {
    expect(adaptWorkouts(null)).toBeNull();
  });

  it('returns empty array for empty workouts list', () => {
    const result = adaptWorkouts({ ...makeWorkouts(), workouts: [] });
    expect(result).toEqual([]);
  });

  it('maps "Other" activityType to Barry\'s Bootcamp label', () => {
    const result = adaptWorkouts(makeWorkouts());
    expect(result![0].activityType).toBe("Barry's Bootcamp");
  });

  it('maps "Other" activityType with correct URL', () => {
    const result = adaptWorkouts(makeWorkouts());
    expect(result![0].activityUrl).toBe('https://share.barrys.com/jsvsl');
  });

  it('preserves unmapped activityType as-is', () => {
    const result = adaptWorkouts(makeWorkouts());
    expect(result![1].activityType).toBe('Running');
  });

  it('preserves no activityUrl for unmapped types', () => {
    const result = adaptWorkouts(makeWorkouts());
    expect(result![1].activityUrl).toBeUndefined();
  });

  it('preserves other workout fields for mapped entry', () => {
    const result = adaptWorkouts(makeWorkouts());
    expect(result![0].duration).toBe(55);
    expect(result![0].energyBurned).toBe(620);
    expect(result![0].source).toBe('Apple Watch');
  });

  it('preserves other workout fields for unmapped entry', () => {
    const result = adaptWorkouts(makeWorkouts());
    expect(result![1].duration).toBe(32);
    expect(result![1].distance).toBe(4.2);
  });

  it('handles workouts with null numeric fields', () => {
    const workouts = makeWorkouts({
      workouts: [{ activityType: 'Running', duration: null, energyBurned: null, distance: null, source: 'iPhone' }],
    });
    const result = adaptWorkouts(workouts);
    expect(result![0].duration).toBeNull();
    expect(result![0].energyBurned).toBeNull();
    expect(result![0].distance).toBeNull();
  });
});

// ── adaptGithubEvents ─────────────────────────────────────────────

describe('adaptGithubEvents', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array when input is null', () => {
    expect(adaptGithubEvents(null)).toEqual([]);
  });

  it('returns empty array when events array is empty', () => {
    const result = adaptGithubEvents(makeGithubEvents([]));
    expect(result).toEqual([]);
  });

  it('slices to at most 10 events', () => {
    const events = Array.from({ length: 15 }, (_, i) => ({
      type: 'commit',
      repo: 'org/repo',
      title: `Commit ${i}`,
      date: '2026-01-15',
      hash: `abc${i}`,
    }));
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result).toHaveLength(10);
  });

  it('strips org prefix from repo name', () => {
    const events = [{ type: 'commit', repo: 'myorg/my-repo', title: 'Test', date: '2026-01-01', hash: 'abc123' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].repo).toBe('my-repo');
  });

  it('preserves repo name without org prefix', () => {
    const events = [{ type: 'commit', repo: 'standalone-repo', title: 'Test', date: '2026-01-01', hash: 'abc123' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].repo).toBe('standalone-repo');
  });

  it('generates commit URL with full repo path and hash', () => {
    const events = [{ type: 'commit', repo: 'myorg/my-repo', title: 'Fix bug', date: '2026-01-01', hash: 'deadbeef' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].url).toBe('https://github.com/myorg/my-repo/commit/deadbeef');
  });

  it('generates PR URL for pr_ event types', () => {
    const events = [{ type: 'pr_opened', repo: 'myorg/my-repo', title: 'New PR', date: '2026-01-01', number: 42 }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].url).toBe('https://github.com/myorg/my-repo/pull/42');
  });

  it('generates PR URL for pr_merged event type', () => {
    const events = [{ type: 'pr_merged', repo: 'myorg/my-repo', title: 'Merged PR', date: '2026-01-01', number: 99 }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].url).toBe('https://github.com/myorg/my-repo/pull/99');
  });

  it('generates issues URL for issue_ event types', () => {
    const events = [{ type: 'issue_opened', repo: 'myorg/my-repo', title: 'Bug', date: '2026-01-01', number: 7 }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].url).toBe('https://github.com/myorg/my-repo/issues/7');
  });

  it('returns empty URL for unknown event type without number/hash', () => {
    const events = [{ type: 'unknown_type', repo: 'myorg/my-repo', title: 'Something', date: '2026-01-01' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].url).toBe('');
  });

  it('formats date as minutes ago for recent events', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const events = [{ type: 'commit', repo: 'org/repo', title: 'X', date: '2026-01-15T10:15:00Z', hash: 'abc' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].date).toBe('15m ago');
  });

  it('formats date as hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const events = [{ type: 'commit', repo: 'org/repo', title: 'X', date: '2026-01-15T07:00:00Z', hash: 'abc' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].date).toBe('3h ago');
  });

  it('formats date as days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const events = [{ type: 'commit', repo: 'org/repo', title: 'X', date: '2026-01-12T10:30:00Z', hash: 'abc' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].date).toBe('3d ago');
  });

  it('formats date as weeks ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const events = [{ type: 'commit', repo: 'org/repo', title: 'X', date: '2025-12-25T10:30:00Z', hash: 'abc' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].date).toBe('3w ago');
  });

  it('preserves non-ISO date strings unchanged', () => {
    const events = [{ type: 'commit', repo: 'org/repo', title: 'X', date: '3d ago', hash: 'abc' }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].date).toBe('3d ago');
  });

  it('preserves additions and deletions fields', () => {
    const events = [{ type: 'commit', repo: 'org/repo', title: 'X', date: '2026-01-01', hash: 'abc', additions: 10, deletions: 3 }];
    const result = adaptGithubEvents(makeGithubEvents(events));
    expect(result[0].additions).toBe(10);
    expect(result[0].deletions).toBe(3);
  });
});

// ── adaptBooks ────────────────────────────────────────────────────

describe('adaptBooks', () => {
  it('maps "reading" status to "in_progress"', () => {
    const books = makeBooks([{ status: 'reading' }]);
    const result = adaptBooks(books);
    expect(result.books[0].status).toBe('in_progress');
  });

  it('maps "upNext" status to "next"', () => {
    const books = makeBooks([{ status: 'upNext' }]);
    const result = adaptBooks(books);
    expect(result.books[0].status).toBe('next');
  });

  it('maps "completed" status to "completed"', () => {
    const books = makeBooks([{ status: 'completed' }]);
    const result = adaptBooks(books);
    expect(result.books[0].status).toBe('completed');
  });

  it('falls back to original status for unknown values', () => {
    const books = makeBooks([{ status: 'someUnknownStatus' }]);
    const result = adaptBooks(books);
    expect(result.books[0].status).toBe('someUnknownStatus');
  });

  it('defaults status to "next" when status is null', () => {
    const books = makeBooks([{ status: null }]);
    const result = adaptBooks(books);
    expect(result.books[0].status).toBe('next');
  });

  it('computes progress as percentage of currentPage/totalPages', () => {
    const books = makeBooks([{ currentPage: 150, totalPages: 300 }]);
    const result = adaptBooks(books);
    expect(result.books[0].progress).toBe(50);
  });

  it('rounds progress to nearest integer', () => {
    const books = makeBooks([{ currentPage: 1, totalPages: 3 }]);
    const result = adaptBooks(books);
    expect(result.books[0].progress).toBe(33);
  });

  it('returns undefined progress when currentPage is null', () => {
    const books = makeBooks([{ currentPage: null, totalPages: 300 }]);
    const result = adaptBooks(books);
    expect(result.books[0].progress).toBeUndefined();
  });

  it('returns undefined progress when totalPages is null', () => {
    const books = makeBooks([{ currentPage: 150, totalPages: null }]);
    const result = adaptBooks(books);
    expect(result.books[0].progress).toBeUndefined();
  });

  it('guards against division by zero (totalPages=0)', () => {
    const books = makeBooks([{ currentPage: 50, totalPages: 0 }]);
    const result = adaptBooks(books);
    expect(result.books[0].progress).toBeUndefined();
  });

  it('generates affiliate Amazon link with asin', () => {
    const books = makeBooks([{ asin: 'B0TESTBOOK' }]);
    const result = adaptBooks(books);
    expect(result.books[0].link).toContain('B0TESTBOOK');
    expect(result.books[0].link).toContain('amazon.com/dp/');
    expect(result.books[0].link).toContain('lifegames04-20');
  });

  it('localizes CloudFront mainImage to /images/ path', () => {
    const books = makeBooks([{ mainImage: 'https://d2nfgi9u0n3jr6.cloudfront.net/images/books/B0TEST.webp' }]);
    const result = adaptBooks(books);
    expect(result.books[0].cover).toBe('/images/books/B0TEST.webp');
  });

  it('preserves non-CloudFront mainImage URLs unchanged', () => {
    const books = makeBooks([{ mainImage: 'https://amazon.com/images/B0TEST.jpg' }]);
    const result = adaptBooks(books);
    expect(result.books[0].cover).toBe('https://amazon.com/images/B0TEST.jpg');
  });

  it('returns null cover when mainImage is null', () => {
    const books = makeBooks([{ mainImage: null }]);
    const result = adaptBooks(books);
    expect(result.books[0].cover).toBeNull();
  });

  it('splits category on " > " for genres', () => {
    const books = makeBooks([{ asin: 'B000TEST01', category: 'Technology > Software > Engineering' }]);
    const result = adaptBooks(books);
    expect(result.bookMeta['B000TEST01'].genres).toEqual(['Technology', 'Software', 'Engineering']);
  });

  it('returns empty genres array when category is null', () => {
    const books = makeBooks([{ asin: 'B000TEST01', category: null }]);
    const result = adaptBooks(books);
    expect(result.bookMeta['B000TEST01'].genres).toEqual([]);
  });

  it('counts reading books in stats', () => {
    const books: BooksExport = {
      generatedAt: '2026-01-15T10:30:00Z',
      books: [
        { asin: 'A1', title: 'T1', author: 'A', series: null, seriesNumber: null, seriesTotal: null, description: null, publicationDate: null, publishedYear: null, isbn10: null, isbn13: null, pageCount: null, mainImage: null, mainImageThumb: null, images: null, averageRating: null, category: null, status: 'reading', currentPage: null, totalPages: null, rating: null, notes: null },
        { asin: 'A2', title: 'T2', author: 'A', series: null, seriesNumber: null, seriesTotal: null, description: null, publicationDate: null, publishedYear: null, isbn10: null, isbn13: null, pageCount: null, mainImage: null, mainImageThumb: null, images: null, averageRating: null, category: null, status: 'completed', currentPage: null, totalPages: null, rating: null, notes: null },
        { asin: 'A3', title: 'T3', author: 'A', series: null, seriesNumber: null, seriesTotal: null, description: null, publicationDate: null, publishedYear: null, isbn10: null, isbn13: null, pageCount: null, mainImage: null, mainImageThumb: null, images: null, averageRating: null, category: null, status: 'upNext', currentPage: null, totalPages: null, rating: null, notes: null },
      ],
    };
    const result = adaptBooks(books);
    expect(result.stats.reading).toBe(1);
    expect(result.stats.completed).toBe(1);
    expect(result.stats.upcoming).toBe(1);
    expect(result.stats.total).toBe(3);
  });

  it('handles empty books array with zero stats', () => {
    const result = adaptBooks({ generatedAt: '2026-01-15T10:30:00Z', books: [] });
    expect(result.stats).toEqual({ total: 0, reading: 0, completed: 0, upcoming: 0 });
    expect(result.books).toEqual([]);
  });

  it('includes STATUS_LABELS in result', () => {
    const result = adaptBooks(makeBooks());
    expect(result.statusLabels).toEqual(STATUS_LABELS);
  });

  it('builds bookMeta with series info', () => {
    const books = makeBooks([{ asin: 'B0SERIES01', series: 'The Test Series', seriesNumber: 2, seriesTotal: 5 }]);
    const result = adaptBooks(books);
    expect(result.bookMeta['B0SERIES01'].seriesName).toBe('The Test Series');
    expect(result.bookMeta['B0SERIES01'].seriesNumber).toBe(2);
    expect(result.bookMeta['B0SERIES01'].seriesTotal).toBe(5);
  });

  it('uses pageCount as fallback when totalPages is null', () => {
    const books = makeBooks([{ asin: 'B000TEST01', totalPages: null, pageCount: 350 }]);
    const result = adaptBooks(books);
    expect(result.bookMeta['B000TEST01'].pages).toBe(350);
  });
});

// ── adaptArticles ─────────────────────────────────────────────────

describe('adaptArticles', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array when input is null', () => {
    expect(adaptArticles(null)).toEqual([]);
  });

  it('returns empty array when articles array is absent', () => {
    expect(adaptArticles({ generatedAt: '2026-01-15T10:30:00Z', articles: [] })).toEqual([]);
  });

  it('sorts articles by savedAt descending', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const articles = makeArticles([
      { articleUrl: 'https://a.com/1', articleTitle: 'Older', savedAt: '2026-01-10T00:00:00Z', notes: [], articleAuthor: null, articleContent: null, articleFirstImageUrl: null, articlePublishedAt: null, articleBoards: null, articleCategories: null, sourceTitle: 'Source A', sourceUrl: null, sourceFeedUrl: null, articleEngagement: null, articleEngagementRate: null, articleFirstHighlight: null, articleFirstComment: null },
      { articleUrl: 'https://a.com/2', articleTitle: 'Newer', savedAt: '2026-01-14T00:00:00Z', notes: [], articleAuthor: null, articleContent: null, articleFirstImageUrl: null, articlePublishedAt: null, articleBoards: null, articleCategories: null, sourceTitle: 'Source B', sourceUrl: null, sourceFeedUrl: null, articleEngagement: null, articleEngagementRate: null, articleFirstHighlight: null, articleFirstComment: null },
    ]);
    const result = adaptArticles(articles);
    expect(result[0].title).toBe('Newer');
    expect(result[1].title).toBe('Older');
  });

  it('slices to at most 30 articles', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    const baseArticle = {
      articleAuthor: null, articleContent: null, articleFirstImageUrl: null,
      articlePublishedAt: null, articleBoards: null, articleCategories: null,
      sourceTitle: 'S', sourceUrl: null, sourceFeedUrl: null,
      articleEngagement: null, articleEngagementRate: null,
      articleFirstHighlight: null, articleFirstComment: null, notes: [] as any[],
    };
    const articles = makeArticles(
      Array.from({ length: 40 }, (_, i) => ({
        ...baseArticle,
        articleUrl: `https://a.com/${i}`,
        articleTitle: `Article ${i}`,
        savedAt: `2026-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`,
      }))
    );
    const result = adaptArticles(articles);
    expect(result).toHaveLength(30);
  });

  it('formats date as minutes ago for recent articles', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const articles = makeArticles([{
      articleUrl: 'https://a.com', articleTitle: 'Test', savedAt: '2026-01-15T10:00:00Z',
      notes: [], articleAuthor: null, articleContent: null, articleFirstImageUrl: null,
      articlePublishedAt: null, articleBoards: null, articleCategories: null,
      sourceTitle: null, sourceUrl: null, sourceFeedUrl: null,
      articleEngagement: null, articleEngagementRate: null,
      articleFirstHighlight: null, articleFirstComment: null,
    }]);
    const result = adaptArticles(articles);
    expect(result[0].date).toBe('30m ago');
  });

  it('formats date as hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const articles = makeArticles([{
      articleUrl: 'https://a.com', articleTitle: 'Test', savedAt: '2026-01-15T07:30:00Z',
      notes: [], articleAuthor: null, articleContent: null, articleFirstImageUrl: null,
      articlePublishedAt: null, articleBoards: null, articleCategories: null,
      sourceTitle: null, sourceUrl: null, sourceFeedUrl: null,
      articleEngagement: null, articleEngagementRate: null,
      articleFirstHighlight: null, articleFirstComment: null,
    }]);
    const result = adaptArticles(articles);
    expect(result[0].date).toBe('3h ago');
  });

  it('formats date as weeks ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const articles = makeArticles([{
      articleUrl: 'https://a.com', articleTitle: 'Test', savedAt: '2025-12-25T10:30:00Z',
      notes: [], articleAuthor: null, articleContent: null, articleFirstImageUrl: null,
      articlePublishedAt: null, articleBoards: null, articleCategories: null,
      sourceTitle: null, sourceUrl: null, sourceFeedUrl: null,
      articleEngagement: null, articleEngagementRate: null,
      articleFirstHighlight: null, articleFirstComment: null,
    }]);
    const result = adaptArticles(articles);
    expect(result[0].date).toBe('3w ago');
  });

  it('sets hasNotes true and joins noteText when notes present', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const articles = makeArticles([{
      articleUrl: 'https://a.com', articleTitle: 'Test', savedAt: '2026-01-15T10:29:00Z',
      notes: [
        { comment: 'First note', savedBy: null, createdAt: '2026-01-15T10:29:00Z' },
        { comment: 'Second note', savedBy: null, createdAt: '2026-01-15T10:29:00Z' },
      ],
      articleAuthor: null, articleContent: null, articleFirstImageUrl: null,
      articlePublishedAt: null, articleBoards: null, articleCategories: null,
      sourceTitle: null, sourceUrl: null, sourceFeedUrl: null,
      articleEngagement: null, articleEngagementRate: null,
      articleFirstHighlight: null, articleFirstComment: null,
    }]);
    const result = adaptArticles(articles);
    expect(result[0].hasNotes).toBe(true);
    expect(result[0].noteText).toBe('First note\nSecond note');
  });

  it('sets hasNotes false and noteText null when notes is empty', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const articles = makeArticles([{
      articleUrl: 'https://a.com', articleTitle: 'Test', savedAt: '2026-01-15T10:29:00Z',
      notes: [],
      articleAuthor: null, articleContent: null, articleFirstImageUrl: null,
      articlePublishedAt: null, articleBoards: null, articleCategories: null,
      sourceTitle: null, sourceUrl: null, sourceFeedUrl: null,
      articleEngagement: null, articleEngagementRate: null,
      articleFirstHighlight: null, articleFirstComment: null,
    }]);
    const result = adaptArticles(articles);
    expect(result[0].hasNotes).toBe(false);
    expect(result[0].noteText).toBeNull();
  });

  it('uses empty string source when sourceTitle is null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00Z'));
    const articles = makeArticles([{
      articleUrl: 'https://a.com', articleTitle: 'Test', savedAt: '2026-01-15T10:29:00Z',
      notes: [], sourceTitle: null,
      articleAuthor: null, articleContent: null, articleFirstImageUrl: null,
      articlePublishedAt: null, articleBoards: null, articleCategories: null,
      sourceUrl: null, sourceFeedUrl: null,
      articleEngagement: null, articleEngagementRate: null,
      articleFirstHighlight: null, articleFirstComment: null,
    }]);
    const result = adaptArticles(articles);
    expect(result[0].source).toBe('');
  });
});
