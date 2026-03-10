import { classifyHeartRate, classifyHRV } from './heart-rate';
import { HYDRATION } from './constants';
import type { AdaptedHealth, AdaptedSleep, AdaptedBooks, AdaptedGithubEvent, BookMeta, WorkoutEntry, AdaptedArticle } from './adapters';
import type { LocationExport } from '../types/exports';
import { imgFallbackAttrs, localizeImageUrl } from './image-utils';

const CATEGORY_COLORS: Record<string, string> = {
  'Dining':              'var(--neon-orange, #ff6b00)',
  'Fitness & Outdoors':  'var(--neon-green, #06d6a0)',
  'Shopping':            'var(--neon-purple, #a855f7)',
  'Entertainment':       'var(--neon-pink, #ff006e)',
  'Travel':              'var(--neon-cyan, #00d4ff)',
  'Health':              'var(--neon-red, #ef4444)',
  'Work':                'var(--neon-blue, #3a86ff)',
  'Education':           'var(--neon-indigo, #818cf8)',
  'Services':            'var(--neon-amber, #f59e0b)',
};
const CATEGORY_FALLBACK_COLOR = 'var(--text-muted, #9ca3af)';

export function getCategoryColor(category: string | null): string {
  if (!category) return CATEGORY_FALLBACK_COLOR;
  return CATEGORY_COLORS[category] ?? CATEGORY_FALLBACK_COLOR;
}

const ACCENT_CLASSES = [
  'tri-card-accent-pink', 'tri-card-accent-blue', 'tri-card-accent-green',
  'tri-card-accent-amber', 'tri-card-accent-red', 'tri-card-accent-purple',
  'tri-card-accent-cyan', 'tri-card-accent-orange', 'tri-card-accent-indigo',
];

export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function updateHeartRate(data: AdaptedHealth): void {
  const hr = Math.round(data.quantities.heartRate.value);
  const hrv = Math.round(data.quantities.hrvSDNN.value);
  const zone = classifyHeartRate(hr);
  const hrvStyle = classifyHRV(hrv);

  const bpm = document.getElementById('pulseBpm');
  if (bpm) {
    bpm.textContent = String(hr);
    bpm.style.color = zone.bpmColor;
    bpm.style.textShadow = zone.bpmShadow;
  }

  const badge = document.getElementById('hrZoneBadge');
  if (badge) {
    badge.textContent = zone.zone;
    badge.style.color = zone.badgeColor;
    badge.style.background = zone.badgeBg;
    badge.style.border = '1px solid ' + zone.badgeBorder;
  }

  const hrvEl = document.getElementById('hrHrvValue');
  if (hrvEl) {
    hrvEl.textContent = String(hrv);
    hrvEl.style.color = hrvStyle.color;
    hrvEl.style.textShadow = hrvStyle.shadow;
  }

  // Update canvas ECG parameters
  const ecgUpdate = (window as any).__ecgUpdate;
  if (typeof ecgUpdate === 'function') {
    ecgUpdate(hr, hrv, zone.ecgStroke);
  }

  const ecgBg = document.getElementById('hrEcgBg');
  if (ecgBg) {
    ecgBg.style.opacity = String(zone.ecgOpacity);
  }

  const card = document.getElementById('cardHR');
  if (card) {
    card.classList.remove(...ACCENT_CLASSES);
    card.classList.add(zone.accentClass);
    card.classList.remove('is-loading');
  }
}

export function updateDailyActivity(data: AdaptedHealth): void {
  const q = data.quantities;
  const card = document.getElementById('cardSteps');
  if (!card) return;

  const metrics: Record<string, string> = {
    steps: Math.round(q.stepCount.value).toLocaleString(),
    distance: String(Math.round(q.distanceWalkingRunning.value)),
    exercise: String(q.exerciseTime?.value ?? 0),
    active: String(Math.round(q.activeEnergyBurned.value)),
    basal: String(Math.round(q.basalEnergyBurned.value)),
    total: String(Math.round(data.derived.totalCalories)),
  };

  for (const [key, val] of Object.entries(metrics)) {
    const el = card.querySelector<HTMLElement>(`[data-metric="${key}"]`);
    if (el) {
      const unit = el.querySelector('.split-metric-unit');
      if (unit) {
        el.firstChild!.textContent = val;
      } else {
        el.textContent = val;
      }
    }
  }

  card.classList.remove('is-loading');
}

