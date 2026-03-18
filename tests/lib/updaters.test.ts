// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  updateHeartRate,
  updateDailyActivity,
  updateWorkouts,
  updateNightSummary,
  updateHydration,
  updateDevActivityLog,
  updateReadingFeed,
  updateSystemStatus,
  updateExplorationOdometer,
  updateStreakFlame,
  updatePlaceLeaderboard,
  updateRhythmBars,
  updateWaffleGrid,
  updateCategoryTerrain,
  updateExplorationRings,
  updateDurationDonut,
  updateStreakCalendar,
  updateCityConstellation,
  updateBookshelf,
  getCategoryColor,
  esc,
} from '../../src/lib/updaters';
import type { AdaptedHealth, AdaptedSleep, WorkoutEntry, AdaptedGithubEvent, AdaptedArticle, AdaptedBooks } from '../../src/lib/adapters';
import type { LocationExport } from '../../src/types/exports';

// ── helpers ───────────────────────────────────────────────────────────────────

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as HTMLElement;
}

function makeHealth(overrides: Partial<AdaptedHealth['quantities']> = {}): AdaptedHealth {
  return {
    date: '2026-01-01',
    quantities: {
      heartRate: { value: 72, unit: 'bpm' },
      hrvSDNN: { value: 45, unit: 'ms' },
      stepCount: { value: 8000, unit: 'steps' },
      distanceWalkingRunning: { value: 5200, unit: 'm' },
      exerciseTime: { value: 30, unit: 'min' },
      activeEnergyBurned: { value: 400, unit: 'kcal' },
      basalEnergyBurned: { value: 1800, unit: 'kcal' },
      dietaryWater: { value: 2000, unit: 'mL' },
      dietaryCaffeine: { value: 0.2, unit: 'g' },
      ...overrides,
    },
    derived: { totalCalories: 2200, deepPct: 20, remPct: 25, corePct: 45 },
    sleepScore: 85,
    sleepDurationFormatted: '7h 30m',
    sleepPhaseFormatted: { deep: '1h 30m', rem: '1h 52m', core: '3h 22m', awake: '15m' },
    hydration: {
      waterOz: 68,
      caffeineMg: 200,
      waterMax: 140,
      caffeineMax: 500,
      waterRangeLo: 74,
      waterRangeHi: 125,
      caffeineRangeLo: 200,
      caffeineRangeHi: 400,
    },
  };
}

function makeLocation(overrides: Partial<LocationExport> = {}): LocationExport {
  return {
    generatedAt: '2026-01-01T00:00:00Z',
    totalVisits: 500,
    totalPlaces: 80,
    totalDurationHours: 300,
    citiesVisited: 5,
    currentCity: 'Los Angeles',
    lastSeen: new Date(Date.now() - 3600000).toISOString(),
    last90Days: [
      { date: '2026-01-01', count: 3, uniquePlaces: 2, totalDurationMinutes: 90 },
      { date: '2026-01-02', count: 0, uniquePlaces: 0, totalDurationMinutes: 0 },
      { date: '2026-01-03', count: 5, uniquePlaces: 3, totalDurationMinutes: 120 },
    ],
    topPlaces: [
      { name: 'Coffee Shop', category: 'Dining', visitCount: 40, totalDurationMinutes: 800, lastVisitAt: null },
      { name: 'Gym', category: 'Fitness & Outdoors', visitCount: 30, totalDurationMinutes: 600, lastVisitAt: null },
    ],
    cityBreakdown: [
      { city: 'Los Angeles', visitCount: 300 },
      { city: 'San Francisco', visitCount: 100 },
    ],
    categoryBreakdown: [
      { category: 'Dining', visitCount: 50, totalMinutes: 1000 },
      { category: 'Work', visitCount: 30, totalMinutes: 600 },
    ],
    streaks: { currentStreak: 7, longestStreak: 21, totalActiveDays: 45 },
    explorationStats: { totalNeighborhoods: 12, totalCities: 5, totalStates: 3 },
    ...overrides,
  };
}

// ── esc ───────────────────────────────────────────────────────────────────────

