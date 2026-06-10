/**
 * Smoke-check fixtures: deterministic page-error capture.
 *
 * Extends the base `page` fixture to collect, across the whole test:
 *   - CSP violations            (securitypolicyviolation events)
 *   - unhandled promise rejections (failed dynamic import() / chunk loads)
 *   - uncaught page errors       (page.on('pageerror'))
 *   - console.error messages     (page.on('console'))
 *
 * These are the direct, near-zero-false-positive detectors for the deploy-
 * failure class this suite exists for: a first-party script that should load
 * (a hydration module / `_astro/*.js` chunk) gets blocked or fails to load.
 *
 * Collectors are installed via addInitScript BEFORE any page script runs, so no
 * early-firing violation is missed. Assertions run at fixture teardown.
 *
 * --- CSP design note (read before changing the CSP assertions) -------------
 * Production serves a strict CSP: `script-src 'self' <analytics hosts>` with NO
 * `'unsafe-inline'`. By design, EVERY inline <script> and inline event-handler
 * attribute is blocked. The site is built to externalise scripts to hashed
 * `_astro/*.js` / `/js/*.js` files that `'self'` trusts (see PR #50).
 *
 * Three hand-authored `is:inline` scripts in the design-system components
 * (IdentityCard social-click tracking, BookModal click handler, an SSR fixture
 * data block) are still inline and therefore still CSP-blocked on prod. That is
 * a STANDING condition — an incomplete tail of the #50 externalisation work,
 * tracked separately for the design system to fix. It is NOT a per-deploy
 * regression. Because a `securitypolicyviolation` event carries no script
 * sample under this CSP (no `'report-sample'`), a blocked inline script cannot
 * be fingerprinted at runtime — so we cannot tell "known legacy inline script"
 * from "newly-inlined hydration module" by event metadata alone.
 *
 * Therefore the CSP assertions are:
 *   1. HARD FAIL on any violation whose blockedURI is a concrete URL (http/https)
 *      — i.e. an EXTERNAL first-party or third-party script the CSP rejected.
 *      This is the genuine per-deploy regression signal and is GREEN today.
 *   2. REGRESSION-GUARD the count of blocked inline <script> elements against a
 *      documented baseline. The baseline is now 0 — #07 externalised the three
 *      legacy inline scripts (verified gone on live prod) — so ANY blocked inline
 *      <script> (e.g. a hydration module wrongly inlined again — the #50 class)
 *      pushes the count over the baseline and fails.
 *   3. Inline event-handler attributes (`script-src-attr`, e.g. <img onerror>)
 *      fire data-dependently and are an accepted pattern — recorded, never failed.
 *
 * The primary #50-class detector is the DOM-hydration assertions in the spec
 * (bio terminal types its content; `.is-loading` skeletons clear). A hydration
 * module that fails to load is caught there regardless of CSP nuance.
 */
import { test as base, expect, type Page } from '@playwright/test';

interface CspViolation {
  directive: string;
  blockedURI: string;
}

declare global {
  interface Window {
    __cspViolations?: CspViolation[];
    __unhandledRejections?: string[];
  }
}

/**
 * Count of blocked inline <script> elements that are a KNOWN standing condition
 * on production. The three legacy `is:inline` scripts (IdentityCard social-link
 * tracking, BookModal cover handler, SSR hydration placeholder) were externalised
 * by #07 (merged + deployed) and VERIFIED gone on live prod — 0 inline violations.
 * The baseline is now 0: inline JS is fully externalised, so ANY blocked inline
 * <script> is a regression (a newly-inlined script).
 */
const KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS = 0;

/**
 * Console/pageerror messages that are benign on this live, third-party-laden
 * site and MUST NOT fail the smoke check. Keep this list tight and justified.
 */
const BENIGN_MESSAGE_PATTERNS: RegExp[] = [
  /favicon\.ico/i, // browser auto-request, not app code
  /simpleanalytics|cloudflareinsights|gtag|analytics/i, // third-party telemetry
  /net::ERR_BLOCKED_BY_CLIENT/i, // ad/track blockers in the runner
  /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|net::ERR_FAILED/i, // transient blips (retried on CI)
  /WebSocket.*(closed|failed|1006|1011)/i, // live push socket may not connect from CI
  /Content Security Policy|Refused to (execute|apply)/i, // CSP console noise — asserted structurally below, not here
];

/** Patterns indicating a JS chunk / dynamic import() failed to load. */
const CHUNK_ERROR_PATTERNS: RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
  /Importing a module script failed/i,
];

/** Our own origin — a resource under this host failing to load is a real signal. */
const FIRST_PARTY_HOST = 'jonathanlloyd.me';

