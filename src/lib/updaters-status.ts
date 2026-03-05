import type { PollStatus } from './poll-engine';

/** Update the connection status indicator in the top bar */
export function updatePollStatus(status: PollStatus): void {
  const dot = document.querySelector<HTMLElement>('.poll-dot');
  const label = document.querySelector<HTMLElement>('.poll-label');
  if (!dot || !label) return;

  const online = navigator.onLine;
  const errorEntries = Object.values(status.errorCounts).filter((c): c is number => c != null);
  const hasErrors = errorEntries.some(c => c >= 3);
  const allFailing = !online || (errorEntries.length > 0 && errorEntries.every(c => c >= 3));

  if (allFailing) {
    dot.className = 'poll-dot poll-dot--error';
    label.textContent = online ? 'Degraded' : 'Offline';
  } else if (hasErrors) {
    dot.className = 'poll-dot poll-dot--warn';
    label.textContent = 'Partial';
  } else if (status.connected) {
    dot.className = 'poll-dot poll-dot--ok';
    label.textContent = 'Live';
  } else {
    dot.className = 'poll-dot poll-dot--off';
    label.textContent = '';
  }
}