export function updateWorkouts(data: WorkoutEntry[] | null): void {
  const card = document.getElementById('cardWorkouts');
  if (!card) return;

  if (!data || data.length === 0) return;

  const body = card.querySelector('.widget-body');
  if (!body) return;

  card.style.display = '';

  function fmtDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm' + (s > 0 ? ' ' + s + 's' : '');
  }

  function getIcon(type: string): string {
    if (type === 'Outdoor Walk') {
      return '<svg class="workout-sub-icon" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="5" r="3" fill="var(--neon-pink)" opacity="0.8"/><path d="M14 8 L14 17 M14 12 L9 15 M14 12 L19 15 M12 27 L14 17 L16 27" stroke="var(--neon-pink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/></svg>';
    }
    if (type === "Barry's Bootcamp") {
      return '<svg class="workout-sub-icon" viewBox="0 0 28 28" fill="none"><rect x="3" y="12" width="22" height="4" rx="2" stroke="var(--neon-pink)" stroke-width="1.8" opacity="0.8"/><rect x="1" y="10" width="4" height="8" rx="1.5" stroke="var(--neon-pink)" stroke-width="1.5" opacity="0.6"/><rect x="23" y="10" width="4" height="8" rx="1.5" stroke="var(--neon-pink)" stroke-width="1.5" opacity="0.6"/><circle cx="8" cy="14" r="3" stroke="var(--neon-pink)" stroke-width="1.2" opacity="0.5"/><circle cx="20" cy="14" r="3" stroke="var(--neon-pink)" stroke-width="1.2" opacity="0.5"/></svg>';
    }
    return '<svg class="workout-sub-icon" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="10" stroke="var(--neon-pink)" stroke-width="1.8" opacity="0.6"/><path d="M14 8 L14 14 L19 14" stroke="var(--neon-pink)" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/></svg>';
  }

  let html = '';
  data.forEach((w: WorkoutEntry) => {
    html += '<div class="workout-sub-card">';
    html += '<div class="workout-sub-top">';
    html += getIcon(w.activityType);
    html += w.activityUrl
      ? '<a class="workout-sub-type" href="' + esc(w.activityUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(w.activityType) + '</a>'
      : '<div class="workout-sub-type">' + esc(w.activityType) + '</div>';
    html += '</div>';
    html += '<div class="workout-sub-stats">';
    html += '<div class="workout-stat"><div class="workout-stat-label">Duration</div><div class="workout-stat-value">' + fmtDuration(w.duration ?? 0) + '</div></div>';
    html += '<div class="workout-stat"><div class="workout-stat-label">Calories</div><div class="workout-stat-value">' + Math.round(w.energyBurned ?? 0) + ' kcal</div></div>';
    if (w.distance && w.distance > 0) {
      html += '<div class="workout-stat"><div class="workout-stat-label">Distance</div><div class="workout-stat-value">' + (w.distance / 1000).toFixed(2) + ' km</div></div>';
    }
    html += '</div>';
    html += '</div>';
  });

  body.innerHTML = html;
}

export function updateNightSummary(data: AdaptedSleep): void {
  if (data.isEmpty) {
    const duration = document.getElementById('sleepDuration');
    if (duration) duration.textContent = '--';

    const scoreVal = document.getElementById('sleepScoreVal');
    if (scoreVal) scoreVal.textContent = '--';

    const scoreFill = document.getElementById('sleepScoreFill') as HTMLElement | null;
    if (scoreFill) scoreFill.style.width = '0%';

    const phases = ['deep', 'rem', 'core', 'awake'];
    phases.forEach((phase) => {
      const pill = document.querySelector(`[data-phase="${phase}"]`);
      if (pill) {
        const val = pill.querySelector('.sleep-moon-pill-val');
        if (val) val.textContent = '--';
      }
    });

    const insight = document.getElementById('sleepInsight');
    if (insight) insight.innerHTML = '<span class="sleep-insight-empty">No sleep data recorded</span>';

    const timestamp = document.getElementById('sleepTimestamp');
    if (timestamp) timestamp.textContent = 'no data';

    document.getElementById('cardSleep')?.classList.remove('is-loading');
    return;
  }

  const duration = document.getElementById('sleepDuration');
  if (duration) {
    duration.textContent = data.sleepDurationFormatted;
  }

  const scoreVal = document.getElementById('sleepScoreVal');
  if (scoreVal) {
    scoreVal.textContent = String(data.sleepScore);
  }

  const scoreFill = document.getElementById('sleepScoreFill') as HTMLElement | null;
  if (scoreFill) {
    scoreFill.style.width = data.sleepScore + '%';
  }

  const phases = ['deep', 'rem', 'core', 'awake'];
  phases.forEach((phase) => {
    const pill = document.querySelector(`[data-phase="${phase}"]`);
    if (pill) {
      const val = pill.querySelector('.sleep-moon-pill-val');
      if (val) {
        val.textContent = data.sleepPhaseFormatted[phase];
      }
    }
  });

  const insight = document.getElementById('sleepInsight');
  if (insight) {
    insight.innerHTML = '<span>' + data.derived.deepPct + '% deep</span> &mdash; <span>' + data.derived.remPct + '% REM</span> &mdash; restorative sleep';
  }

  const timestamp = document.getElementById('sleepTimestamp');
  if (timestamp) timestamp.textContent = 'last night';

  document.getElementById('cardSleep')?.classList.remove('is-loading');
}

export function updateHydration(data: AdaptedHealth): void {
  const waterOz = data.hydration.waterOz;
  const caffeineMg = data.hydration.caffeineMg;

  const waterLiq = document.getElementById('hydraWaterLiq');
  if (waterLiq) {
    const waterPct = Math.min(waterOz / HYDRATION.waterMax, 1) * 100;
    waterLiq.style.clipPath = 'inset(' + (100 - waterPct) + '% 0 0 0)';
  }

  const waterVal = document.getElementById('hydraWaterVal') as HTMLElement | null;
  if (waterVal) {
    waterVal.dataset.liveUpdated = '1';
    waterVal.textContent = waterOz + ' oz';
  }

  const coffeeLiq = document.getElementById('hydraCoffeeLiq');
  if (coffeeLiq) {
    const caffeinePct = Math.min(caffeineMg / HYDRATION.caffeineMax, 1) * 100;
    coffeeLiq.style.clipPath = 'inset(' + (100 - caffeinePct) + '% 0 0 0)';
  }

  const coffeeVal = document.getElementById('hydraCoffeeVal') as HTMLElement | null;
  if (coffeeVal) {
    coffeeVal.dataset.liveUpdated = '1';
    coffeeVal.textContent = caffeineMg + ' mg';
  }

  const coffeeLabel = document.getElementById('hydraCoffeeLabel');
  if (coffeeLabel) {
    coffeeLabel.textContent = 'Caffeine';
  }

  document.getElementById('cardHydration')?.classList.remove('is-loading');
}

