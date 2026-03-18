# AGENTS.md

## Project

Human Datastream -- personal portfolio site for Jonathan Lloyd. A single-page sci-fi dashboard built with Astro 5.x (static output), hosted on GitHub Pages at https://jonathanlloyd.me.

## Build

```bash
npm install
npm run dev       # localhost:4321
npm run build     # outputs to dist/
npm run preview   # preview production build
```

Deploy: push to `master` triggers GitHub Actions (withastro/action@v3 -> deploy-pages@v4).

## Visual Regression Tests

```bash
npm run test:visual          # compare against baselines (16 tests across 4 viewports)
npm run test:visual:update   # regenerate baselines after intentional visual changes
npm run test:visual:ui       # interactive Playwright UI
```

Tests use Playwright `toHaveScreenshot()`. Baselines live in `tests/visual/__screenshots__/`. Dynamic content (clock, timestamps, particles) hidden via `tests/visual/screenshot.css`. CloudFront API calls stubbed with `tests/fixtures/*.json`.

## Key Files

| Path | Purpose |
|------|---------|
| `src/pages/index.astro` | Single page -- loads JSON data, composes all widgets |
| `src/layouts/Dashboard.astro` | HTML head, SEO meta, JSON-LD, analytics |
| `src/components/` | Astro components (one per widget) |
| `public/css/tokens.css` | Design tokens (colors, typography, spacing) |
| `public/css/base.css` | Reset, body, scrollbar styles |
| `src/styles/layout.css` | Panel layout, responsive breakpoints |
| `public/css/components.css` | Widget card styles |
| `data/*.json` | Build-time data (profile, health, github, books, reading, system) |
| `astro.config.mjs` | Astro config, PWA, sitemap, dev-only showcase routes |
| `playwright.config.ts` | Visual regression test config (4 viewport projects) |
| `tests/visual/dashboard.spec.ts` | Screenshot tests (full-page + widget-level) |
| `tests/visual/screenshot.css` | Stabilization stylesheet (hides dynamic content) |
| `tests/fixtures/*.json` | Stable JSON fixtures for CloudFront API mocking |
| `docs/wiki/` | Architecture docs (synced to GitHub Wiki) |

## Conventions

- **CSS**: Use custom properties from `tokens.css` for all colors, spacing, typography. Glass-morphism pattern: `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--blur-md));`
- **Inline JS**: ES5 only (`var`, IIFEs, `function` declarations) -- no `let`/`const`/arrow functions in `<script is:inline>` blocks
- **Widget HTML**: `.tri-card` > `.widget-header` + `.widget-body`
- **Formatting**: 2-space indent, UTF-8, LF line endings
- **No frameworks**: All rendering is build-time Astro components. No React/Vue/Svelte.

## Do Not

- Use ES6+ syntax in inline scripts
- Remove `.nojekyll` (GitHub Pages needs it)
- Modify CSS files without testing breakpoints at 1400px, 1100px, 900px, 600px

## Detailed Context

See `CLAUDE.md` for comprehensive conventions, design system reference, SEO metadata tables, component showcase documentation, and responsive scaling details.
