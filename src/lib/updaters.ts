import { classifyHeartRate, buildECGPath, classifyHRV } from './heart-rate';
import { HYDRATION } from './constants';

const ACCENT_CLASSES = [
  'tri-card-accent-pink', 'tri-card-accent-blue', 'tri-card-accent-green',
  'tri-card-accent-amber', 'tri-card-accent-red', 'tri-card-accent-purple',
];

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function updateHeartRate(data: any): void {
  const hr = data.quantities.heartRate.value;
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

export function updateDailyActivity(data: any): void {
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

export function updateWorkouts(data: any[] | null): void {
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
  data.forEach((w: any) => {
    html += '<div class="workout-sub-card">';
    html += '<div class="workout-sub-top">';
    html += getIcon(w.activity_type);
    html += '<div class="workout-sub-type">' + esc(w.activity_type) + '</div>';
    html += '</div>';
    html += '<div class="workout-sub-stats">';
    html += '<div class="workout-stat"><div class="workout-stat-label">Duration</div><div class="workout-stat-value">' + fmtDuration(w.duration) + '</div></div>';
    html += '<div class="workout-stat"><div class="workout-stat-label">Calories</div><div class="workout-stat-value">' + Math.round(w.energy_burned) + ' kcal</div></div>';
    if (w.distance > 0) {
      html += '<div class="workout-stat"><div class="workout-stat-label">Distance</div><div class="workout-stat-value">' + (w.distance / 1000).toFixed(2) + ' km</div></div>';
    }
    html += '</div>';
    html += '</div>';
  });

  body.innerHTML = html;
}

export function updateNightSummary(data: any): void {
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

export function updateHydration(data: any): void {
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

export function updateBookshelf(data: any): void {
  const shelfRow = document.getElementById('dashShelfRow');
  if (!shelfRow) return;

  const statusLabels = data.statusLabels;
  const bookMeta = data.bookMeta;
  const statusOrder: Record<string, number> = { next: 0, in_progress: 1, completed: 2 };
  const sortedBooks = data.books.slice().sort((a: any, b: any) => {
    return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
  });
  const displayBooks = sortedBooks.slice(0, 5);

  const existingBooks = shelfRow.querySelectorAll('.shelf-book');

  if (existingBooks.length === displayBooks.length) {
    displayBooks.forEach((b: any, i: number) => {
      const el = existingBooks[i];
      const meta = bookMeta[b.asin] || {};
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
        series: meta.series || null,
        pages: meta.pages || null,
        year: meta.year || null,
        desc: meta.desc || null,
        genres: meta.genres || [],
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

      const status = el.querySelector('.shelf-book-status');
      if (status) {
        status.className = 'shelf-book-status shelf-status-' + b.status;
        status.textContent = statusLabels[b.status];
      }
    });
  } else {
    let html = '';
    displayBooks.forEach((b: any, i: number) => {
      const meta = bookMeta[b.asin] || {};
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
        series: meta.series || null,
        pages: meta.pages || null,
        year: meta.year || null,
        desc: meta.desc || null,
        genres: meta.genres || [],
      });
      html += '<div class="shelf-book" style="animation-delay: ' + (i * 0.08) + 's" data-book=\'' + bookData.replace(/'/g, '&#39;') + '\' tabindex="0" role="button" aria-label="' + esc(b.title) + ' by ' + esc(b.author) + '">';
      html += '<div class="shelf-cover-wrapper">';
      html += '<img src="' + esc(coverSrc) + '" width="80" height="120" alt="' + esc(b.title) + '" loading="lazy">';
      html += '</div>';
      html += '<div class="shelf-book-title"><span>' + esc(b.title) + '</span></div>';
      html += '<div class="shelf-book-author">' + esc(b.author) + '</div>';
      html += '<div class="shelf-book-status shelf-status-' + b.status + '">' + statusLabels[b.status] + '</div>';
      html += '</div>';
    });
    shelfRow.innerHTML = html;
  }

  document.getElementById('cardBooks')?.classList.remove('is-loading');
}