export function updateDevActivityLog(events: AdaptedGithubEvent[]): void {
  const card = document.getElementById('cardDevLog');
  if (!card) return;

  if (!events || events.length === 0) return;

  const body = card.querySelector('.widget-body');
  if (!body) return;

  const iconMap: Record<string, { symbol: string; color: string }> = {
    'commit':       { symbol: '\u2192', color: 'var(--neon-green)' },
    'pr_opened':    { symbol: '\u2295', color: 'var(--neon-blue)' },
    'pr_closed':    { symbol: '\u2296', color: 'var(--neon-blue)' },
    'pr_merged':    { symbol: '\u229E', color: 'var(--neon-blue)' },
    'issue_opened': { symbol: '\u25C9', color: 'var(--neon-amber)' },
    'issue_closed': { symbol: '\u2714', color: 'var(--neon-amber)' },
  };
  const fallbackIcon = { symbol: '\u00B7', color: 'var(--neon-green)' };

  let html = '<div class="gh-dal-terminal">';
  events.forEach((e: AdaptedGithubEvent) => {
    const icon = iconMap[e.type] || fallbackIcon;
    let detail = '';
    if (e.type === 'commit' && e.hash) {
      detail = '<span style="color:var(--neon-green)">+' + (e.additions || 0) + '</span> <span style="color:var(--neon-red)">-' + (e.deletions || 0) + '</span>';
    } else if (e.number !== undefined) {
      detail = '#' + e.number;
    }

    if (e.url) {
      html += '<a class="gh-dal-line" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">';
    } else {
      html += '<a class="gh-dal-line">';
    }
    html += '<span class="gh-dal-icon" style="color: ' + icon.color + ';">' + icon.symbol + '</span>';
    html += '<span class="gh-dal-repo">' + esc(e.repo) + '</span>';
    html += '<span class="gh-dal-title">' + esc(e.title) + '</span>';
    if (detail) {
      html += '<span class="gh-dal-detail">' + detail + '</span>';
    }
    html += '<span class="gh-dal-date">' + esc(e.date) + '</span>';
    html += '</a>';
  });
  html += '</div>';

  body.innerHTML = html;
  card.classList.remove('is-loading');
}

export function updateReadingFeed(articles: AdaptedArticle[]): void {
  const card = document.getElementById('cardReading');
  if (!card) return;

  if (!articles || articles.length === 0) return;

  const body = card.querySelector('.widget-body');
  if (!body) return;

  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(articles.length / PAGE_SIZE);
  let currentPage = 1;

  function renderPage(page: number): void {
    if (!body) return;
    const start = (page - 1) * PAGE_SIZE;
    const pageArticles = articles.slice(start, start + PAGE_SIZE);

    let html = '<ul class="article-list" aria-live="polite">';
    pageArticles.forEach((a: AdaptedArticle, i: number) => {
      html += '<li class="article-list-item" style="animation-delay: ' + (i * 0.07) + 's">';
      if (a.hasNotes) {
        html += '<span class="article-list-note" title="' + esc(a.noteText || '') + '">';
        html += '<svg class="article-list-note-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">';
        html += '<path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5l-3 3V3z" stroke="currentColor" stroke-width="1.2"/>';
        html += '<line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1"/>';
        html += '<line x1="5" y1="8.5" x2="9" y2="8.5" stroke="currentColor" stroke-width="1"/>';
        html += '</svg>';
        html += '</span>';
      }
      if (a.url) {
        html += '<a class="article-list-title" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.title) + '</a>';
      } else {
        html += '<span class="article-list-title">' + esc(a.title) + '</span>';
      }
      html += '<span class="article-list-source">(' + esc(a.source) + ')</span>';
      html += '<span class="article-list-date">' + esc(a.date) + '</span>';
      html += '</li>';
    });
    html += '</ul>';

    if (totalPages > 1) {
      html += '<div class="article-pagination">';
      for (let p = 1; p <= totalPages; p++) {
        const activeClass = p === page ? ' article-page-active' : '';
        const ariaCurrent = p === page ? ' aria-current="page"' : '';
        html += '<button class="article-page-btn' + activeClass + '"' + ariaCurrent + ' data-page="' + p + '" aria-label="Page ' + p + ' of ' + totalPages + '">' + p + '</button>';
      }
      html += '</div>';
    }

    body.innerHTML = html;

    if (totalPages > 1) {
      const buttons = body.querySelectorAll('.article-page-btn');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetPage = parseInt((btn as HTMLElement).dataset.page || '1', 10);
          if (targetPage !== currentPage) {
            currentPage = targetPage;
            renderPage(currentPage);
          }
        });
      });
    }
  }

  renderPage(currentPage);
  card.classList.remove('is-loading');
}

