// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updatePollStatus } from '../../src/lib/updaters-status';
import type { PollStatus } from '../../src/lib/poll-engine';

function setup() {
  document.body.innerHTML = `
    <span class="poll-dot"></span>
    <span class="poll-label"></span>
  `;
}

function dot(): HTMLElement {
  return document.querySelector('.poll-dot')!;
}
function label(): HTMLElement {
  return document.querySelector('.poll-label')!;
}

function status(overrides: Partial<PollStatus> = {}): PollStatus {
  return {
    connected: true,
    lastPollAt: null,
    errorCounts: {},
    wsConnected: false,
    ...overrides,
  };
}

describe('updatePollStatus', () => {
  beforeEach(() => {
    setup();
    // Default: navigator.onLine = true
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('shows "Polling" when connected and no ws', () => {
    updatePollStatus(status({ connected: true, wsConnected: false }));
    expect(label().textContent).toBe('Polling');
    expect(dot().className).toContain('poll-dot--ok');
  });

  it('shows "Live" when connected with wsConnected', () => {
    updatePollStatus(status({ connected: true, wsConnected: true }));
    expect(label().textContent).toBe('Live');
    expect(dot().className).toContain('poll-dot--ok');
  });

  it('shows "Partial" when some errors >= 3 but not all', () => {
    updatePollStatus(status({
      connected: true,
      wsConnected: false,
      errorCounts: { health: 3, sleep: 0 },
    }));
    expect(label().textContent).toBe('Partial');
    expect(dot().className).toContain('poll-dot--warn');
  });

  it('shows "Degraded" when all sources have errors >= 3 and online', () => {
    updatePollStatus(status({
      connected: true,
      wsConnected: false,
      errorCounts: { health: 3, sleep: 5 },
    }));
    expect(label().textContent).toBe('Degraded');
    expect(dot().className).toContain('poll-dot--error');
  });

  it('shows "Offline" when navigator.onLine is false', () => {
    vi.stubGlobal('navigator', { onLine: false });
    updatePollStatus(status({ connected: false, errorCounts: {} }));
    expect(label().textContent).toBe('Offline');
    expect(dot().className).toContain('poll-dot--error');
  });

  it('shows empty label when not connected and online', () => {
    updatePollStatus(status({ connected: false, errorCounts: {} }));
    expect(label().textContent).toBe('');
    expect(dot().className).toContain('poll-dot--off');
  });

  it('does not throw when dot/label elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => updatePollStatus(status())).not.toThrow();
  });

  it('ignores null errorCount entries', () => {
    updatePollStatus(status({
      connected: true,
      wsConnected: false,
      errorCounts: { health: undefined as any, sleep: undefined as any },
    }));
    // null entries filtered → no errors → Polling
    expect(label().textContent).toBe('Polling');
  });
});
