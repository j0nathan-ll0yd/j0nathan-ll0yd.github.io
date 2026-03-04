import type { FocusExport } from '../types/exports';

let clockInterval: ReturnType<typeof setInterval> | null = null;

export function updateFocusOverlay(data: FocusExport | null): void {
  const workOverlay = document.getElementById('focusOverlay');
  const dndOverlay = document.getElementById('dndOverlay');
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

  // Hide both overlays first
  if (workOverlay) workOverlay.style.display = 'none';
  if (dndOverlay) dndOverlay.style.display = 'none';

  const focus = data?.currentFocus;
  let activeOverlay: HTMLElement | null = null;
  let clockId: string | null = null;

  if (focus === 'Work' && workOverlay) {
    activeOverlay = workOverlay;
    clockId = 'focusClock';
  } else if (focus === 'Do Not Disturb' && dndOverlay) {
    activeOverlay = dndOverlay;
    clockId = 'dndClock';
  }

  if (activeOverlay && clockId) {
    activeOverlay.style.display = 'flex';
    const clockEl = document.getElementById(clockId);
    if (clockEl) {
      const updateClock = () => {
        clockEl.textContent = new Date().toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      };
      updateClock();
      clockInterval = setInterval(updateClock, 1000);
    }
  }
}