describe('esc', () => {
  it('escapes html special chars', () => {
    expect(esc('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
  });
  it('returns empty string for null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

// ── getCategoryColor ───────────────────────────────────────────────────────────

describe('getCategoryColor', () => {
  it('returns known color for Dining', () => {
    expect(getCategoryColor('Dining')).toBe('var(--neon-orange, #ff6b00)');
  });
  it('returns fallback for unknown category', () => {
    expect(getCategoryColor('Unknown')).toBe('var(--text-muted, #9ca3af)');
  });
  it('returns fallback for null', () => {
    expect(getCategoryColor(null)).toBe('var(--text-muted, #9ca3af)');
  });
});

// ── updateHeartRate ────────────────────────────────────────────────────────────

describe('updateHeartRate', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="pulseBpm"></div>
      <div id="hrZoneBadge"></div>
      <div id="hrHrvValue"></div>
      <div id="hrEcgBg"></div>
      <div id="cardHR" class="tri-card is-loading tri-card-accent-blue"></div>
    `;
  });

  it('sets BPM text content', () => {
    updateHeartRate(makeHealth());
    expect(el('pulseBpm').textContent).toBe('72');
  });

  it('sets zone badge text', () => {
    updateHeartRate(makeHealth());
    expect(el('hrZoneBadge').textContent).toBe('Normal Zone');
  });

  it('sets HRV text content', () => {
    updateHeartRate(makeHealth());
    expect(el('hrHrvValue').textContent).toBe('45');
  });

  it('removes is-loading from cardHR', () => {
    updateHeartRate(makeHealth());
    expect(el('cardHR').classList.contains('is-loading')).toBe(false);
  });

  it('adds zone accent class to cardHR', () => {
    updateHeartRate(makeHealth());
    expect(el('cardHR').classList.contains('tri-card-accent-pink')).toBe(true);
  });

  it('removes prior accent class', () => {
    updateHeartRate(makeHealth());
    expect(el('cardHR').classList.contains('tri-card-accent-blue')).toBe(false);
  });

  it('uses bradycardia zone for hr < 45', () => {
    const data = makeHealth({ heartRate: { value: 40, unit: 'bpm' } });
    updateHeartRate(data);
    expect(el('hrZoneBadge').textContent).toBe('Bradycardia');
  });

  it('uses peak zone for hr > 140', () => {
    const data = makeHealth({ heartRate: { value: 160, unit: 'bpm' } });
    updateHeartRate(data);
    expect(el('hrZoneBadge').textContent).toBe('Peak Zone');
  });

  it('does not throw when elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => updateHeartRate(makeHealth())).not.toThrow();
  });

  it('calls __ecgUpdate if available', () => {
    const ecgUpdate = vi.fn();
    (window as any).__ecgUpdate = ecgUpdate;
    updateHeartRate(makeHealth());
    expect(ecgUpdate).toHaveBeenCalledWith(72, 45, expect.any(String));
    delete (window as any).__ecgUpdate;
  });
});

// ── updateDailyActivity ────────────────────────────────────────────────────────

describe('updateDailyActivity', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardSteps" class="is-loading">
        <div data-metric="steps">0</div>
        <div data-metric="distance">0</div>
        <div data-metric="exercise">0</div>
        <div data-metric="active">0</div>
        <div data-metric="basal">0</div>
        <div data-metric="total">0</div>
      </div>
    `;
  });

  it('updates steps metric', () => {
    updateDailyActivity(makeHealth());
    expect(el('cardSteps').querySelector('[data-metric="steps"]')!.textContent).toMatch(/8[,.]?000/);
  });

  it('updates distance metric', () => {
    updateDailyActivity(makeHealth());
    expect(el('cardSteps').querySelector('[data-metric="distance"]')!.textContent).toBe('5200');
  });

  it('updates exercise metric', () => {
    updateDailyActivity(makeHealth());
    expect(el('cardSteps').querySelector('[data-metric="exercise"]')!.textContent).toBe('30');
  });

  it('updates active calories', () => {
    updateDailyActivity(makeHealth());
    expect(el('cardSteps').querySelector('[data-metric="active"]')!.textContent).toBe('400');
  });

  it('updates basal calories', () => {
    updateDailyActivity(makeHealth());
    expect(el('cardSteps').querySelector('[data-metric="basal"]')!.textContent).toBe('1800');
  });

  it('updates total calories', () => {
    updateDailyActivity(makeHealth());
    expect(el('cardSteps').querySelector('[data-metric="total"]')!.textContent).toBe('2200');
  });

  it('removes is-loading', () => {
    updateDailyActivity(makeHealth());
    expect(el('cardSteps').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateDailyActivity(makeHealth())).not.toThrow();
  });

  it('respects split-metric-unit structure — updates firstChild only', () => {
    document.body.innerHTML = `
      <div id="cardSteps" class="is-loading">
        <div data-metric="steps">0<span class="split-metric-unit"> steps</span></div>
      </div>
    `;
    updateDailyActivity(makeHealth());
    const container = el('cardSteps').querySelector('[data-metric="steps"]') as HTMLElement;
    expect(container.firstChild!.textContent).toMatch(/8[,.]?000/);
    expect(container.querySelector('.split-metric-unit')!.textContent).toBe(' steps');
  });
});

// ── updateWorkouts ─────────────────────────────────────────────────────────────

describe('updateWorkouts', () => {
  const workout: WorkoutEntry = {
    activityType: 'Outdoor Walk',
    duration: 3600,
    energyBurned: 400,
    distance: 5000,
    source: 'Apple Watch',
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardWorkouts" style="display:none">
        <div class="widget-body"></div>
      </div>
    `;
  });

  it('renders workout card with activity type', () => {
    updateWorkouts([workout]);
    expect(el('cardWorkouts').innerHTML).toContain('Outdoor Walk');
  });

  it('renders duration correctly', () => {
    updateWorkouts([workout]);
    expect(el('cardWorkouts').innerHTML).toContain('1h 0m');
  });

  it('renders calories', () => {
    updateWorkouts([workout]);
    expect(el('cardWorkouts').innerHTML).toContain('400 kcal');
  });

  it('renders distance in km', () => {
    updateWorkouts([workout]);
    expect(el('cardWorkouts').innerHTML).toContain('5.00 km');
  });

  it('shows the card (clears display:none)', () => {
    updateWorkouts([workout]);
    expect((el('cardWorkouts') as HTMLElement).style.display).toBe('');
  });

  it('does not throw for null data', () => {
    expect(() => updateWorkouts(null)).not.toThrow();
  });

  it('does not throw for empty array', () => {
    expect(() => updateWorkouts([])).not.toThrow();
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateWorkouts([workout])).not.toThrow();
  });

  it('renders workout without url as plain div', () => {
    const w = { ...workout, activityUrl: undefined };
    updateWorkouts([w]);
    expect(el('cardWorkouts').querySelector('.workout-sub-type')!.tagName).toBe('DIV');
  });

  it('renders workout with url as anchor', () => {
    const w = { ...workout, activityUrl: 'https://example.com' };
    updateWorkouts([w]);
    expect(el('cardWorkouts').querySelector('.workout-sub-type')!.tagName).toBe('A');
  });
});

// ── updateNightSummary ─────────────────────────────────────────────────────────

describe('updateNightSummary', () => {
  function setup() {
    document.body.innerHTML = `
      <div id="cardSleep" class="is-loading">
        <div id="sleepDuration"></div>
        <div id="sleepScoreVal"></div>
        <div id="sleepScoreFill" style="width:0%"></div>
        <div data-phase="deep"><span class="sleep-moon-pill-val"></span></div>
        <div data-phase="rem"><span class="sleep-moon-pill-val"></span></div>
        <div data-phase="core"><span class="sleep-moon-pill-val"></span></div>
        <div data-phase="awake"><span class="sleep-moon-pill-val"></span></div>
        <div id="sleepInsight"></div>
        <div id="sleepTimestamp"></div>
      </div>
    `;
  }

  const fullSleep: AdaptedSleep = {
    isEmpty: false,
    date: '2026-01-01',
    sleepScore: 85,
    sleepDurationFormatted: '7h 30m',
    sleepPhaseFormatted: { deep: '1h 30m', rem: '1h 52m', core: '3h 22m', awake: '15m' },
    derived: { deepPct: 20, remPct: 25, corePct: 45 },
    phases: { deep: 5400, rem: 6720, core: 12120, awake: 900 },
  };

  const emptySleep: AdaptedSleep = {
    isEmpty: true,
    date: '2026-01-01',
    sleepScore: 0,
    sleepDurationFormatted: '',
    sleepPhaseFormatted: { deep: '', rem: '', core: '', awake: '' },
    derived: { deepPct: 0, remPct: 0, corePct: 0 },
    phases: { deep: 0, rem: 0, core: 0, awake: 0 },
  };

  it('sets sleep duration', () => {
    setup();
    updateNightSummary(fullSleep);
    expect(el('sleepDuration').textContent).toBe('7h 30m');
  });

  it('sets sleep score', () => {
    setup();
    updateNightSummary(fullSleep);
    expect(el('sleepScoreVal').textContent).toBe('85');
  });

  it('sets score fill width', () => {
    setup();
    updateNightSummary(fullSleep);
    expect((el('sleepScoreFill') as HTMLElement).style.width).toBe('85%');
  });

  it('sets phase pill values', () => {
    setup();
    updateNightSummary(fullSleep);
    const deepPill = document.querySelector('[data-phase="deep"] .sleep-moon-pill-val');
    expect(deepPill!.textContent).toBe('1h 30m');
  });

  it('sets insight with deep and rem percentages', () => {
    setup();
    updateNightSummary(fullSleep);
    expect(el('sleepInsight').innerHTML).toContain('20% deep');
    expect(el('sleepInsight').innerHTML).toContain('25% REM');
  });

  it('sets timestamp to "last night"', () => {
    setup();
    updateNightSummary(fullSleep);
    expect(el('sleepTimestamp').textContent).toBe('last night');
  });

  it('removes is-loading', () => {
    setup();
    updateNightSummary(fullSleep);
    expect(el('cardSleep').classList.contains('is-loading')).toBe(false);
  });

  it('shows -- for duration when isEmpty', () => {
    setup();
    updateNightSummary(emptySleep);
    expect(el('sleepDuration').textContent).toBe('--');
  });

  it('shows -- for score when isEmpty', () => {
    setup();
    updateNightSummary(emptySleep);
    expect(el('sleepScoreVal').textContent).toBe('--');
  });

  it('sets fill to 0% when isEmpty', () => {
    setup();
    updateNightSummary(emptySleep);
    expect((el('sleepScoreFill') as HTMLElement).style.width).toBe('0%');
  });

  it('sets insight to no-data message when isEmpty', () => {
    setup();
    updateNightSummary(emptySleep);
    expect(el('sleepInsight').innerHTML).toContain('No sleep data recorded');
  });

  it('does not throw when elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => updateNightSummary(fullSleep)).not.toThrow();
  });
});

// ── updateHydration ────────────────────────────────────────────────────────────

describe('updateHydration', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardHydration" class="is-loading">
        <div id="hydraWaterLiq"></div>
        <div id="hydraWaterVal"></div>
        <div id="hydraCoffeeLiq"></div>
        <div id="hydraCoffeeVal"></div>
        <div id="hydraCoffeeLabel"></div>
      </div>
    `;
  });

  it('sets water value text', () => {
    updateHydration(makeHealth());
    expect(el('hydraWaterVal').textContent).toContain('oz');
  });

  it('sets caffeine value text', () => {
    updateHydration(makeHealth());
    expect(el('hydraCoffeeVal').textContent).toContain('mg');
  });

  it('sets coffee label to Caffeine', () => {
    updateHydration(makeHealth());
    expect(el('hydraCoffeeLabel').textContent).toBe('Caffeine');
  });

  it('sets water clip-path', () => {
    updateHydration(makeHealth());
    expect((el('hydraWaterLiq') as HTMLElement).style.clipPath).toMatch(/inset\(/);
  });

  it('sets caffeine clip-path', () => {
    updateHydration(makeHealth());
    expect((el('hydraCoffeeLiq') as HTMLElement).style.clipPath).toMatch(/inset\(/);
  });

  it('sets data-live-updated on water val', () => {
    updateHydration(makeHealth());
    expect((el('hydraWaterVal') as HTMLElement).dataset.liveUpdated).toBe('1');
  });

  it('removes is-loading', () => {
    updateHydration(makeHealth());
    expect(el('cardHydration').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => updateHydration(makeHealth())).not.toThrow();
  });
});

// ── updateDevActivityLog ──────────────────────────────────────────────────────

describe('updateDevActivityLog', () => {
  const events: AdaptedGithubEvent[] = [
    { type: 'commit', repo: 'my-repo', title: 'Fix bug', date: '2h ago', hash: 'abc123', additions: 10, deletions: 5, url: 'https://github.com/test/commit/abc123' },
    { type: 'pr_opened', repo: 'other-repo', title: 'Add feature', date: '1d ago', number: 42, url: 'https://github.com/test/pull/42' },
  ];

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardDevLog" class="is-loading">
        <div class="widget-body"></div>
      </div>
    `;
  });

  it('renders commit event with repo and title', () => {
    updateDevActivityLog(events);
    expect(el('cardDevLog').innerHTML).toContain('my-repo');
    expect(el('cardDevLog').innerHTML).toContain('Fix bug');
  });

  it('renders additions and deletions for commit', () => {
    updateDevActivityLog(events);
    expect(el('cardDevLog').innerHTML).toContain('+10');
    expect(el('cardDevLog').innerHTML).toContain('-5');
  });

  it('renders PR number', () => {
    updateDevActivityLog(events);
    expect(el('cardDevLog').innerHTML).toContain('#42');
  });

  it('removes is-loading', () => {
    updateDevActivityLog(events);
    expect(el('cardDevLog').classList.contains('is-loading')).toBe(false);
  });

  it('does not modify DOM for empty events', () => {
    updateDevActivityLog([]);
    expect(el('cardDevLog').classList.contains('is-loading')).toBe(true);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateDevActivityLog(events)).not.toThrow();
  });

  it('renders anchor links for events with url', () => {
    updateDevActivityLog(events);
    const links = el('cardDevLog').querySelectorAll('a.gh-dal-line[href]');
    expect(links.length).toBe(2);
  });
});

// ── updateReadingFeed ─────────────────────────────────────────────────────────

describe('updateReadingFeed', () => {
  const articles: AdaptedArticle[] = [
    { title: 'Article 1', url: 'https://example.com/1', source: 'Source A', date: '1h ago', hasNotes: false, noteText: null },
    { title: 'Article 2', url: 'https://example.com/2', source: 'Source B', date: '2h ago', hasNotes: true, noteText: 'My note' },
  ];

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardReading" class="is-loading">
        <div class="widget-body"></div>
      </div>
    `;
  });

  it('renders article titles', () => {
    updateReadingFeed(articles);
    expect(el('cardReading').innerHTML).toContain('Article 1');
    expect(el('cardReading').innerHTML).toContain('Article 2');
  });

  it('renders article sources', () => {
    updateReadingFeed(articles);
    expect(el('cardReading').innerHTML).toContain('Source A');
  });

  it('renders note icon for articles with notes', () => {
    updateReadingFeed(articles);
    expect(el('cardReading').querySelectorAll('.article-list-note').length).toBe(1);
  });

  it('removes is-loading', () => {
    updateReadingFeed(articles);
    expect(el('cardReading').classList.contains('is-loading')).toBe(false);
  });

  it('does not modify DOM for empty articles', () => {
    updateReadingFeed([]);
    expect(el('cardReading').classList.contains('is-loading')).toBe(true);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateReadingFeed(articles)).not.toThrow();
  });

  it('renders pagination when articles > 10', () => {
    const manyArticles: AdaptedArticle[] = Array.from({ length: 15 }, (_, i) => ({
      title: `Article ${i}`,
      url: `https://example.com/${i}`,
      source: 'Source',
      date: '1h ago',
      hasNotes: false,
      noteText: null,
    }));
    updateReadingFeed(manyArticles);
    expect(el('cardReading').querySelectorAll('.article-page-btn').length).toBeGreaterThan(1);
  });
});

