# Framework Evaluation: Choosing the Production Stack

**Decision Date**: February 2026
**Decision**: Astro
**Status**: Approved

---

## Context

After building four parallel implementations of the Command Center portfolio (Astro, HTMX/Handlebars, Marko, Web Awesome/Shoelace), this document evaluates which framework should power the production site. The evaluation considers existing implementations, alternative frameworks, and data from 80+ web research queries across developer surveys, performance benchmarks, and ecosystem analysis.

---

## Evaluation Criteria

| Criteria | Weight | Description |
|----------|--------|-------------|
| Performance | High | Lighthouse scores, bundle size, Core Web Vitals |
| Developer Experience | High | Satisfaction ratings, component model, TypeScript support |
| Long-term Viability | High | Corporate backing, community size, release cadence |
| GitHub Pages Fit | High | Static output, deployment simplicity |
| Community & Ecosystem | Medium | npm downloads, learning resources, integrations |
| Job Market | Low | Relevant but secondary for a personal portfolio |

---

## Existing Implementations

### 1. Astro (Reference Implementation) -- Score: 10/10

**Codebase**: 14 `.astro` components, ~1,281 LOC, 1 dependency (`astro`), build-time SSG

| Metric | Value |
|--------|-------|
| GitHub Stars | 56,600 |
| npm Weekly Downloads | 1,250,695 |
| JS Shipped (static pages) | 0 KB |
| Lighthouse Performance | 100/100 |
| State of JS 2025 Satisfaction | #1 meta-framework |
| Corporate Backing | Acquired by Cloudflare (Jan 2026), MIT licensed |

**Why it wins for this project**:
- Zero JavaScript by default -- widgets are static data display, rendered as pure HTML/CSS
- Islands architecture -- selective hydration for Three.js particles, Leaflet map, book modal
- 14 components map 1:1 to widgets
- Build-time JSON loading via `fs.readFileSync`
- Perfect Lighthouse scores (40% faster FCP than Next.js, 90% less JavaScript)
- Cloudflare acquisition ensures long-term viability
- Official GitHub Pages deployment action (`withastro/action`)

### 2. HTMX + Handlebars (No-Build) -- Score: 3/10

**Codebase**: 4 files, ~1,558 LOC, 0 npm dependencies (CDN-based)

| Metric | Value |
|--------|-------|
| GitHub Stars | 42,300-47,400 |
| npm Weekly Downloads | 121,817 |
| Bundle Size | ~14 KB (HTMX) + ~78 KB (Handlebars) |
| Corporate Backing | GitHub Accelerator ($20K), single primary maintainer |