export function updateSystemStatus(timestamps: Record<string, string | null>): void {
  const container = document.getElementById('systemStatus');
  if (!container) return;

  var SOURCE_LINE_COLORS: Record<string, string> = {
    health: 'red',
    sleep: 'purple',
    location: 'blue',
    books: 'amber',
    articles: 'amber',
    theatreReviews: 'yellow',
  };

  const lines = container.querySelectorAll('.sys-line');
  lines.forEach((line) => {
    const source = (line as HTMLElement).dataset.source;
    if (!source) return;

    const dot = line.querySelector('.sys-dot');
    const valEl = line.querySelector('[class*="sys-val"]');
    const keyEl = line.querySelector('[class*="sys-key"]');
    if (!dot || !valEl) return;

    const ts = timestamps[source];
    if (ts) {
      const ago = formatRelativeTime(ts);
      const lineColor = SOURCE_LINE_COLORS[source] || 'green';
      dot.className = 'sys-dot sys-dot-' + lineColor;
      if (keyEl) {
        keyEl.className = 'sys-key sys-key-' + lineColor;
      }
      valEl.className = 'sys-val-green';
      valEl.innerHTML = 'ACTIVE <span class="sys-val">(' + ago + ')</span>';
    } else {
      dot.className = 'sys-dot sys-dot-red';
      if (keyEl) {
        keyEl.className = 'sys-key';
      }
      valEl.className = 'sys-val-red';
      valEl.textContent = 'OFFLINE';
    }
  });
}

export function updateExplorationOdometer(data: LocationExport): void {
  const card = document.getElementById('cardExplorationOdometer');
  if (!card) return;

  const fields: Record<string, number> = {
    'odo-visits': data.totalVisits,
    'odo-places': data.totalPlaces,
    'odo-cities': data.explorationStats.totalCities,
    'odo-states': data.explorationStats.totalStates,
  };

  for (const [key, value] of Object.entries(fields)) {
    const el = card.querySelector<HTMLElement>(`[data-loc="${key}"]`);
    if (el) el.textContent = value.toLocaleString();
  }

  const subtitleEl = card.querySelector<HTMLElement>('[data-loc="odo-subtitle"]');
  if (subtitleEl && data.currentCity) {
    let text = esc(data.currentCity);
    if (data.lastSeen) text += ' · ' + formatRelativeTime(data.lastSeen);
    subtitleEl.innerHTML = text;
    subtitleEl.style.display = '';
  }

  card.classList.remove('is-loading');
}

export function updateStreakFlame(data: LocationExport): void {
  const card = document.getElementById('cardStreakFlame');
  if (!card) return;

  const currentEl = card.querySelector('[data-loc="streak-current"]');
  if (currentEl) currentEl.textContent = String(data.streaks.currentStreak);

  const longestEl = card.querySelector('[data-loc="streak-longest"]');
  if (longestEl) longestEl.textContent = String(data.streaks.longestStreak);

  const activeEl = card.querySelector('[data-loc="streak-active"]');
  if (activeEl) activeEl.textContent = String(data.streaks.totalActiveDays);

  card.classList.remove('is-loading');
}

export function updatePlaceLeaderboard(data: LocationExport): void {
  const card = document.getElementById('cardPlaceLeaderboard');
  if (!card) return;

  const listEl = card.querySelector<HTMLElement>('[data-loc="leaderboard-list"]');
  if (!listEl || data.topPlaces.length === 0) {
    card.classList.remove('is-loading');
    return;
  }

  const maxVisits = Math.max(...data.topPlaces.map(p => p.visitCount), 1);

  listEl.innerHTML = data.topPlaces.slice(0, 8).map((place, i) => {
    const barWidth = ((place.visitCount / maxVisits) * 100).toFixed(1);
    const catColor = getCategoryColor(place.category);
    const catBadge = place.category
      ? `<span class="pl-cat" style="color:${catColor};border-color:${catColor}">${esc(place.category)}</span>`
      : '';
    return `<div class="pl-row">
      <span class="pl-rank">${i + 1}</span>
      <span class="pl-name">${esc(place.name)}</span>
      ${catBadge}
      <div class="pl-bar-wrapper"><div class="pl-bar-fill" style="width:${barWidth}%"></div></div>
      <span class="pl-visits">${place.visitCount}</span>
    </div>`;
  }).join('');

  card.classList.remove('is-loading');
}

export function updateRhythmBars(data: LocationExport): void {
  const card = document.getElementById('cardRhythmBars');
  if (!card) return;

  // Group by day of week: 0=Sun,1=Mon,...6=Sat
  const dayCounts = new Array(7).fill(0);
  for (const d of data.last90Days) {
    const dow = new Date(d.date).getDay();
    dayCounts[dow] += d.count;
  }

  // Reorder Mon(1)...Sun(0)
  const ordered = [1, 2, 3, 4, 5, 6, 0].map(i => dayCounts[i]);
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const maxCount = Math.max(...ordered, 1);

  const barsEl = card.querySelector<HTMLElement>('[data-loc="rhythm-bars"]');
  if (barsEl) {
    barsEl.innerHTML = ordered.map((count, i) => {
      const heightPct = ((count / maxCount) * 100).toFixed(1);
      return `<div class="rb-bar-col">
        <div class="rb-bar" style="height:${heightPct}%" title="${dayNames[i]}: ${count} visits"></div>
        <span class="rb-day">${dayLabels[i]}</span>
      </div>`;
    }).join('');
  }

  const maxIdx = ordered.indexOf(Math.max(...ordered));
  const busiestEl = card.querySelector('[data-loc="rhythm-busiest"]');
  if (busiestEl) busiestEl.textContent = dayNames[maxIdx] ?? '—';

  card.classList.remove('is-loading');
}