// ── updateSystemStatus ─────────────────────────────────────────────────────────

describe('updateSystemStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="systemStatus">
        <div class="sys-line" data-source="health">
          <span class="sys-dot sys-dot-red"></span>
          <span class="sys-key"></span>
          <span class="sys-val-red">OFFLINE</span>
        </div>
        <div class="sys-line" data-source="sleep">
          <span class="sys-dot"></span>
          <span class="sys-key"></span>
          <span class="sys-val-red">OFFLINE</span>
        </div>
      </div>
    `;
  });

  it('updates dot class when timestamp is present', () => {
    const ts = new Date(Date.now() - 60000).toISOString();
    updateSystemStatus({ health: ts, sleep: null });
    const dot = document.querySelector('[data-source="health"] .sys-dot');
    expect(dot!.className).toContain('sys-dot-red');
  });

  it('shows ACTIVE when timestamp is present', () => {
    const ts = new Date(Date.now() - 60000).toISOString();
    updateSystemStatus({ health: ts, sleep: null });
    const val = document.querySelector('[data-source="health"] [class*="sys-val"]');
    expect(val!.innerHTML).toContain('ACTIVE');
  });

  it('shows OFFLINE when timestamp is null', () => {
    updateSystemStatus({ health: null, sleep: null });
    const val = document.querySelector('[data-source="health"] [class*="sys-val"]');
    expect(val!.textContent).toBe('OFFLINE');
  });

  it('sets dot to red for offline source', () => {
    updateSystemStatus({ health: null, sleep: null });
    const dot = document.querySelector('[data-source="health"] .sys-dot');
    expect(dot!.className).toContain('sys-dot-red');
  });

  it('does not throw when container is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateSystemStatus({ health: null })).not.toThrow();
  });
});

// ── updateExplorationOdometer ──────────────────────────────────────────────────

describe('updateExplorationOdometer', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardExplorationOdometer" class="is-loading">
        <div data-loc="odo-visits">0</div>
        <div data-loc="odo-places">0</div>
        <div data-loc="odo-cities">0</div>
        <div data-loc="odo-states">0</div>
        <div data-loc="odo-subtitle" style="display:none"></div>
      </div>
    `;
  });

  it('sets visits count', () => {
    updateExplorationOdometer(makeLocation());
    expect(el('cardExplorationOdometer').querySelector('[data-loc="odo-visits"]')!.textContent).toMatch(/500/);
  });

  it('sets places count', () => {
    updateExplorationOdometer(makeLocation());
    expect(el('cardExplorationOdometer').querySelector('[data-loc="odo-places"]')!.textContent).toMatch(/80/);
  });

  it('sets cities count', () => {
    updateExplorationOdometer(makeLocation());
    expect(el('cardExplorationOdometer').querySelector('[data-loc="odo-cities"]')!.textContent).toMatch(/5/);
  });

  it('sets subtitle with current city when present', () => {
    updateExplorationOdometer(makeLocation());
    const subtitle = el('cardExplorationOdometer').querySelector('[data-loc="odo-subtitle"]') as HTMLElement;
    expect(subtitle.innerHTML).toContain('Los Angeles');
  });

  it('removes is-loading', () => {
    updateExplorationOdometer(makeLocation());
    expect(el('cardExplorationOdometer').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateExplorationOdometer(makeLocation())).not.toThrow();
  });
});

