import { HYDRATION, STATUS_LABELS } from './constants';
import {
  computeTotalSleepSeconds,
  formatDuration,
  formatPhase,
  computeSleepPercentages,
} from './sleep';
import type { HealthExport, SleepExport, WorkoutsExport, BooksExport, GithubEventsExport } from '../types/exports';

// ── Adapted output types (what adapters produce for updaters) ──────

export interface HealthQuantity {
  value: number;
  unit: string;
}

export interface AdaptedHealth {
  date: string;
  quantities: Record<string, HealthQuantity>;
  derived: {
    totalCalories: number;
    deepPct: number;
    remPct: number;
    corePct: number;
  };
  sleepScore: number;
  sleepDurationFormatted: string;
  sleepPhaseFormatted: Record<string, string>;
  hydration: {
    waterOz: number;
    caffeineMg: number;
    waterMax: number;
    caffeineMax: number;
    waterRangeLo: number;
    waterRangeHi: number;
    caffeineRangeLo: number;
    caffeineRangeHi: number;
  };
}

export interface AdaptedSleep {
  sleepScore: number;
  sleepDurationFormatted: string;
  sleepPhaseFormatted: Record<string, string>;
  derived: {
    deepPct: number;
    remPct: number;
    corePct: number;
  };
  phases: Record<string, number>;
}

export interface WorkoutEntry {
  activityType: string;
  duration: number | null;
  energyBurned: number | null;
  distance: number | null;
  source: string;
}

export interface AdaptedGithubEvent {
  type: string;
  repo: string;
  title: string;
  date: string;
  number?: number;
  hash?: string;
  additions?: number;
  deletions?: number;
  url: string;
}

export interface AdaptedBookEntry {
  title: string;
  author: string;
  asin: string;
  status: string;
  rating: number | null;
  progress: number | undefined;
  link: string;
  cover: string | null;
  notes: string | null;
}

export interface BookMeta {
  series: string | null;
  pages: number | null;
  genres: string[];
  year: number | null;
  desc: string | null;
}

export interface AdaptedBooks {
  books: AdaptedBookEntry[];
  bookMeta: Record<string, BookMeta>;
  statusLabels: Record<string, string>;
  stats: {
    total: number;
    reading: number;
    completed: number;
    upcoming: number;
  };
}

// ── Adapter functions ──────────────────────────────────────────────

export function adaptHealth(healthData: HealthExport, sleepData: SleepExport | null): AdaptedHealth {
  const q = { ...healthData.quantities };

  // 1. Rename heartRateVariabilitySDNN → hrvSDNN
  if ('heartRateVariabilitySDNN' in q) {
    q.hrvSDNN = q.heartRateVariabilitySDNN;
    delete q.heartRateVariabilitySDNN;
  }

  // 2. Default exerciseTime if missing
  if (!q.exerciseTime) {
    q.exerciseTime = { value: 0, unit: 'min' };
  }

  // 3. Convert dietaryWater mL → oz
  const waterMl: number = q.dietaryWater?.value ?? 0;
  const waterOz = Math.round(waterMl / 29.5735);

  // 4. Convert dietaryCaffeine grams → mg
  const caffeineG: number = q.dietaryCaffeine?.value ?? 0;
  const caffeineMg = Math.round(caffeineG * 1000);

  // 5. Compute totalCalories
  const activeEnergy: number = q.activeEnergyBurned?.value ?? 0;
  const basalEnergy: number = q.basalEnergyBurned?.value ?? 0;
  const totalCalories = Math.round(activeEnergy + basalEnergy);

  // 6. Build hydration object
  const hydration = {
    waterOz,
    caffeineMg,
    waterMax: HYDRATION.waterMax,
    caffeineMax: HYDRATION.caffeineMax,
    waterRangeLo: HYDRATION.waterRangeLo,
    waterRangeHi: HYDRATION.waterRangeHi,
    caffeineRangeLo: HYDRATION.caffeineRangeLo,
    caffeineRangeHi: HYDRATION.caffeineRangeHi,
  };

  // 7. Sleep fields
  let sleepScore = q.sleepScore?.value ?? 0;
  let sleepDurationFormatted = '';
  let sleepPhaseFormatted: Record<string, string> = {};
  let deepPct = 0;
  let remPct = 0;
  let corePct = 0;

  if (sleepData) {
    const rem = sleepData.rem as { seconds: number } | undefined;
    const deep = sleepData.deep as { seconds: number } | undefined;
    const core = sleepData.core as { seconds: number } | undefined;
    const awake = sleepData.awake as { seconds: number } | undefined;
    const phases = {
      rem: rem?.seconds ?? 0,
      deep: deep?.seconds ?? 0,
      core: core?.seconds ?? 0,
      awake: awake?.seconds ?? 0,
    };
    const totalSleepSeconds = computeTotalSleepSeconds(phases);
    sleepDurationFormatted = formatDuration(totalSleepSeconds);
    sleepPhaseFormatted = {
      deep: formatPhase(phases.deep),
      rem: formatPhase(phases.rem),
      core: formatPhase(phases.core),
      awake: formatPhase(phases.awake),
    };
    const pcts = computeSleepPercentages(phases);
    deepPct = pcts.deepPct;
    remPct = pcts.remPct;
    corePct = pcts.corePct;
  }

  // 8+9. Build result matching health.json shape
  return {
    date: healthData.date,
    quantities: q,
    derived: {
      totalCalories,
      deepPct,
      remPct,
      corePct,
    },
    sleepScore,
    sleepDurationFormatted,
    sleepPhaseFormatted,
    hydration,
  };
}

