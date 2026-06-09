/**
 * Shared Chromium launch flags for deterministic visual regression.
 *
 * Single source of truth for both playwright.config.ts (regression) and
 * playwright.drift.config.ts (drift detection). If flags diverge between
 * the two suites, baselines and live screenshots will not match.
 *
 * Research evidence and bug citations:
 *   - Chromium 40827297: MSAA atlas-path renderer non-determinism; Skia
 *     falls back unpredictably depending on path size, GPU capability,
 *     memory pressure.
 *   - Chromium 460486: GPU-rasterization with MSAA has timing-based code
 *     paths that produce different output run-to-run.
 *   - Playwright #35674: increasing viewport size to fit the entire clip
 *     region bypasses the fullPage stitched-capture bug.
 *
 * To verify Chromium accepts these flags (after a flag-list change):
 *   npx playwright test --grep "NOMATCH_SENTINEL_NO_TESTS" --reporter=list 2>&1 \
 *     | grep -iE "(unknown|invalid|unrecognized)" && echo "FAIL" || echo "OK"
 */
export const CHROMIUM_DETERMINISM_ARGS: ReadonlyArray<string> = [
  // Determinism — single device-pixel ratio so glyph positions are stable
  '--force-device-scale-factor=1',
  // Font rendering: kill hinting, subpixel AA, subpixel positioning variance
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--disable-font-subpixel-positioning',
  // Skia: disable runtime-optimization fallbacks that can flip raster paths
  '--disable-skia-runtime-opts',
  // /dev/shm is 64MB in Docker — too small for 3000px+ fullPage. Redirects
  // Chromium shared-memory writes to /tmp instead.
  '--disable-dev-shm-usage',
  // Software raster — eliminates MSAA atlas-path non-determinism for SVG
  // (octicons specifically). Trade-off: ~20-40% slower test execution.
  // See Chromium 40827297, Chromium 460486.
  '--use-gl=swiftshader',
  '--disable-gpu',
  '--in-process-gpu',
];
