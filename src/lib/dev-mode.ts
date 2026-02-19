/**
 * Check URL params on load:
 * - ?dev=true → sets localStorage 'dataMode' to 'dev'
 * - ?dev=false → removes localStorage 'dataMode'
 */
export function initDevMode(): void {
  // 1. Check URL params
  const params = new URLSearchParams(window.location.search);
  const devParam = params.get('dev');
  if (devParam === 'true') {
    localStorage.setItem('dataMode', 'dev');
  } else if (devParam === 'false') {
    localStorage.removeItem('dataMode');
  }

  // 2. Set up Ctrl+Shift+D keyboard shortcut to toggle
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (localStorage.getItem('dataMode') === 'dev') {
        localStorage.removeItem('dataMode');
      } else {
        localStorage.setItem('dataMode', 'dev');
      }
      window.location.reload();
    }
  });

  // 3. Create and insert the badge
  const badge = document.createElement('span');
  badge.className = 'data-mode-badge';
  const isDev = localStorage.getItem('dataMode') === 'dev';
  badge.textContent = isDev ? 'DEV' : 'LIVE';
  badge.classList.add(isDev ? 'data-mode-dev' : 'data-mode-live');
  // Insert next to the live clock in the top bar
  const clock = document.getElementById('liveClock');
  if (clock && clock.parentNode) {
    clock.parentNode.insertBefore(badge, clock.nextSibling);
  }

  // 4. Expose for console debugging
  (window as any).__DATA_MODE__ = isDev ? 'dev' : 'live';
}

export function isDevMode(): boolean {
  return localStorage.getItem('dataMode') === 'dev';
}
