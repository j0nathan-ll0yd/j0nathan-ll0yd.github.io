// Puppeteer configuration (cosmiconfig-discovered: puppeteer/getConfiguration.js
// looks up `.puppeteerrc.cjs` in the repo root automatically -- no wiring needed).
//
// pa11y-ci (scripts/audit/check-analytics.mjs's sibling B4 check, invoked from
// .github/workflows/audit-web.yml) depends on full `puppeteer`, which normally
// downloads its own Chrome + chrome-headless-shell via a postinstall script.
// This repo never uses that bundled browser: audit-web.yml always installs
// Playwright's chromium (needed anyway for B1/B6/B3) and points pa11y-ci at it
// via PUPPETEER_EXECUTABLE_PATH, and locally that download previously failed
// outright (macOS Gatekeeper-adjacent extraction issue while developing this
// config) or broke CI installs repo-wide (`npm ci` failing with "All providers
// failed for chrome-headless-shell" on the GitHub-hosted runner, unrelated to
// network conditions on any one run -- reproduced twice).
//
// skipDownload disables the postinstall download unconditionally, for every
// caller of `npm ci`/`npm install` in this repo (not just audit-web.yml) --
// puppeteer-core (used by @lhci/cli via lighthouse) ignores this file entirely
// and is unaffected.
/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  skipDownload: true,
};