export function adaptSleep(sleepData: SleepExport, healthData: HealthExport | null): AdaptedSleep {
  const rem = sleepData.rem as { seconds: number } | undefined;
  const deep = sleepData.deep as { seconds: number } | undefined;
  const core = sleepData.core as { seconds: number } | undefined;
  const awake = sleepData.awake as { seconds: number } | undefined;
  const phases = {
    rem: rem?.seconds ?? 0,
    deep: deep?.seconds ?? 0,
    core: core?.seconds ?? 0,
    awake: awake?.seconds ?? 0,
  };
  const totalSleepSeconds = computeTotalSleepSeconds(phases);
  const pcts = computeSleepPercentages(phases);

  return {
    sleepScore: healthData?.quantities?.sleepScore?.value ?? 0,
    sleepDurationFormatted: formatDuration(totalSleepSeconds),
    sleepPhaseFormatted: {
      deep: formatPhase(phases.deep),
      rem: formatPhase(phases.rem),
      core: formatPhase(phases.core),
      awake: formatPhase(phases.awake),
    },
    derived: {
      deepPct: pcts.deepPct,
      remPct: pcts.remPct,
      corePct: pcts.corePct,
    },
    phases,
  };
}

export function adaptWorkouts(workoutsData: WorkoutsExport | null): WorkoutEntry[] | null {
  if (workoutsData === null) return null;
  return workoutsData.workouts;
}

export function adaptGithubEvents(data: GithubEventsExport | null): AdaptedGithubEvent[] {
  if (!data) return [];
  const events = data.events || [];
  const now = Date.now();

  return events.slice(0, 10).map((e) => {
    let date = e.date;
    if (date && date.includes('T')) {
      const msAgo = now - new Date(date).getTime();
      const minutesAgo = Math.floor(msAgo / 60000);
      const hoursAgo = Math.floor(minutesAgo / 60);
      const daysAgo = Math.floor(hoursAgo / 24);
      const weeksAgo = Math.floor(daysAgo / 7);
      if (weeksAgo > 0) date = weeksAgo + 'w ago';
      else if (daysAgo > 0) date = daysAgo + 'd ago';
      else if (hoursAgo > 0) date = hoursAgo + 'h ago';
      else date = minutesAgo + 'm ago';
    }

    const fullRepo = e.repo || '';
    let repo = fullRepo;
    const slashIdx = repo.indexOf('/');
    if (slashIdx !== -1) repo = repo.substring(slashIdx + 1);

    let url = '';
    if (e.type === 'commit' && e.hash) {
      url = 'https://github.com/' + fullRepo + '/commit/' + e.hash;
    } else if (e.type?.startsWith('pr_') && e.number !== undefined) {
      url = 'https://github.com/' + fullRepo + '/pull/' + e.number;
    } else if (e.type?.startsWith('issue_') && e.number !== undefined) {
      url = 'https://github.com/' + fullRepo + '/issues/' + e.number;
    }

    return { ...e, date, repo, url };
  });
}

export function adaptBooks(booksData: BooksExport): AdaptedBooks {
  const statusMap: Record<string, string> = {
    reading: 'in_progress',
    upNext: 'next',
    completed: 'completed',
  };

  const rawBooks = booksData.books ?? [];

  const books: AdaptedBookEntry[] = rawBooks.map((b) => {
    const mappedStatus = statusMap[b.status ?? ''] ?? b.status ?? 'next';
    let progress: number | undefined;
    if (b.currentPage != null && b.totalPages != null && b.totalPages > 0) {
      progress = Math.round(b.currentPage / b.totalPages * 100);
    }
    return {
      title: b.title,
      author: b.author,
      asin: b.asin,
      status: mappedStatus,
      rating: b.rating ?? null,
      progress,
      link: 'https://www.amazon.com/dp/' + b.asin + '?tag=lifegames04-20&linkCode=ll2&language=en_US&ref_=as_li_ss_tl',
      cover: b.mainImage ?? null,
      notes: b.notes ?? null,
    };
  });

  const bookMeta: Record<string, BookMeta> = {};
  for (const b of rawBooks) {
    if (b.asin) {
      bookMeta[b.asin] = {
        series: b.series ?? null,
        pages: b.totalPages ?? b.pageCount ?? null,
        genres: b.category ? b.category.split(' > ') : [],
        year: b.publishedYear ?? null,
        desc: b.description ?? null,
      };
    }
  }

  const inProgress = books.filter((b) => b.status === 'in_progress').length;
  const completed = books.filter((b) => b.status === 'completed').length;
  const next = books.filter((b) => b.status === 'next').length;

  return {
    books,
    bookMeta,
    statusLabels: STATUS_LABELS,
    stats: {
      total: books.length,
      reading: inProgress,
      completed,
      upcoming: next,
    },
  };
}