export function updateWaffleGrid(data: LocationExport): void {
  const card = document.getElementById('cardWaffleGrid');
  if (!card) return;

  const cats = [...data.categoryBreakdown].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const totalMinutes = cats.reduce((s, c) => s + c.totalMinutes, 0);

  if (totalMinutes === 0) {
    card.classList.remove('is-loading');
    return;
  }

  // Assign cells out of 100, rounding so they sum to 100
  let remaining = 100;
  const catCells: { category: string; cells: number; color: string; pct: number }[] = [];
  cats.forEach((cat, i) => {
    const pct = cat.totalMinutes / totalMinutes;
    const cells = i === cats.length - 1 ? remaining : Math.round(pct * 100);
    remaining -= cells;
    catCells.push({ category: cat.category, cells, color: getCategoryColor(cat.category), pct });
  });

  // Build 100 cells
  const cellColors: string[] = [];
  const cellTitles: string[] = [];
  for (const { category, cells, color, pct } of catCells) {
    for (let j = 0; j < cells; j++) {
      cellColors.push(color);
      cellTitles.push(`${category}: ${(pct * 100).toFixed(0)}%`);
    }
  }

  const gridEl = card.querySelector<HTMLElement>('[data-loc="waffle-grid"]');
  if (gridEl) {
    gridEl.innerHTML = cellColors.map((color, i) =>
      `<div class="wg-cell" style="background:${color}" title="${esc(cellTitles[i] ?? '')}"></div>`
    ).join('');
  }

  const legendEl = card.querySelector<HTMLElement>('[data-loc="waffle-legend"]');
  if (legendEl) {
    legendEl.innerHTML = catCells.map(({ category, color, pct }) =>
      `<div class="wg-legend-item">
        <div class="wg-legend-dot" style="background:${color}"></div>
        <span class="wg-legend-label">${esc(category)} ${(pct * 100).toFixed(0)}%</span>
      </div>`
    ).join('');
  }

  card.classList.remove('is-loading');
}

export function updateCategoryTerrain(data: LocationExport): void {
  const card = document.getElementById('cardCategoryTerrain');
  if (!card) return;

  const cats = [...data.categoryBreakdown].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const totalMinutes = cats.reduce((s, c) => s + c.totalMinutes, 0);

  if (totalMinutes === 0) {
    card.classList.remove('is-loading');
    return;
  }

  const barEl = card.querySelector<HTMLElement>('[data-loc="terrain-bar"]');
  if (barEl) {
    barEl.innerHTML = cats.map((cat, i) => {
      const pct = ((cat.totalMinutes / totalMinutes) * 100).toFixed(2);
      const color = getCategoryColor(cat.category);
      const firstClass = i === 0 ? ' ct-segment-first' : '';
      const lastClass = i === cats.length - 1 ? ' ct-segment-last' : '';
      return `<div class="ct-segment${firstClass}${lastClass}" style="flex-basis:${pct}%;background:${color}" title="${esc(cat.category)}: ${parseFloat(pct).toFixed(0)}%"></div>`;
    }).join('');
  }

  const labelsEl = card.querySelector<HTMLElement>('[data-loc="terrain-labels"]');
  if (labelsEl) {
    labelsEl.innerHTML = cats.map(cat => {
      const pct = ((cat.totalMinutes / totalMinutes) * 100).toFixed(0);
      const color = getCategoryColor(cat.category);
      return `<div class="ct-label">
        <div class="ct-label-dot" style="background:${color}"></div>
        <span class="ct-label-text">${esc(cat.category)} ${pct}%</span>
      </div>`;
    }).join('');
  }

  card.classList.remove('is-loading');
}

export function updateExplorationRings(data: LocationExport): void {
  const card = document.getElementById('cardExplorationRings');
  if (!card) return;

  const RING_TARGETS = { neighborhoods: 50, cities: 10, states: 5 };
  const rings: { key: string; actual: number; target: number; r: number; countKey: string }[] = [
    { key: 'ring-neighborhoods', actual: data.explorationStats.totalNeighborhoods, target: RING_TARGETS.neighborhoods, r: 52, countKey: 'ring-neighborhoods-count' },
    { key: 'ring-cities', actual: data.explorationStats.totalCities, target: RING_TARGETS.cities, r: 40, countKey: 'ring-cities-count' },
    { key: 'ring-states', actual: data.explorationStats.totalStates, target: RING_TARGETS.states, r: 28, countKey: 'ring-states-count' },
  ];

  for (const ring of rings) {
    const progress = Math.min(ring.actual / ring.target, 1);
    const circumference = 2 * Math.PI * ring.r;
    const offset = circumference * (1 - progress);

    const ringEl = card.querySelector<SVGCircleElement>(`[data-loc="${ring.key}"]`);
    if (ringEl) {
      ringEl.style.strokeDasharray = String(circumference);
      ringEl.style.strokeDashoffset = String(offset);
    }

    const countEl = card.querySelector(`[data-loc="${ring.countKey}"]`);
    if (countEl) countEl.textContent = `${ring.actual} of ${ring.target}`;
  }

  card.classList.remove('is-loading');
}