function isBenign(message: string): boolean {
  return BENIGN_MESSAGE_PATTERNS.some((re) => re.test(message));
}

/**
 * Console-error benign check that also considers the failed resource's URL.
 * A generic "Failed to load resource" for a THIRD-PARTY host (analytics, CDNs
 * the runner's DNS/ad-blocker may not resolve) is environment noise, not a
 * deploy regression. The same failure for a FIRST-PARTY resource (our own
 * `_astro/*.js` chunk 404ing) is a real signal and is NOT allowlisted.
 */
function isBenignConsole(message: string, resourceUrl: string): boolean {
  if (isBenign(message)) return true;
  if (/Failed to load resource/i.test(message)) {
    const thirdParty = resourceUrl !== '' && !resourceUrl.includes(FIRST_PARTY_HOST);
    if (thirdParty) return true;
  }
  return false;
}

export function isChunkError(message: string): boolean {
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

function isUrlBlock(blockedURI: string): boolean {
  return /^https?:/i.test(blockedURI);
}

function isInlineScriptBlock(v: CspViolation): boolean {
  return (
    !isUrlBlock(v.blockedURI) &&
    /script-src(-elem)?$/.test(v.directive) // script-src or script-src-elem, NOT script-src-attr
  );
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const url = msg.location()?.url ?? '';
        if (!isBenignConsole(text, url)) consoleErrors.push(url ? `${text} (${url})` : text);
      }
    });

    page.on('pageerror', (err) => {
      const msg = err.message;
      if (!isBenign(msg)) pageErrors.push(msg);
    });

    await page.addInitScript(() => {
      window.__cspViolations = [];
      window.__unhandledRejections = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations!.push({
          directive: e.effectiveDirective || e.violatedDirective,
          blockedURI: e.blockedURI || '',
        });
      });
      window.addEventListener('unhandledrejection', (e) => {
        const reason = e.reason as unknown;
        const msg =
          reason && typeof reason === 'object' && 'message' in reason
            ? String((reason as { message: unknown }).message)
            : String(reason);
        window.__unhandledRejections!.push(msg);
      });
    });

    await use(page);

    // --- Teardown assertions ---
    const cspViolations = await readCspViolations(page);
    const rejections = await readWindowStringArray(page, '__unhandledRejections');

    const urlBlocked = cspViolations.filter((v) => isUrlBlock(v.blockedURI));
    const inlineScriptBlocked = cspViolations.filter(isInlineScriptBlock);

    // Use soft assertions so a deploy with multiple problems (e.g. a CSP
    // regression AND a chunk-load failure) reports them all in one run instead
    // of masking the later ones behind the first failure.

    // 1. An external script blocked by CSP is a genuine per-deploy regression.
    expect.soft(
      urlBlocked,
      `CSP blocked external script(s) — a real deploy/config regression:\n${urlBlocked
        .map((v) => `${v.directive} -> ${v.blockedURI}`)
        .join('\n')}`,
    ).toEqual([]);

    // 2. Regression-guard the count of blocked inline <script> elements.
    if (inlineScriptBlocked.length > KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[smoke] inline-script CSP violations: ${inlineScriptBlocked.length} (baseline ${KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS})`,
      );
    }
    expect.soft(
      inlineScriptBlocked.length,
      `More blocked inline <script> elements (${inlineScriptBlocked.length}) than the documented baseline (${KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS}). Inline JS is fully externalised (per #07), so a new inline script was introduced — externalise it so CSP 'self' allows it (the #50 fix) rather than raising this baseline.`,
    ).toBeLessThanOrEqual(KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS);

    // 3. Chunk/dynamic-import load failures — a missing or renamed _astro/*.js chunk.
    const chunkRejections = rejections.filter(isChunkError);
    const chunkPageErrors = pageErrors.filter(isChunkError);
    expect.soft(
      [...chunkPageErrors, ...chunkRejections],
      `JS chunk / dynamic import() load failures:\n${[...chunkPageErrors, ...chunkRejections].join('\n')}`,
    ).toEqual([]);

    // 4. Any other uncaught page error / console error (allowlist-filtered).
    expect.soft(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect.soft(consoleErrors, `Unexpected console.error output:\n${consoleErrors.join('\n')}`).toEqual([]);
  },
});

async function readCspViolations(page: Page): Promise<CspViolation[]> {
  return page.evaluate(() => {
    const v = window.__cspViolations;
    return Array.isArray(v) ? v : [];
  });
}

async function readWindowStringArray(
  page: Page,
  key: '__unhandledRejections',
): Promise<string[]> {
  return page.evaluate((k) => {
    const v = (window as unknown as Record<string, unknown>)[k];
    return Array.isArray(v) ? (v as string[]) : [];
  }, key);
}

export { expect };
