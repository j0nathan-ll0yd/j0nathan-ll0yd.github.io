// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { updateFocusOverlay } from '../../src/lib/updaters-focus';
import type { FocusExport } from '../../src/types/exports';

function setup() {
  document.body.innerHTML = `
    <div id="focusOverlay" style="display:none">
      <div id="focusClock"></div>
    </div>
    <div id="dndOverlay" style="display:none">
      <div id="dndClock"></div>
    </div>
  `;
}

describe('updateFocusOverlay', () => {
  beforeEach(() => {
    setup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides both overlays when data is null', () => {
    updateFocusOverlay(null);
    expect((document.getElementById('focusOverlay') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('dndOverlay') as HTMLElement).style.display).toBe('none');
  });

  it('hides both overlays when focus is unrecognized', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Personal' });
    expect((document.getElementById('focusOverlay') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('dndOverlay') as HTMLElement).style.display).toBe('none');
  });

  it('shows focusOverlay when focus is "Work"', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Work' });
    expect((document.getElementById('focusOverlay') as HTMLElement).style.display).toBe('flex');
  });

  it('keeps dndOverlay hidden when focus is "Work"', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Work' });
    expect((document.getElementById('dndOverlay') as HTMLElement).style.display).toBe('none');
  });

  it('shows dndOverlay when focus is "Do Not Disturb"', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb' });
    expect((document.getElementById('dndOverlay') as HTMLElement).style.display).toBe('flex');
  });

  it('keeps focusOverlay hidden when focus is "Do Not Disturb"', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb' });
    expect((document.getElementById('focusOverlay') as HTMLElement).style.display).toBe('none');
  });

  it('sets clock text immediately when focus is "Work"', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Work' });
    const clock = document.getElementById('focusClock') as HTMLElement;
    expect(clock.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('sets clock text immediately when focus is "Do Not Disturb"', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb' });
    const clock = document.getElementById('dndClock') as HTMLElement;
    expect(clock.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('does not throw when overlay elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Work' })).not.toThrow();
  });

  it('transitions from Work to null hiding the overlay', () => {
    updateFocusOverlay({ generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Work' });
    expect((document.getElementById('focusOverlay') as HTMLElement).style.display).toBe('flex');
    updateFocusOverlay(null);
    expect((document.getElementById('focusOverlay') as HTMLElement).style.display).toBe('none');
  });
});
