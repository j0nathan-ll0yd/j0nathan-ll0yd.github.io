import { esc, getCategoryColor } from './updaters';
import type { LocationExport } from '../types/exports';

type TopPlace = LocationExport['topPlaces'][number];

function metalColor(rank: number): string {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return '';
}

// ---------------------------------------------------------------------------
// V3: Medal Podium — top 3 hero rows + compact list for rest
// ---------------------------------------------------------------------------
export function updatePlaceLeaderboardV3(data: LocationExport): void {
  const card = document.getElementById('cardPlaceLeaderboardV3');
  if (!card) return;
  const podiumEl = card.querySelector<HTMLElement>('[data-loc="lb-v3-podium"]');
  const listEl = card.querySelector<HTMLElement>('[data-loc="lb-v3-list"]');
  if (!podiumEl || !listEl) { card.classList.remove('is-loading'); return; }

  const places = data.topPlaces.slice(0, 8);
  if (places.length === 0) {
    podiumEl.innerHTML = '<div style="text-align:center;color:var(--text-muted,#9ca3af);font-size:0.75rem;padding:16px 0;">No places recorded yet</div>';
    listEl.innerHTML = '';
    card.classList.remove('is-loading');
    return;
  }

  const podium = places.slice(0, 3);
  const rest = places.slice(3);

  podiumEl.innerHTML = podium.map((place: TopPlace, i: number) => {
    const rank = i + 1;
    const catColor = getCategoryColor(place.category);
    const mc = metalColor(rank);
    const podiumCatBadge = place.category
      ? '<span class="lb-v3-podium-cat" style="color:' + catColor + ';border-color:' + catColor + ';">' + esc(place.category) + '</span>'
      : '';
    const countStyle = rank === 1 ? 'color:#FFD700;' : '';

    return (
      '<div class="lb-v3-podium-row" data-rank="' + rank + '">' +
      '<span class="lb-v3-podium-rank" style="color:' + mc + ';">' + rank + '</span>' +
      '<div class="lb-v3-podium-info">' +
      '<span class="lb-v3-podium-name">' + esc(place.name) + '</span>' +
      podiumCatBadge +
      '</div>' +
      '<span class="lb-v3-podium-count" style="' + countStyle + '">' + place.visitCount + '</span>' +
      '</div>'
    );
  }).join('');

  listEl.innerHTML = rest.map((place: TopPlace, i: number) => {
    const rank = i + 4;
    const catColor = getCategoryColor(place.category);
    const listCatBadge = place.category
      ? '<span class="lb-v3-list-cat" style="color:' + catColor + ';border-color:' + catColor + ';">' + esc(place.category) + '</span>'
      : '';

    return (
      '<div class="lb-v3-list-row" data-rank="' + rank + '">' +
      '<span class="lb-v3-list-rank">' + rank + '</span>' +
      '<span class="lb-v3-list-name">' + esc(place.name) + '</span>' +
      listCatBadge +
      '<span class="lb-v3-list-count">' + place.visitCount + '</span>' +
      '</div>'
    );
  }).join('');

  card.classList.remove('is-loading');
}