export function updateDurationDonut(data: LocationExport): void {
  const card = document.getElementById('cardDurationDonut');
  if (!card) return;

  const cats = [...data.categoryBreakdown].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const totalMinutes = cats.reduce((s, c) => s + c.totalMinutes, 0);

  const totalEl = card.querySelector('[data-loc="donut-total"]');
  if (totalEl) totalEl.textContent = String(Math.round(data.totalDurationHours));

  if (totalMinutes > 0) {
    let cumPct = 0;
    const segments = cats.map(cat => {
      const pct = (cat.totalMinutes / totalMinutes) * 100;
      const start = cumPct;
      cumPct += pct;
      return { color: getCategoryColor(cat.category), start, end: cumPct };
    });

    const gradient = segments.map(s =>
      `${s.color} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`
    ).join(', ');

    const donutEl = card.querySelector<HTMLElement>('[data-loc="donut-ring"]');
    if (donutEl) donutEl.style.background = `conic-gradient(${gradient})`;

    const legendEl = card.querySelector<HTMLElement>('[data-loc="donut-legend"]');
    if (legendEl) {
      legendEl.innerHTML = cats.map(cat => {
        const pct = ((cat.totalMinutes / totalMinutes) * 100).toFixed(0);
        const color = getCategoryColor(cat.category);
        return `<div class="wg-legend-item">
          <div class="wg-legend-dot" style="background:${color}"></div>
          <span class="wg-legend-label">${esc(cat.category)} ${pct}%</span>
        </div>`;
      }).join('');
    }
  }

  card.classList.remove('is-loading');
}

export function updateStreakCalendar(data: LocationExport): void {
  const card = document.getElementById('cardStreakCalendar');
  if (!card) return;

  const days30 = data.last90Days.slice(-30);
  const activeDates = new Set(days30.filter(d => d.count > 0).map(d => d.date));

  // Determine which dates are in the current streak (working backwards from today)
  const streakDates = new Set<string>();
  const today = new Date();
  for (let i = 0; i < data.streaks.currentStreak; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    streakDates.add(d.toISOString().slice(0, 10));
  }

  // Align to Monday: find the weekday of the first day
  const firstDay = days30[0];
  let leadingEmpties = 0;
  if (firstDay) {
    const dow = new Date(firstDay.date).getDay(); // 0=Sun
    leadingEmpties = dow === 0 ? 6 : dow - 1; // Mon=0 offset
  }

  const gridEl = card.querySelector<HTMLElement>('[data-loc="streak-calendar-grid"]');
  if (gridEl) {
    let html = '';
    for (let i = 0; i < leadingEmpties; i++) {
      html += '<div class="sc-cell sc-cell-empty"></div>';
    }
    for (const day of days30) {
      const dayNum = new Date(day.date).getDate();
      const isActive = activeDates.has(day.date);
      const isStreak = streakDates.has(day.date);
      let cls = 'sc-cell';
      if (isActive) cls += ' sc-cell-active';
      if (isStreak) cls += ' sc-cell-streak';
      html += `<div class="${cls}" title="${esc(day.date)}">${dayNum}</div>`;
    }
    gridEl.innerHTML = html;
  }

  const countEl = card.querySelector('[data-loc="streak-calendar-count"]');
  if (countEl) countEl.textContent = String(data.streaks.currentStreak);

  card.classList.remove('is-loading');
}

export function updateCityConstellation(data: LocationExport): void {
  const card = document.getElementById('cardCityConstellation');
  if (!card) return;

  const cities = data.cityBreakdown;
  if (!cities || cities.length === 0) {
    card.classList.remove('is-loading');
    return;
  }

  const maxVisits = Math.max(...cities.map(c => c.visitCount), 1);
  const cx = 100;
  const cy = 80;
  const radius = 55;
  const N = cities.length;

  // Compute node positions
  const nodes = cities.map((city, i) => {
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const r = 4 + (city.visitCount / maxVisits) * 8;
    return { x, y, r, city };
  });

  const svgEl = card.querySelector<SVGSVGElement>('[data-loc="constellation-svg"]');
  if (svgEl) {
    let svgHtml = '';
    // Draw connecting lines
    for (let i = 0; i < nodes.length; i++) {
      const next = nodes[(i + 1) % nodes.length];
      svgHtml += `<line x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}" x2="${next.x.toFixed(1)}" y2="${next.y.toFixed(1)}" stroke="rgba(129,140,248,0.15)" stroke-width="1"/>`;
    }
    // Draw nodes
    nodes.forEach((node, i) => {
      const isPrimary = i === 0;
      const pulseClass = isPrimary ? ' class="cc-node-primary"' : '';
      svgHtml += `<circle${pulseClass} cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${node.r.toFixed(1)}" fill="var(--neon-indigo, #818cf8)" opacity="0.9" title="${esc(node.city.city)}">
        <title>${esc(node.city.city)}: ${node.city.visitCount} visits</title>
      </circle>`;
    });
    svgEl.innerHTML = svgHtml;
  }

  const listEl = card.querySelector<HTMLElement>('[data-loc="constellation-list"]');
  if (listEl) {
    listEl.innerHTML = cities.slice(0, 6).map((city, i) => {
      const barWidth = ((city.visitCount / maxVisits) * 100).toFixed(1);
      return `<div class="cc-city-row">
        <span class="cc-city-rank">${i + 1}</span>
        <span class="cc-city-name">${esc(city.city)}</span>
        <div class="cc-city-bar-wrapper"><div class="cc-city-bar-fill" style="width:${barWidth}%"></div></div>
        <span class="cc-city-count">${city.visitCount}</span>
      </div>`;
    }).join('');
  }

  card.classList.remove('is-loading');
}

