import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Graceful no-interaction deploy updates (Phase 1).
// Plan: .omc/plans/graceful-deploy-auto-update-plan.md
const distDir = path.resolve(process.cwd(), 'dist');
const swRegisterPath = path.join(distDir, 'js', 'sw-register.js');

describe('SW update controller', () => {
  it('dist/js/sw-register.js exists', () => {
    expect(existsSync(swRegisterPath)).toBe(true);
  });

  it('is ES5 only (ships verbatim, no transpile)', () => {
    const src = readFileSync(swRegisterPath, 'utf-8');
    const forbidden: Array<[string, RegExp]> = [
      ['arrow function', /=>/],
      ['const', /\bconst\b/],
      ['let', /\blet\b/],
      ['template literal', /`/],
      ['class', /\bclass\b/],
      ['optional chaining', /\?\./],
      ['nullish coalescing', /\?\?/],
    ];
    const hits = forbidden.filter(([, re]) => re.test(src)).map(([name]) => name);
    expect(hits).toEqual([]);
  });

  it('wires the controllerchange reload spine and the update nudge', () => {
    const src = readFileSync(swRegisterPath, 'utf-8');
    expect(src).toContain("addEventListener('controllerchange'");
    expect(src).toContain('window.__checkForSwUpdate');
    expect(src).toContain("register('/sw.js')");
  });

  it('does not ship vite-plugin-pwa registerSW.js (injectRegister:false)', () => {
    expect(existsSync(path.join(distDir, 'registerSW.js'))).toBe(false);
  });
});
