import { HYDRATION, STATUS_LABELS } from './constants';
import {
  computeTotalSleepSeconds,
  formatDuration,
  formatPhase,
  computeSleepPercentages,
} from './sleep';

export function adaptHealth(healthData: any, sleepData: any | null): any {
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
    coffeeOz: 0,
    caffeineMg,
    waterMax: HYDRATION.waterMax,
    coffeeMax: HYDRATION.coffeeMax,
    waterRangeLo: HYDRATION.waterRangeLo,
    waterRangeHi: HYDRATION.waterRangeHi,
    coffeeRangeLo: HYDRATION.coffeeRangeLo,
    coffeeRangeHi: HYDRATION.coffeeRangeHi,
    coffeeCautionMax: HYDRATION.coffeeCautionMax,
  };

  // 7. Sleep fields
  let sleepScore = healthData.quantities?.sleepScore?.value ?? healthData.sleepScore ?? 0;
  let sleepDurationFormatted = '';
  let sleepPhaseFormatted: any = {};
  let deepPct = 0;
  let remPct = 0;
  let corePct = 0;

  if (sleepData) {
    const phases = {
      rem: sleepData.rem.seconds,
      deep: sleepData.deep.seconds,
      core: sleepData.core.seconds,
      awake: sleepData.awake.seconds,
    };
    const totalSleepSeconds = computeTotalSleepSeconds(phases);
    sleepDurationFormatted = formatDuration(totalSleepSeconds);
    sleepPhaseFormatted = {
      deep: formatPhase(sleepData.deep.seconds),
      rem: formatPhase(sleepData.rem.seconds),
      core: formatPhase(sleepData.core.seconds),
      awake: formatPhase(sleepData.awake.seconds),
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
    sleep: sleepData ?? healthData.sleep,
    workouts: healthData.workouts ?? [],
    ranges: healthData.ranges,
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

export function adaptSleep(sleepData: any, healthData: any | null): any {
  const phases = {
    rem: sleepData.rem.seconds,
    deep: sleepData.deep.seconds,
    core: sleepData.core.seconds,
    awake: sleepData.awake.seconds,
  };
  const totalSleepSeconds = computeTotalSleepSeconds(phases);
  const pcts = computeSleepPercentages(phases);

  return {
    sleepScore: healthData?.quantities?.sleepScore?.value ?? healthData?.sleepScore ?? 0,
    sleepDurationFormatted: formatDuration(totalSleepSeconds),
    sleepPhaseFormatted: {
      deep: formatPhase(sleepData.deep.seconds),
      rem: formatPhase(sleepData.rem.seconds),
      core: formatPhase(sleepData.core.seconds),
      awake: formatPhase(sleepData.awake.seconds),
    },
    derived: {
      deepPct: pcts.deepPct,
      remPct: pcts.remPct,
      corePct: pcts.corePct,
    },
    phases: {
      rem: sleepData.rem.seconds,
      deep: sleepData.deep.seconds,
      core: sleepData.core.seconds,
      awake: sleepData.awake.seconds,
    },
  };
}

export function adaptWorkouts(workoutsData: any | null): any[] | null {
  if (workoutsData === null) return null;
  if (Array.isArray(workoutsData)) return workoutsData;
  if (workoutsData.workouts !== undefined) return workoutsData.workouts;
  return workoutsData;
}

export function adaptBooks(booksData: any): any {
  const statusMap: Record<string, string> = {
    reading: 'in_progress',
    upNext: 'next',
    completed: 'completed',
  };

  const rawBooks: any[] = booksData.books ?? [];

  const books = rawBooks.map((b: any) => {
    const mappedStatus = statusMap[b.status] ?? b.status;
    let progress: number | undefined;
    if (b.currentPage != null && b.totalPages != null && b.totalPages > 0) {
      progress = Math.round(b.currentPage / b.totalPages * 100);
    } else if (b.progress != null) {
      progress = b.progress;
    }
    return {
      title: b.title,
      author: b.author,
      asin: b.asin,
      status: mappedStatus,
      rating: b.rating ?? null,
      progress,
      link: 'https://www.amazon.com/dp/' + b.asin,
      cover: b.mainImage ?? b.cover,
    };
  });

  const bookMeta: Record<string, any> = {};
  if (booksData.bookMeta) {
    for (const [asin, meta] of Object.entries<any>(booksData.bookMeta)) {
      bookMeta[asin] = {
        series: meta.series ?? null,
        pages: meta.pageCount ?? meta.pages,
        genres: meta.genres ?? [],
        year: meta.publishedYear ?? meta.year,
        desc: meta.description ?? meta.desc,
      };
    }
  } else {
    for (const b of rawBooks) {
      if (b.asin) {
        bookMeta[b.asin] = {
          series: b.series ?? null,
          pages: b.pageCount ?? b.totalPages ?? null,
          genres: b.genres ?? [],
          year: b.publishedYear ?? null,
          desc: b.description ?? null,
        };
      }
    }
  }

  const inProgress = books.filter((b: any) => b.status === 'in_progress').length;
  const completed = books.filter((b: any) => b.status === 'completed').length;
  const next = books.filter((b: any) => b.status === 'next').length;

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