export function formatRelativeTime(isoString: string): string {
  const msAgo = Date.now() - new Date(isoString).getTime();
  const minutesAgo = Math.max(0, Math.floor(msAgo / 60000));
  const hoursAgo = Math.floor(minutesAgo / 60);
  const daysAgo = Math.floor(hoursAgo / 24);
  if (daysAgo > 0) return daysAgo + 'd ago';
  if (hoursAgo > 0) return hoursAgo + 'h ago';
  return minutesAgo + 'm ago';
}

export function updateBookshelf(data: AdaptedBooks): void {
  const shelfRow = document.getElementById('dashShelfRow');
  if (!shelfRow) return;

  // Collect ASINs that have local images (present at SSR build time)
  const ssrBookEls = document.querySelectorAll('#dashShelfRow .shelf-book');
  const ssrAsins = new Set<string>();
  ssrBookEls.forEach(el => {
    try {
      const data = JSON.parse(el.getAttribute('data-book') || '{}');
      if (data.asin) ssrAsins.add(data.asin);
    } catch { /* ignore parse errors */ }
  });

  const statusLabels = data.statusLabels;
  const bookMeta = data.bookMeta;
  const statusOrder: Record<string, number> = { in_progress: 0, next: 1, completed: 2, finished: 2 };
  const sortedBooks = data.books.slice().sort((a, b) => {
    return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
  });
  const displayBooks = sortedBooks.slice(0, 5);

  const existingBooks = shelfRow.querySelectorAll('.shelf-book');

  if (existingBooks.length === displayBooks.length) {
    displayBooks.forEach((b, i: number) => {
      const el = existingBooks[i];
      const meta = bookMeta[b.asin] || {} as BookMeta;
      const coverSrc = b.coverThumb
        ? b.coverThumb
        : b.cover
          ? b.cover.replace(/_SY\d+_SX\d+/, '_SY180_SX130')
          : ('https://m.media-amazon.com/images/P/' + b.asin + '.01._SCLZZZZZZZ_SX200_.jpg');
      const cardSrc = b.coverCard || null;

      el.setAttribute('data-book', JSON.stringify({
        title: b.title,
        author: b.author,
        asin: b.asin,
        status: b.status,
        statusLabel: statusLabels[b.status],
        rating: b.rating,
        progress: b.progress,
        link: b.link,
        cover: b.cover,
        series: meta.seriesName || null,
        seriesNumber: meta.seriesNumber || null,
        seriesTotal: meta.seriesTotal || null,
        pages: meta.pages || null,
        year: meta.year || null,
        desc: meta.desc || null,
        genres: meta.genres || [],
        notes: b.notes || null,
      }));

      el.setAttribute('aria-label', b.title + ' by ' + b.author);

      const img = el.querySelector('img') as HTMLImageElement | null;
      if (img) {
        const shouldLocalize = ssrAsins.has(b.asin);
        const localCardSrc = shouldLocalize ? localizeImageUrl(cardSrc) : cardSrc;
        const localCoverSrc = shouldLocalize ? localizeImageUrl(coverSrc) : coverSrc;
        if (localCardSrc) {
          img.src = localCardSrc;
          img.srcset = localCardSrc + ' 1x, ' + (localCoverSrc ?? coverSrc) + ' 2x';
        } else {
          img.src = localCoverSrc ?? coverSrc;
          img.removeAttribute('srcset');
        }
        img.alt = b.title;
        if (b.cover && coverSrc !== b.cover) {
          const fallbackUrl = b.cover;
          img.dataset.fallback = fallbackUrl;
          img.onerror = function() { (this as HTMLImageElement).srcset = ''; (this as HTMLImageElement).src = fallbackUrl; this.onerror = null; };
        }
      }

      const title = el.querySelector('.shelf-book-title span');
      if (title) {
        title.textContent = b.title;
      }

      const author = el.querySelector('.shelf-book-author');
      if (author) {
        author.textContent = b.author;
      }

      // Active class for in_progress books
      if (b.status === 'in_progress') {
        el.classList.add('shelf-book-active');
      } else {
        el.classList.remove('shelf-book-active');
      }

      const status = el.querySelector('.shelf-book-status');
      if (status) {
        status.className = 'shelf-book-status shelf-status-' + b.status;
        status.textContent = b.status === 'in_progress' ? 'READING' : statusLabels[b.status];
      }

      // Stars: only for non-in_progress books
      const existingStars = el.querySelector('.shelf-book-stars');
      if (b.status !== 'in_progress' && b.rating) {
        let starsHtml = '';
        for (let s = 1; s <= 5; s++) {
          starsHtml += '<span class="' + (s <= b.rating ? 'star-on' : 'star-off') + '">' + (s <= b.rating ? '\u2605' : '\u2606') + '</span>';
        }
        if (existingStars) {
          existingStars.innerHTML = starsHtml;
        } else {
          const starsDiv = document.createElement('div');
          starsDiv.className = 'shelf-book-stars';
          starsDiv.innerHTML = starsHtml;
          status!.insertAdjacentElement('afterend', starsDiv);
        }
      } else if (existingStars) {
        existingStars.remove();
      }

      // Progress bar + label: create-or-update for in_progress books
      const existingBar = el.querySelector('.shelf-book-progress-bar');
      const existingProgress = el.querySelector('.shelf-book-progress');
      if (b.status === 'in_progress' && b.progress != null) {
        // Update or create the bar
        if (existingBar) {
          const fill = existingBar.querySelector('.shelf-book-progress-fill') as HTMLElement;
          if (fill) fill.style.width = b.progress + '%';
        } else {
          const barDiv = document.createElement('div');
          barDiv.className = 'shelf-book-progress-bar';
          barDiv.innerHTML = '<div class="shelf-book-progress-fill" style="width:' + b.progress + '%"></div>';
          const insertAfter = status;
          insertAfter!.insertAdjacentElement('afterend', barDiv);
        }
        // Update or create the label
        if (existingProgress) {
          existingProgress.textContent = b.progress + '%';
        } else {
          const progDiv = document.createElement('div');
          progDiv.className = 'shelf-book-progress';
          progDiv.textContent = b.progress + '%';
          const bar = el.querySelector('.shelf-book-progress-bar');
          bar!.insertAdjacentElement('afterend', progDiv);
        }
      } else {
        if (existingBar) existingBar.remove();
        if (existingProgress) existingProgress.remove();
      }
    });
  } else {
    let html = '';
    displayBooks.forEach((b, i: number) => {
      const meta = bookMeta[b.asin] || {} as BookMeta;
      const coverSrc = b.coverThumb
        ? b.coverThumb
        : b.cover
          ? b.cover.replace(/_SY\d+_SX\d+/, '_SY180_SX130')
          : ('https://m.media-amazon.com/images/P/' + b.asin + '.01._SCLZZZZZZZ_SX200_.jpg');
      const cardSrc = b.coverCard || null;
      const bookData = JSON.stringify({
        title: b.title,
        author: b.author,
        asin: b.asin,
        status: b.status,
        statusLabel: statusLabels[b.status],
        rating: b.rating,
        progress: b.progress,
        link: b.link,
        cover: b.cover,
        series: meta.seriesName || null,
        seriesNumber: meta.seriesNumber || null,
        seriesTotal: meta.seriesTotal || null,
        pages: meta.pages || null,
        year: meta.year || null,
        desc: meta.desc || null,
        genres: meta.genres || [],
        notes: b.notes || null,
      });
      var activeClass = b.status === 'in_progress' ? ' shelf-book-active' : '';
      const shouldLocalize = ssrAsins.has(b.asin);
      const localCardSrc = shouldLocalize ? localizeImageUrl(cardSrc) : cardSrc;
      const localCoverSrc = shouldLocalize ? localizeImageUrl(coverSrc) : coverSrc;
      const displayCardSrc = localCardSrc || null;
      const displayCoverSrc = localCoverSrc ?? coverSrc;
      html += '<div class="shelf-book' + activeClass + '" style="animation-delay: ' + (i * 0.08) + 's" data-book=\'' + bookData.replace(/'/g, '&#39;') + '\' tabindex="0" aria-label="' + esc(b.title) + ' by ' + esc(b.author) + '">';
      html += '<div class="shelf-cover-wrapper">';
      const srcsetAttr = displayCardSrc ? ' srcset="' + esc(displayCardSrc) + ' 1x, ' + esc(displayCoverSrc) + ' 2x"' : '';
      html += '<img src="' + esc(displayCardSrc || displayCoverSrc) + '"' + srcsetAttr + ' width="80" height="120" alt="' + esc(b.title) + '" loading="lazy"' + imgFallbackAttrs(displayCardSrc || displayCoverSrc, b.cover) + '>';
      html += '</div>';
      html += '<div class="shelf-book-title"><span>' + esc(b.title) + '</span></div>';
      html += '<div class="shelf-book-author">' + esc(b.author) + '</div>';
      html += '<div class="shelf-book-status shelf-status-' + b.status + '">' + (b.status === 'in_progress' ? 'READING' : statusLabels[b.status]) + '</div>';
      if (b.status === 'in_progress' && b.progress != null) {
        html += '<div class="shelf-book-progress-bar"><div class="shelf-book-progress-fill" style="width:' + b.progress + '%"></div></div>';
        html += '<div class="shelf-book-progress">' + b.progress + '%</div>';
      } else if (b.rating) {
        html += '<div class="shelf-book-stars">';
        for (let s = 1; s <= 5; s++) {
          html += '<span class="' + (s <= b.rating ? 'star-on' : 'star-off') + '">' + (s <= b.rating ? '\u2605' : '\u2606') + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    });
    shelfRow.innerHTML = html;
  }

  document.getElementById('cardBooks')?.classList.remove('is-loading');
}