// ── updateStreakFlame ──────────────────────────────────────────────────────────

describe('updateStreakFlame', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardStreakFlame" class="is-loading">
        <div data-loc="streak-current">0</div>
        <div data-loc="streak-longest">0</div>
        <div data-loc="streak-active">0</div>
      </div>
    `;
  });

  it('sets current streak', () => {
    updateStreakFlame(makeLocation());
    expect(el('cardStreakFlame').querySelector('[data-loc="streak-current"]')!.textContent).toBe('7');
  });

  it('sets longest streak', () => {
    updateStreakFlame(makeLocation());
    expect(el('cardStreakFlame').querySelector('[data-loc="streak-longest"]')!.textContent).toBe('21');
  });

  it('sets total active days', () => {
    updateStreakFlame(makeLocation());
    expect(el('cardStreakFlame').querySelector('[data-loc="streak-active"]')!.textContent).toBe('45');
  });

  it('removes is-loading', () => {
    updateStreakFlame(makeLocation());
    expect(el('cardStreakFlame').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateStreakFlame(makeLocation())).not.toThrow();
  });
});

// ── updatePlaceLeaderboard ─────────────────────────────────────────────────────

describe('updatePlaceLeaderboard', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardPlaceLeaderboard" class="is-loading">
        <div data-loc="leaderboard-list"></div>
      </div>
    `;
  });

  it('renders place names', () => {
    updatePlaceLeaderboard(makeLocation());
    expect(el('cardPlaceLeaderboard').innerHTML).toContain('Coffee Shop');
    expect(el('cardPlaceLeaderboard').innerHTML).toContain('Gym');
  });

  it('renders visit counts', () => {
    updatePlaceLeaderboard(makeLocation());
    expect(el('cardPlaceLeaderboard').innerHTML).toContain('40');
  });

  it('renders category badges', () => {
    updatePlaceLeaderboard(makeLocation());
    expect(el('cardPlaceLeaderboard').innerHTML).toContain('Dining');
  });

  it('removes is-loading', () => {
    updatePlaceLeaderboard(makeLocation());
    expect(el('cardPlaceLeaderboard').classList.contains('is-loading')).toBe(false);
  });

  it('removes is-loading when topPlaces is empty', () => {
    updatePlaceLeaderboard(makeLocation({ topPlaces: [] }));
    expect(el('cardPlaceLeaderboard').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updatePlaceLeaderboard(makeLocation())).not.toThrow();
  });
});