**Why it doesn't fit**:
- Architectural mismatch: HTMX is designed for server-rendered HTML fragments, but this implementation fetches JSON and renders client-side with Handlebars
- Handlebars + HTMX has known integration bugs (GitHub issues #1801, #801)
- Single maintainer risk (Carson Gross)
- Not designed for static sites without a backend server

### 3. Marko (SSR Build) -- Score: 4/10

**Codebase**: 16 files, ~1,500-2,000 LOC, 2 dependencies

| Metric | Value |
|--------|-------|
| GitHub Stars | 14,300 |
| npm Weekly Downloads | 12,894 |
| Corporate Backing | eBay (~20,000 production components) |
| Marko 6 Status | Pre-release, Tags API preview v0.8.1 (9+ months stale) |

**Why it doesn't fit**:
- 97x smaller community than Astro (12,894 vs 1,250,695 weekly downloads)
- Essentially a single-company framework (eBay)
- Marko 6 uncertainty creates upgrade path concerns
- Custom `build.js` rather than standard Marko Run framework

### 4. Web Awesome / Shoelace (Web Components, No-Build) -- Score: 4/10

**Codebase**: 3 files, ~1,379 LOC, 0 npm dependencies (CDN-based)

| Metric | Value |
|--------|-------|
| Shoelace 2.x GitHub Stars | 13,854 |
| Full Library Bundle | 383 KB |
| Single Component (button) | +232 KB |

**Why it doesn't fit**:
- Heavy bundle (383 KB) for a single-page portfolio
- Shadow DOM styling friction requiring `::part()` selectors and CSS custom property overrides
- All rendering logic concentrated in one 889-line JS file
- Shoelace 2.x to Web Awesome 3.x migration pending (`sl-` to `wa-` prefix changes)
- Web components are overkill for a single-site portfolio (designed for cross-project design systems)

---

## Alternative Frameworks Considered

### Eleventy (11ty) -- Score: 7/10
Flexible templating, zero client JS, mature ecosystem. Lacks Astro's component model, island architecture, and built-in image optimization. More manual setup required.

### SvelteKit (Static Adapter) -- Score: 6/10
Excellent DX, smallest framework runtime (6.73 KB). Ships more JS than Astro for static content. Reactivity system adds overhead without benefit for mostly-static widgets.

### Hugo -- Score: 5/10
Fastest build times (5,000+ pages/second), single Go binary. Go template syntax learning curve, no component model, no island architecture. Build speed irrelevant for a 1-page site.

### Next.js (Static Export) -- Score: 3/10
Massive ecosystem but ships 85 KB+ JS minimum. Low developer retention despite high usage (State of JS 2024). Overkill for static portfolio.

### Vanilla JS -- Score: 5/10
Already demonstrated in root `index.html`. Works but the root site at ~3,899 LOC vs Astro's ~1,281 LOC shows the cost of no component reuse.

### Fresh, Qwik, SolidStart -- Score: 2-3/10
All too niche with immature ecosystems for production portfolio use.

---

## Comparative Data

### Performance

| Framework | JS Shipped (Static) | Lighthouse Score |
|-----------|--------------------|--------------------|
| **Astro** | **0 KB** | **100** |
| Hugo | 0 KB | 100 |
| Eleventy | 0 KB | 98-100 |
| Marko (static build) | 0 KB | 98-100 |
| HTMX | 14 KB | 90-95 |
| Shoelace (CDN) | 200+ KB | 80-90 |
| Next.js | 85+ KB | 88 |

### Community

| Framework | GitHub Stars | npm Downloads/Week |
|-----------|------------|-------------------|
| **Astro** | 56,600 | 1,250,695 |
| Next.js | 131,000 | 14,761,050 |
| HTMX | 42,300 | 121,817 |
| Shoelace | 13,854 | 96,603 |
| Eleventy | ~18,000 | ~55,000 |
| Marko | 14,300 | 12,894 |

---

## Decision

### Astro is the production framework.

The data is unambiguous across every metric that matters:

1. **Performance**: 0 KB JavaScript by default. Perfect Lighthouse scores. 40% faster than Next.js.
2. **Developer Experience**: #1 satisfaction (State of JS 2025). Component-based. TypeScript. HMR.
3. **Long-term Viability**: Cloudflare acquisition (Jan 2026). MIT-licensed. 113 releases in 2025.
4. **Community**: 1.25M weekly npm downloads. 56.6K GitHub stars. Growing 2.5x YoY.
5. **GitHub Pages Fit**: Official deployment action. Static HTML output. `.nojekyll` already in place.
6. **Architecture Match**: Islands architecture is exactly right for static widgets with selective hydration.

### What happens to the other implementations

They remain as educational demonstrations of framework paradigms in `/implementations/`. They showcase the ability to work across multiple frameworks while the production site runs on Astro.

---

## Implementation Plan

1. Configure `astro.config.mjs` with `site: 'https://j0nathan-ll0yd.github.io'`
2. Add SEO meta tags, OpenGraph, and JSON-LD structured data to the Astro layout
3. Set up GitHub Actions workflow with `withastro/action` to deploy Astro output to GitHub Pages
4. Verify build output, Lighthouse scores, and responsive breakpoints

### Future Enhancements
- Service worker for offline support (PWA)
- WCAG 2.2 Level AA accessibility audit (24x24px touch targets, visible focus indicators)
- Analytics integration (Google Analytics 4 or Plausible)

---

## Sources

- [Astro 6 Beta](https://astro.build/blog/astro-6-beta/)
- [Astro 2025 Year in Review](https://astro.build/blog/year-in-review-2025/)
- [Cloudflare Acquires Astro](https://www.cloudflare.com/press/press-releases/2026/cloudflare-acquires-astro-to-accelerate-the-future-of-high-performance-web-development/)
- [State of JavaScript 2025 Meta-Frameworks](https://2025.stateofjs.com/en-US/libraries/meta-frameworks/)
- [Astro vs Next.js Performance](https://eastondev.com/blog/en/posts/dev/20251202-astro-vs-nextjs-comparison/)
- [CloudCannon Top Five SSGs 2025](https://cloudcannon.com/blog/the-top-five-static-site-generators-for-2025-and-when-to-use-them/)
- [HTMX 2.0 Release](https://htmx.org/posts/2024-06-17-htmx-2-0-0-is-released/)
- [W3Techs HTMX Usage](https://w3techs.com/technologies/details/js-htmx)
- [eBay Launches Marko 5](https://innovation.ebayinc.com/stories/ebay-launches-marko-5/)
- [Web Awesome Component Library](https://blog.fontawesome.com/web-awesome-component-library/)
- [Shoelace Bundle Size Issue](https://github.com/shoelace-style/shoelace/issues/180)
