/**
 * Shared Chromium launch flags for deterministic visual regression.
 *
 * Used by the visual-regression suite (playwright.config.ts). The production
 * smoke check (playwright.smoke.config.ts) deliberately does NOT use these
 * flags: it takes no screenshots and needs no pixel determinism, and the
 * SwiftShader flag here segfaults under QEMU on Apple Silicon Docker.
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
  // NOTE: device-pixel ratio is deliberately NOT forced here. It is emulated
  // per-context via `deviceScaleFactor: 2` in playwright.config.ts so baselines
  // render at 2x (retina-sharp). DPR *value* is not a determinism risk — only
  // DPR *variance* is — and every baseline renders in the identical arm64 noble
  // container, so a fixed deviceScaleFactor is exactly as deterministic as the
  // old `--force-device-scale-factor=1`, just sharper.
  // Font rendering: kill hinting and subpixel (LCD) AA so glyphs are grayscale
  // and stable.
  //
  // We intentionally do NOT pass --disable-font-subpixel-positioning: due to
  // Chromium bug 824153 that switch is INVERTED (it *enables* subpixel glyph
  // positioning, the opposite of its name). Omitting it therefore leaves
  // subpixel positioning OFF -> whole-pixel glyph snapping, which is more
  // deterministic under parallel CPU load, and stays sharp at 2x DPR.
  '--font-render-hinting=none',
  '--disable-lcd-text',
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