// ── updateRhythmBars ──────────────────────────────────────────────────────────

describe('updateRhythmBars', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardRhythmBars" class="is-loading">
        <div data-loc="rhythm-bars"></div>
        <div data-loc="rhythm-busiest"></div>
      </div>
    `;
  });

  it('renders 7 bar columns', () => {
    updateRhythmBars(makeLocation());
    const bars = el('cardRhythmBars').querySelectorAll('.rb-bar-col');
    expect(bars.length).toBe(7);
  });

  it('renders busiest day label', () => {
    updateRhythmBars(makeLocation());
    const busiest = el('cardRhythmBars').querySelector('[data-loc="rhythm-busiest"]');
    expect(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']).toContain(busiest!.textContent);
  });

  it('removes is-loading', () => {
    updateRhythmBars(makeLocation());
    expect(el('cardRhythmBars').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateRhythmBars(makeLocation())).not.toThrow();
  });
});

// ── updateWaffleGrid ──────────────────────────────────────────────────────────

describe('updateWaffleGrid', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardWaffleGrid" class="is-loading">
        <div data-loc="waffle-grid"></div>
        <div data-loc="waffle-legend"></div>
      </div>
    `;
  });

  it('renders 100 waffle cells', () => {
    updateWaffleGrid(makeLocation());
    const cells = el('cardWaffleGrid').querySelectorAll('.wg-cell');
    expect(cells.length).toBe(100);
  });

  it('renders legend items', () => {
    updateWaffleGrid(makeLocation());
    const items = el('cardWaffleGrid').querySelectorAll('.wg-legend-item');
    expect(items.length).toBeGreaterThan(0);
  });

  it('removes is-loading', () => {
    updateWaffleGrid(makeLocation());
    expect(el('cardWaffleGrid').classList.contains('is-loading')).toBe(false);
  });

  it('removes is-loading when total minutes is 0', () => {
    const data = makeLocation({ categoryBreakdown: [] });
    updateWaffleGrid(data);
    expect(el('cardWaffleGrid').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateWaffleGrid(makeLocation())).not.toThrow();
  });
});

