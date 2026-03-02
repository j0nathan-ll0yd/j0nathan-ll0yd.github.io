import { classifyHeartRate, buildECGPath, classifyHRV } from './heart-rate';
import { HYDRATION } from './constants';
import type { AdaptedHealth, AdaptedSleep, AdaptedBooks, AdaptedGithubEvent, BookMeta, WorkoutEntry, AdaptedArticle } from './adapters';
import type { LocationExport } from '../types/exports';

const ACCENT_CLASSES = [
  'tri-card-accent-pink', 'tri-card-accent-blue', 'tri-card-accent-green',
  'tri-card-accent-amber', 'tri-card-accent-red', 'tri-card-accent-purple',
  'tri-card-accent-cyan', 'tri-card-accent-orange', 'tri-card-accent-indigo',
];

function esc(s: string | null | undefined): string {
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

  const ecgPath = document.getElementById('hrEcgPath');
  if (ecgPath) {
    ecgPath.setAttribute('d', buildECGPath(hr));
    ecgPath.style.stroke = zone.ecgStroke;
  }

  const ecgSvg = document.getElementById('hrEcgSvg');
  if (ecgSvg) {
    ecgSvg.style.animationDuration = zone.ecgSpeed;
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
    html += '<div class="workout-sub-type">' + esc(w.activityType) + '</div>';
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

  document.getElementById('cardSleep')?.classList.remove('is-loading');
}

export function updateHydration(data: AdaptedHealth): void {
  const waterOz = data.hydration.waterOz;
  const caffeineMg = data.hydration.caffeineMg;

  const waterLiq = document.getElementById('hydraWaterLiq');
  if (waterLiq) {
    const waterPct = Math.min(waterOz / HYDRATION.waterMax, 1) * 100;
    waterLiq.style.height = waterPct + '%';
  }

  const waterVal = document.getElementById('hydraWaterVal');
  if (waterVal) {
    waterVal.textContent = waterOz + ' oz';
  }

  const coffeeLiq = document.getElementById('hydraCoffeeLiq');
  if (coffeeLiq) {
    const caffeinePct = Math.min(caffeineMg / HYDRATION.caffeineMax, 1) * 100;
    coffeeLiq.style.height = caffeinePct + '%';
  }

  const coffeeVal = document.getElementById('hydraCoffeeVal');
  if (coffeeVal) {
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
    books: 'amber',
    articles: 'amber',
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

export function updateLocation(data: LocationExport): void {
  const card = document.getElementById('cardLocation');
  if (!card) return;

  // Top city
  const topCity = data.cityBreakdown[0]?.city ?? null;
  const cityEl = card.querySelector('[data-loc="city"]');
  if (cityEl && topCity) cityEl.textContent = topCity;

  // Total visits
  const totalVisitsEl = card.querySelector('[data-loc="total-visits"]');
  if (totalVisitsEl) totalVisitsEl.textContent = String(data.totalVisits);

  // Top places (up to 3)
  const placesList = card.querySelector('[data-loc="places-list"]');
  if (placesList && data.topPlaces.length > 0) {
    placesList.innerHTML = data.topPlaces.slice(0, 3).map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      const cat = p.category ? `<span class="loc-place-cat">${esc(p.category)}</span>` : '';
      return `<div class="loc-place-row">
        <span class="loc-place-medal">${medal}</span>
        <span class="loc-place-name">${esc(p.name)}</span>${cat}
        <span class="loc-place-count">${p.visitCount}v</span>
      </div>`;
    }).join('');
  }

  // 30-day activity heatmap (last 30 of last90Days)
  const heatmapEl = card.querySelector('[data-loc="heatmap"]');
  if (heatmapEl && data.last90Days.length > 0) {
    const days = data.last90Days.slice(-30);
    const maxCount = Math.max(...days.map(d => d.count), 1);
    heatmapEl.innerHTML = days.map(d => {
      const intensity = d.count / maxCount;
      const opacity = d.count === 0 ? 0.08 : 0.2 + intensity * 0.8;
      const title = `${d.date}: ${d.count} visits`;
      return `<div class="loc-heat-cell" style="opacity:${opacity.toFixed(2)}" title="${esc(title)}"></div>`;
    }).join('');
  }

  // City breakdown (top 3)
  const cityListEl = card.querySelector('[data-loc="city-list"]');
  if (cityListEl && data.cityBreakdown.length > 0) {
    cityListEl.innerHTML = data.cityBreakdown.slice(0, 3).map(c =>
      `<div class="loc-city-row"><span class="loc-city-name">${esc(c.city)}</span><span class="loc-city-count">${c.visitCount}</span></div>`
    ).join('');
  }

  card.classList.remove('is-loading');
}

export function updateContributionGraph(data: LocationExport): void {
  const card = document.getElementById('cardContributionGraph');
  if (!card) return;

  const grid = card.querySelector<HTMLElement>('[data-loc="contrib-grid"]');
  if (!grid) return;

  // Build a map of date -> day data for quick lookup
  const dayMap = new Map<string, { count: number; uniquePlaces: number }>();
  for (const d of data.last90Days) {
    dayMap.set(d.date, { count: d.count, uniquePlaces: d.uniquePlaces });
  }

  // Build array of 91 days ending today (newest = index 90)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the Monday that starts our 13-week grid (91 days back, aligned to Monday)
  const startDate = new Date(today);
  // Go back 90 days, then rewind to the preceding Monday
  startDate.setDate(startDate.getDate() - 90);
  const dayOfWeek = startDate.getDay(); // 0=Sun, 1=Mon, ...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startDate.setDate(startDate.getDate() - daysToMonday);

  // Build 91 cells (13 cols x 7 rows = Mon-Sun columns)
  const cells: { date: Date; dateStr: string; count: number; uniquePlaces: number }[] = [];
  for (let i = 0; i < 91; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const day = dayMap.get(iso);
    cells.push({ date: d, dateStr: iso, count: day?.count ?? 0, uniquePlaces: day?.uniquePlaces ?? 0 });
  }

  const maxCount = Math.max(...cells.map(c => c.count), 1);

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Replace grid cells
  grid.innerHTML = cells.map(c => {
    const opacity = c.count === 0 ? 0.08 : 0.2 + (c.count / maxCount) * 0.8;
    const dayName = DAY_NAMES[c.date.getDay()];
    const monthName = MONTH_NAMES[c.date.getMonth()];
    const dayNum = c.date.getDate();
    const title = `${dayName} ${monthName} ${dayNum}: ${c.count} visit${c.count !== 1 ? 's' : ''}, ${c.uniquePlaces} place${c.uniquePlaces !== 1 ? 's' : ''}`;
    return `<div class="contrib-cell" style="opacity:${opacity.toFixed(2)}" title="${esc(title)}"></div>`;
  }).join('');

  // Update month labels (one per column = one per week)
  const monthsEl = card.querySelector<HTMLElement>('[data-loc="contrib-months"]');
  if (monthsEl) {
    const monthLabels: string[] = [];
    for (let col = 0; col < 13; col++) {
      const firstDayOfCol = cells[col * 7];
      if (firstDayOfCol) {
        monthLabels.push(MONTH_NAMES[firstDayOfCol.date.getMonth()]!);
      } else {
        monthLabels.push('');
      }
    }
    monthsEl.innerHTML = monthLabels.map(m => `<span class="cg-month-label">${esc(m)}</span>`).join('');
  }

  const totalVisits = cells.reduce((sum, c) => sum + c.count, 0);
  const activeDays = cells.filter(c => c.count > 0).length;

  const totalEl = card.querySelector('[data-loc="contrib-total"]');
  if (totalEl) totalEl.textContent = String(totalVisits);

  const activeDaysEl = card.querySelector('[data-loc="contrib-active-days"]');
  if (activeDaysEl) activeDaysEl.textContent = String(activeDays);

  card.classList.remove('is-loading');
}

export function updateWeeklyPulse(data: LocationExport): void {
  const card = document.getElementById('cardWeeklyPulse');
  if (!card) return;

  // Group last90Days into ISO weeks (Mon-Sun), take last 12
  const weekMap = new Map<string, number>();
  for (const d of data.last90Days) {
    const date = new Date(d.date);
    // ISO week key: find the Monday of this week
    const day = date.getDay();
    const daysToMon = day === 0 ? 6 : day - 1;
    const mon = new Date(date);
    mon.setDate(mon.getDate() - daysToMon);
    const key = mon.toISOString().slice(0, 10);
    weekMap.set(key, (weekMap.get(key) ?? 0) + d.count);
  }

  const sortedWeeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const weeks = sortedWeeks.slice(-12);

  if (weeks.length === 0) {
    card.classList.remove('is-loading');
    return;
  }

  const counts = weeks.map(([, count]) => count);
  const maxCount = Math.max(...counts, 1);
  const minCount = Math.min(...counts);

  const W = 300;
  const H = 80;
  const padding = 4;

  // Build polyline points
  const points = counts.map((count, i) => {
    const x = padding + (i / (counts.length - 1 || 1)) * (W - padding * 2);
    // Invert Y so peaks go up
    const normalised = maxCount === minCount ? 0.5 : (count - minCount) / (maxCount - minCount);
    const y = H - padding - normalised * (H - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pointsStr = points.join(' ');

  // Add a closing point at bottom for fill
  const firstX = padding;
  const lastX = padding + (W - padding * 2);
  const fillPoints = `${firstX},${H} ${pointsStr} ${lastX},${H}`;

  const pathEl = card.querySelector<SVGPolylineElement>('[data-loc="pulse-path"]');
  if (pathEl) pathEl.setAttribute('points', pointsStr);

  const fillEl = card.querySelector<SVGPolylineElement>('[data-loc="pulse-fill"]');
  if (fillEl) fillEl.setAttribute('points', fillPoints);

  // Current week = last week in array
  const currentWeekCount = counts[counts.length - 1] ?? 0;
  const avgCount = Math.round(counts.reduce((s, c) => s + c, 0) / counts.length);

  const currentEl = card.querySelector('[data-loc="pulse-current"]');
  if (currentEl) currentEl.textContent = String(currentWeekCount);

  const avgEl = card.querySelector('[data-loc="pulse-avg"]');
  if (avgEl) avgEl.textContent = String(avgCount);

  card.classList.remove('is-loading');
}

export function updateExplorerRadar(data: LocationExport): void {
  const card = document.getElementById('cardExplorerRadar');
  if (!card) return;

  const blipsEl = card.querySelector<SVGGElement>('[data-loc="radar-blips"]');
  const labelsEl = card.querySelector<HTMLElement>('[data-loc="radar-labels"]');
  const centerEl = card.querySelector<SVGTextElement>('[data-loc="radar-center"]');
  const categoryListEl = card.querySelector<HTMLElement>('[data-loc="radar-category-list"]');

  const categories = data.categoryBreakdown;

  if (!categories || categories.length === 0) {
    card.classList.remove('is-loading');
    return;
  }

  const maxVisits = Math.max(...categories.map(c => c.visitCount), 1);

  // SVG center and radius
  const cx = 100;
  const cy = 100;
  const maxR = 80; // outer ring radius
  const minR = 15; // min distance from center

  // Build blips
  if (blipsEl) {
    blipsEl.innerHTML = categories.map((cat, i) => {
      const angle = (i / categories.length) * 2 * Math.PI - Math.PI / 2;
      // More visits = smaller distance (stronger signal = closer to center)
      const normalised = cat.visitCount / maxVisits;
      const r = minR + (1 - normalised) * (maxR - minR);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      const blipR = 4 + normalised * 4; // r=4 to r=8
      return `<circle class="er-blip" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${blipR.toFixed(1)}" title="${esc(cat.category)}"/>`;
    }).join('');
  }

  // Build category labels positioned around the radar
  if (labelsEl) {
    const wrapperRect = card.querySelector('.er-radar-wrapper')?.getBoundingClientRect();
    labelsEl.innerHTML = categories.map((cat, i) => {
      const angle = (i / categories.length) * 2 * Math.PI - Math.PI / 2;
      // Labels go outside the outer ring
      const labelR = 54; // percentage of wrapper size; use % positioning
      // Convert angle to percentage-based positioning within the wrapper
      const xPct = 50 + labelR * Math.cos(angle);
      const yPct = 50 + labelR * Math.sin(angle);
      return `<span class="er-label" style="left:${xPct.toFixed(1)}%;top:${yPct.toFixed(1)}%">${esc(cat.category)}</span>`;
    }).join('');
  }

  // Update center text with total visit count
  const totalVisits = categories.reduce((sum, c) => sum + c.visitCount, 0);
  if (centerEl) centerEl.textContent = String(categories.length) + ' cats';

  // Build category list below the radar
  if (categoryListEl) {
    categoryListEl.innerHTML = categories.slice(0, 6).map(cat => {
      return `<div class="er-category-row">
        <span class="er-category-dot" style="background: var(--neon-blue, #00d4ff);"></span>
        <span class="er-category-name">${esc(cat.category)}</span>
        <span class="er-category-count">${cat.visitCount}</span>
      </div>`;
    }).join('');
  }

  card.classList.remove('is-loading');
}

function formatRelativeTime(isoString: string): string {
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
      const coverSrc = b.cover || ('https://m.media-amazon.com/images/P/' + b.asin + '.01._SCLZZZZZZZ_SX200_.jpg');

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

      const img = el.querySelector('img');
      if (img) {
        (img as HTMLImageElement).src = coverSrc;
        img.alt = b.title;
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
      const coverSrc = b.cover || ('https://m.media-amazon.com/images/P/' + b.asin + '.01._SCLZZZZZZZ_SX200_.jpg');
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
      html += '<div class="shelf-book' + activeClass + '" style="animation-delay: ' + (i * 0.08) + 's" data-book=\'' + bookData.replace(/'/g, '&#39;') + '\' tabindex="0" role="button" aria-label="' + esc(b.title) + ' by ' + esc(b.author) + '">';
      html += '<div class="shelf-cover-wrapper">';
      html += '<img src="' + esc(coverSrc) + '" width="80" height="120" alt="' + esc(b.title) + '" loading="lazy">';
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
