#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VIEWPORTS = [
  { name: 'mobile-320',   width: 320,  height: 800 },
  { name: 'mobile-600',   width: 600,  height: 800 },
  { name: 'tablet-1024',  width: 1024, height: 900 },
  { name: 'desktop-1400', width: 1400, height: 900 },
];

const URL = process.env.BASELINE_URL || 'http://localhost:4321/';
const OUT_DIR = process.env.BASELINE_DIR || 'test/visual/manual-baselines/before-cleanup';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    console.log(`[baseline] ${vp.name} ${vp.width}x${vp.height} -> ${URL}`);
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000); // settle animations
    const out = join(OUT_DIR, `${vp.name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`  saved: ${out}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log('[baseline] done');