// ── updateCategoryTerrain ─────────────────────────────────────────────────────

describe('updateCategoryTerrain', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardCategoryTerrain" class="is-loading">
        <div data-loc="terrain-bar"></div>
        <div data-loc="terrain-labels"></div>
      </div>
    `;
  });

  it('renders terrain segments', () => {
    updateCategoryTerrain(makeLocation());
    const segs = el('cardCategoryTerrain').querySelectorAll('.ct-segment');
    expect(segs.length).toBe(2);
  });

  it('renders category labels', () => {
    updateCategoryTerrain(makeLocation());
    expect(el('cardCategoryTerrain').innerHTML).toContain('Dining');
  });

  it('removes is-loading', () => {
    updateCategoryTerrain(makeLocation());
    expect(el('cardCategoryTerrain').classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateCategoryTerrain(makeLocation())).not.toThrow();
  });
});

// ── updateExplorationRings ────────────────────────────────────────────────────

describe('updateExplorationRings', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardExplorationRings" class="is-loading">
        <circle data-loc="ring-neighborhoods" style=""></circle>
        <circle data-loc="ring-cities" style=""></circle>
        <circle data-loc="ring-states" style=""></circle>
        <span data-loc="ring-neighborhoods-count"></span>
        <span data-loc="ring-cities-count"></span>
        <span data-loc="ring-states-count"></span>
      </div>
    `;
  });

  it('sets count text for neighborhoods', () => {
    updateExplorationRings(makeLocation());
    const el = document.querySelector('[data-loc="ring-neighborhoods-count"]');
    expect(el!.textContent).toContain('12');
  });

  it('sets count text for cities', () => {
    updateExplorationRings(makeLocation());
    const el = document.querySelector('[data-loc="ring-cities-count"]');
    expect(el!.textContent).toContain('5');
  });

  it('sets count text for states', () => {
    updateExplorationRings(makeLocation());
    const el = document.querySelector('[data-loc="ring-states-count"]');
    expect(el!.textContent).toContain('3');
  });

  it('removes is-loading', () => {
    updateExplorationRings(makeLocation());
    expect(document.getElementById('cardExplorationRings')!.classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateExplorationRings(makeLocation())).not.toThrow();
  });
});

