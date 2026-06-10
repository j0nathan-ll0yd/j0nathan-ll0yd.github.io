#!/usr/bin/env node
/* audit-inline-scripts.mjs -- CSP regression gate (Plan #07).
 *
 * Production CSP is `script-src 'self'` (functions/_middleware.ts) -- no
 * 'unsafe-inline', no 'unsafe-hashes'. Two markup patterns are therefore
 * rejected at runtime and must never ship:
 *
 *   1. `<script is:inline>...body...</script>` -- Astro emits this verbatim,
 *      inline, so the browser blocks it. (A `<script is:inline src="...">`
 *      reference is FINE: it loads an external 'self' file.)
 *   2. Inline DOM event handlers (`onclick=`, `onload=`, ...) in markup --
 *      blocked without 'unsafe-hashes'.
 *
 * EXEMPT (not CSP violations, not flagged):
 *   - Bundled module scripts: `<script>` without `is:inline`. Astro bundles
 *     these into hashed `_astro/*.js` assets served from 'self'.
 *   - External references: any `<script ... src="...">`.
 *   - Data scripts: `type="application/ld+json"` / `type="application/json"`
 *     are inert data, not executable script; CSP script-src does not apply.
 *
 * Tier 1 (this script) runs in `prebuild`; CI gates on it. */
import { globSync } from 'glob';
import fs from 'node:fs';

var EVENT_HANDLER_RE =
  /\son(click|load|error|change|submit|focus|blur|input|keyup|keydown|mouseenter|mouseleave|mouseover|mouseout|dblclick|contextmenu)\s*=/i;

// Matches a full <script ...> ... </script> element (open tag captured in g1).
var SCRIPT_BLOCK_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

function isDataScript(openTag) {
  return /\btype\s*=\s*["'](application\/(ld\+json|json))["']/i.test(openTag);
}

function hasSrc(openTag) {
  return /\bsrc\s*=/.test(openTag);
}

function isInline(openTag) {
  return /\bis:inline\b/.test(openTag);
}

function lineAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

var files = globSync('src/**/*.{astro,html}', { ignore: ['node_modules/**', '**/node_modules/**'] });
var violations = 0;

for (var f = 0; f < files.length; f++) {
  var file = files[f];
  var content = fs.readFileSync(file, 'utf-8');

  // 1. Inline <script is:inline> WITH a non-empty body (no src, not data).
  var m;
  SCRIPT_BLOCK_RE.lastIndex = 0;
  while ((m = SCRIPT_BLOCK_RE.exec(content)) !== null) {
    var openTag = m[1];
    var body = m[2];
    if (!isInline(openTag)) continue;        // bundled scripts are exempt
    if (hasSrc(openTag)) continue;           // external reference is fine
    if (isDataScript(openTag)) continue;     // inert data, not script
    if (!/\S/.test(body)) continue;          // empty body
    violations++;
    console.error('✗ ' + file + ':' + lineAt(content, m.index) +
      ' -- <script is:inline> with body (CSP script-src \'self\' blocks this).');
  }

  // 2. Inline event handlers in markup (e.g. onclick=, onload=).
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (EVENT_HANDLER_RE.test(lines[i])) {
      violations++;
      console.error('✗ ' + file + ':' + (i + 1) +
        ' -- inline event handler (CSP rejects without \'unsafe-hashes\').');
    }
  }
}

if (violations > 0) {
  console.error('\n' + violations + ' inline-JS violation(s).');
  console.error('Per CLAUDE.md: extract to public/js/*.js and reference via <script is:inline src="..." defer>.');
  console.error('CSP: script-src \'self\' -- inline JS is rejected in production.');
  process.exit(1);
}

console.log('No inline-JS violations ✓ (' + files.length + ' files scanned)');
