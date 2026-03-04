import type { FocusExport } from '../types/exports';

let clockInterval: ReturnType<typeof setInterval> | null = null;

export function updateFocusOverlay(data: FocusExport | null): void {
  const overlay = document.getElementById('focusOverlay');
  if (!overlay) return;
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

  if (data?.currentFocus === 'Work') {
    overlay.style.display = 'flex';
    const clockEl = document.getElementById('focusClock');
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
  } else {
    overlay.style.display = 'none';
  }
}