// ── updateDurationDonut ────────────────────────────────────────────────────────

describe('updateDurationDonut', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardDurationDonut" class="is-loading">
        <div data-loc="donut-total"></div>
        <div data-loc="donut-ring"></div>
        <div data-loc="donut-legend"></div>
      </div>
    `;
  });

  it('sets total hours', () => {
    updateDurationDonut(makeLocation());
    const total = document.querySelector('[data-loc="donut-total"]');
    expect(total!.textContent).toBe('300');
  });

  it('sets conic-gradient on ring', () => {
    updateDurationDonut(makeLocation());
    const ring = document.querySelector('[data-loc="donut-ring"]') as HTMLElement;
    expect(ring.style.background).toContain('conic-gradient');
  });

  it('renders legend items', () => {
    updateDurationDonut(makeLocation());
    const legend = document.querySelector('[data-loc="donut-legend"]');
    expect(legend!.querySelectorAll('.wg-legend-item').length).toBeGreaterThan(0);
  });

  it('removes is-loading', () => {
    updateDurationDonut(makeLocation());
    expect(document.getElementById('cardDurationDonut')!.classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateDurationDonut(makeLocation())).not.toThrow();
  });
});

// ── updateStreakCalendar ───────────────────────────────────────────────────────

describe('updateStreakCalendar', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardStreakCalendar" class="is-loading">
        <div data-loc="streak-calendar-grid"></div>
        <div data-loc="streak-calendar-count"></div>
      </div>
    `;
  });

  it('renders cells for each day in last30', () => {
    updateStreakCalendar(makeLocation());
    // last90Days has 3 entries, sliced to last 30
    const cells = document.querySelectorAll('.sc-cell:not(.sc-cell-empty)');
    expect(cells.length).toBe(3);
  });

  it('sets current streak count', () => {
    updateStreakCalendar(makeLocation());
    const count = document.querySelector('[data-loc="streak-calendar-count"]');
    expect(count!.textContent).toBe('7');
  });

  it('removes is-loading', () => {
    updateStreakCalendar(makeLocation());
    expect(document.getElementById('cardStreakCalendar')!.classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateStreakCalendar(makeLocation())).not.toThrow();
  });
});

// ── updateCityConstellation ───────────────────────────────────────────────────

describe('updateCityConstellation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardCityConstellation" class="is-loading">
        <svg data-loc="constellation-svg"></svg>
        <div data-loc="constellation-list"></div>
      </div>
    `;
  });

  it('renders city circles in SVG', () => {
    updateCityConstellation(makeLocation());
    const circles = document.querySelectorAll('[data-loc="constellation-svg"] circle');
    expect(circles.length).toBe(2);
  });

  it('renders city list rows', () => {
    updateCityConstellation(makeLocation());
    const rows = document.querySelectorAll('.cc-city-row');
    expect(rows.length).toBe(2);
  });

  it('renders city names in list', () => {
    updateCityConstellation(makeLocation());
    expect(document.querySelector('[data-loc="constellation-list"]')!.innerHTML).toContain('Los Angeles');
  });

  it('removes is-loading', () => {
    updateCityConstellation(makeLocation());
    expect(document.getElementById('cardCityConstellation')!.classList.contains('is-loading')).toBe(false);
  });

  it('removes is-loading when cityBreakdown is empty', () => {
    updateCityConstellation(makeLocation({ cityBreakdown: [] }));
    expect(document.getElementById('cardCityConstellation')!.classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateCityConstellation(makeLocation())).not.toThrow();
  });
});

// ── updateBookshelf ────────────────────────────────────────────────────────────

describe('updateBookshelf', () => {
  function makeBooks(overrides: Partial<AdaptedBooks> = {}): AdaptedBooks {
    return {
      books: [
        {
          title: 'Test Book',
          author: 'Test Author',
          asin: 'B001TEST',
          status: 'in_progress',
          rating: null,
          progress: 42,
          link: 'https://amazon.com/dp/B001TEST',
          cover: null,
          coverThumb: null,
          coverCard: null,
          notes: null,
        },
      ],
      bookMeta: {},
      statusLabels: { in_progress: 'Reading', next: 'Up Next', completed: 'Finished', finished: 'Finished' },
      stats: { total: 1, reading: 1, completed: 0, upcoming: 0 },
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cardBooks" class="is-loading">
        <div id="dashShelfRow"></div>
      </div>
    `;
  });

  it('renders book title', () => {
    updateBookshelf(makeBooks());
    expect(document.getElementById('dashShelfRow')!.innerHTML).toContain('Test Book');
  });

  it('renders book author', () => {
    updateBookshelf(makeBooks());
    expect(document.getElementById('dashShelfRow')!.innerHTML).toContain('Test Author');
  });

  it('renders READING status for in_progress', () => {
    updateBookshelf(makeBooks());
    expect(document.getElementById('dashShelfRow')!.innerHTML).toContain('READING');
  });

  it('renders progress bar for in_progress book', () => {
    updateBookshelf(makeBooks());
    expect(document.getElementById('dashShelfRow')!.innerHTML).toContain('42%');
  });

  it('removes is-loading from cardBooks', () => {
    updateBookshelf(makeBooks());
    expect(document.getElementById('cardBooks')!.classList.contains('is-loading')).toBe(false);
  });

  it('does not throw when dashShelfRow is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateBookshelf(makeBooks())).not.toThrow();
  });

  it('adds shelf-book-active class for in_progress book', () => {
    updateBookshelf(makeBooks());
    expect(document.querySelector('.shelf-book')!.classList.contains('shelf-book-active')).toBe(true);
  });

  it('renders stars for completed books with rating', () => {
    const books = makeBooks({
      books: [{
        title: 'Done Book',
        author: 'Author',
        asin: 'B002TEST',
        status: 'completed',
        rating: 4,
        progress: undefined,
        link: 'https://amazon.com/dp/B002TEST',
        cover: null,
        coverThumb: null,
        coverCard: null,
        notes: null,
      }],
    });
    updateBookshelf(books);
    expect(document.getElementById('dashShelfRow')!.innerHTML).toContain('star-on');
  });

  it('updates in-place when existing book count matches', () => {
    // Pre-populate with same count of .shelf-book elements
    document.getElementById('dashShelfRow')!.innerHTML = `
      <div class="shelf-book" data-book='{}'>
        <img src="" alt="">
        <div class="shelf-book-title"><span>Old Title</span></div>
        <div class="shelf-book-author">Old Author</div>
        <div class="shelf-book-status shelf-status-next">Up Next</div>
      </div>
    `;
    updateBookshelf(makeBooks());
    expect(document.querySelector('.shelf-book-title span')!.textContent).toBe('Test Book');
  });
});
