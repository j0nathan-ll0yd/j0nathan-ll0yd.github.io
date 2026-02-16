# Verification Prompt: Command Center Implementations

Use this prompt in a new Claude Code session to verify all four implementations against their framework paradigms.

---

## Prompt

I have four Command Center dashboard implementations that were recently fixed. I need you to verify each one is correctly using its framework's paradigms and best practices by researching the actual documentation and community patterns. Perform **20 web searches per implementation** (80 total) and then audit the code for correctness.

The repo is at `/Users/jlloyd/Repositories/j0nathan-ll0yd.github.io/implementations/`.

---

### Implementation 1: HTMX (`implementations/htmx/`)

**Key files:** `index.html`, `js/app.js`, `js/helpers.js`, `js/init.js`

**Architecture:** We removed the htmx-ext-client-side-templates extension and replaced it with direct `fetch()` + Handlebars template rendering. htmx script tags were removed entirely. Templates are in `<script type="text/x-handlebars-template">` elements. A new `app.js` fetches 6 JSON files, compiles templates, renders widgets, stores data on `window.__` globals, and dispatches a custom `dataReady` event that `init.js` listens for.

**Research these 20 topics (one search each):**
1. Handlebars.js `<script type="text/x-handlebars-template">` vs `<template>` tag — which is correct for Handlebars 4.x?
2. Handlebars.compile() — does it work on innerHTML of script tags? Any gotchas with HTML entities?
3. Handlebars registerHelper — correct way to register helpers that return booleans (subexpressions like `{{#if (eq type "prompt")}}`)
4. Handlebars SafeString — do any of our helpers need to return SafeString to avoid double-escaping?
5. Handlebars `{{lookup ../statusLabels status}}` — is this the correct syntax for parent context access in nested each blocks?
6. Handlebars `{{json this}}` helper — will JSON.stringify output be correctly escaped inside HTML `data-book` attributes?
7. `document.addEventListener('DOMContentLoaded', async () => {})` — is async DOMContentLoaded safe in all browsers?
8. `Promise.all` with `.then(r => r.json())` — does this handle HTTP errors (non-200 responses)?
9. Custom events with `new Event('dataReady')` — browser support and correct dispatch pattern
10. `document.querySelector('#cardHR .widget-body')` — specificity when multiple .widget-body exist; will this always select the right one?
11. Handlebars `{{round quantities.heartRate.value}}` — does dot notation work for deeply nested object access?
12. Handlebars `{{multiply @index 0.1}}` — is `@index` available in `{{#each}}` blocks? Does multiply helper receive correct types?
13. Handlebars `{{#if (hasArrow text)}}` — subexpression syntax for boolean helpers in Handlebars 4.x
14. Handlebars template compilation — performance of compiling 13 templates on page load; should we use precompilation?
15. `window.__healthData` global pattern — is this safe? Race conditions between app.js and init.js?
16. `innerHTML` for rendering templates — XSS risks when template data comes from JSON files
17. Leaflet map initialization after dynamic DOM insertion — correct timing for `L.map()` after innerHTML
18. Three.js particle system initialization — should it wait for DOMContentLoaded or run immediately?
19. `IntersectionObserver` on dynamically inserted elements — does observation work after innerHTML?
20. Handlebars `{{toLocaleString (round quantities.stepCount.value)}}` — nested helper calls, correct evaluation order?

**After researching, audit:**
- Are all Handlebars templates correctly structured?
- Are helpers correctly registered (especially boolean helpers used as subexpressions)?
- Is the fetch → compile → render → event dispatch flow correct?
- Are there any race conditions between app.js and init.js?
- Any XSS or escaping issues in templates?

---

### Implementation 2: Web Awesome / Shoelace (`implementations/webawesome/`)

**Key files:** `index.html`, `js/app.js`, `css/wa-overrides.css`

**Architecture:** Uses Shoelace 2.20.1 web components via CDN autoloader (`shoelace-autoloader.js`). Despite the directory name "webawesome", it uses Shoelace's `sl-` prefix, not Web Awesome's `wa-` prefix. `app.js` is loaded as `type="module"`. It listens for `DOMContentLoaded`, waits for 4 Shoelace custom elements (`sl-card`, `sl-avatar`, `sl-badge`, `sl-switch`) via `customElements.whenDefined()`, then fetches 6 JSON data files in parallel and calls `renderAll`. The `renderAll` function awaits `updateComplete` on `sl-avatar` before setting its `image` property. The workout toggle uses the `sl-change` event on `sl-switch`. The book modal uses a **custom div overlay** (`<div class="book-overlay">`), not `sl-dialog`, despite `sl-dialog` CSS overrides existing in `wa-overrides.css`. CSS overrides map `--sl-*` custom properties to the dashboard's design tokens and use `::part()` selectors to style component shadow DOM internals. Note: `wa-overrides.css` contains CSS for components not used in the HTML (`sl-dialog`, `sl-tag`, `sl-tooltip`, `sl-progress-bar`, `sl-divider`) — these are dead CSS.

**Research these 20 topics (one search each):**
1. Shoelace 2.x vs Web Awesome 3.x — what is the migration path? Should this implementation use `wa-` prefix and Web Awesome instead of `sl-` Shoelace?
2. Shoelace autoloader (`shoelace-autoloader.js`) — does it register all components or only those found in the DOM? What happens when components are added dynamically after initial load?
3. Shoelace 2.x `customElements.whenDefined()` — is this the recommended way to wait for registration, or should the code use Shoelace's own ready utilities?
4. `customElements.whenDefined` — does it resolve if the element tag isn't in the DOM but the script is loaded? Relevance to only waiting for 4 of the components while CSS targets more
5. Shoelace `sl-avatar` — correct way to set `image` property programmatically after upgrade; is `await updateComplete` required before setting `image`?
6. Lit `updateComplete` — when does it resolve? Can it be awaited before first render? What happens if called on a component that hasn't been upgraded yet?
7. Shoelace `sl-switch` — `sl-change` event vs native `change` event; which fires and which should be listened for?
8. Shoelace `sl-switch` — `checked` property access; is reading `.checked` reliable after upgrade without `await updateComplete`?
9. Shoelace `sl-badge` — setting `variant` property via JS (`hrBadge.variant = state.badgeVariant`); does this work without `await updateComplete`?
10. Shoelace `sl-badge` `pulse` attribute — is `pulse` a valid attribute for Shoelace 2.20.1? Does it animate the badge?
11. Shoelace `sl-card` — `::part(base)` and `::part(body)` CSS selectors; are these the correct part names for Shoelace 2.x cards?
12. Shoelace `::part()` CSS — does it work before component upgrade? Timing of style application vs component registration
13. Shoelace 2.x dark theme — `cdn/themes/dark.css` import; does it need to be loaded before the autoloader script? Current order: CSS before script
14. Shoelace `--sl-*` custom property mapping — is it correct to override `--sl-color-primary-600`, `--sl-panel-background-color`, etc. in `:root`? Or should these be scoped?
15. `type="module"` scripts are deferred — DOMContentLoaded fires after module scripts execute; is the `DOMContentLoaded` listener in `app.js` redundant since the script is already deferred?
16. Shoelace `sl-dialog` CSS parts (`::part(overlay)`, `::part(panel)`, `::part(body)`, `::part(close-button)`) — are these valid for 2.20.1? The implementation has CSS for `sl-dialog` but doesn't use it in HTML
17. Web Awesome `allDefined()` utility — does this exist in Shoelace 2.x or is it Web Awesome 3.x only? Should the implementation use it?
18. Shoelace `sl-tag`, `sl-tooltip`, `sl-progress-bar`, `sl-divider` — CSS overrides exist in `wa-overrides.css` but these components don't appear in the HTML or JS; are they dead code?
19. Web Components — setting properties on upgraded custom elements via direct assignment (`avatarEl.image = '...'`) vs `setAttribute()`; which is correct for Lit-based components?
20. Shoelace 2.x end-of-life — is Shoelace 2.20.1 still maintained, or should new projects use Web Awesome 3.x? What are the breaking changes in migration?

**After researching, audit:**
- Is the `DOMContentLoaded` → `whenDefined` → `fetch` → `renderAll` pipeline correct, or is `DOMContentLoaded` redundant for a `type="module"` script?
- Are all Shoelace component interactions (property access, method calls, event listeners) happening after upgrade?
- Are `::part()` CSS selectors correctly targeting shadow DOM parts? Are the part names valid for Shoelace 2.20.1?
- Is `wa-overrides.css` correctly mapping Shoelace CSS custom properties to design tokens?
- Is there dead CSS for unused components (`sl-dialog`, `sl-tag`, `sl-tooltip`, `sl-progress-bar`, `sl-divider`)?
- Should the implementation migrate from Shoelace 2.x (`sl-`) to Web Awesome 3.x (`wa-`)?
- The book modal uses a custom div overlay — should it use `sl-dialog` instead since CSS overrides already exist for it?
- Does the `sl-badge[pulse]` attribute work in Shoelace 2.20.1?
- Any issues with `type="module"` script execution timing and `DOMContentLoaded`?

---

### Implementation 3: Marko (`implementations/marko/`)

**Key files:** `src/index.marko`, `src/components/*.marko`, `build.js`, `dist/index.html`

**Architecture:** Server-side rendered with Marko 5. `build.js` reads JSON data files, renders the Marko template to a string, and writes `dist/index.html`. All interactivity (particles, clock, map, hydration animation, terminal typing, workout toggle, book modal) is handled by inline `<script>` tags in the output HTML. Data is passed to client JS via `window.__` globals embedded as inline scripts.

**Research these 20 topics (one search each):**
1. Marko 5 template syntax — backtick interpolation for inline styles (`style=\`background-image: url(...)\``)
2. Marko 5 — `$ var p = input.profile;` scriptlet syntax; is this still supported in Marko 5?
3. Marko 5 attribute syntax — `href=p.github` without quotes; is this valid for dynamic attributes?
4. Marko 5 `renderToString` — correct API for server-side rendering to static HTML
5. Marko 5 `require('marko/node-require')` — deprecation status; migration to `@marko/compiler/register`
6. Marko 5 component input — `input.profile` vs `input` access patterns in templates
7. Marko 5 `<div>` with inline style containing `background-image` — correct syntax for CSS in Marko
8. Marko 5 `${expression}` interpolation — text content interpolation; HTML escaping behavior
9. Marko 5 conditional rendering — `if()` vs `<if>` tag; which is current best practice?
10. Marko 5 iteration — `for()` vs `<for>` tag; each vs for-of patterns
11. Marko 5 attribute spread — dynamic attributes and style objects
12. Marko 5 SSR — does `renderToString` produce minified HTML? Attribute quoting behavior
13. Marko 5 — embedding `<script>` tags in templates; does Marko escape content inside script tags?
14. Marko 5 — `JSON.stringify` in inline scripts within templates; XSS prevention with `</script>` in data
15. Marko 5 component naming — file-based component resolution (`<identity-card>` maps to `components/identity-card.marko`)
16. Marko 5 — passing complex objects as component input (`profile=input.profile`)
17. Marko 5 — style attribute syntax; string vs object; does Marko auto-vendor-prefix?
18. Marko 5 build tooling — `node build.js` custom build script vs `@marko/build` or `@marko/vite`
19. Marko 5 — `data-` attribute handling; are values auto-escaped? Does `JSON.stringify` in data attributes work?
20. Marko 5 — SVG rendering in templates; self-closing tags (`<circle />`) vs Marko conventions

**After researching, audit:**
- Is the backtick style syntax correct for Marko 5 inline styles?
- Does `background-image: url(...)` work correctly when rendered to static HTML?
- Are all component templates producing valid HTML that matches the CSS expectations?
- Is the `build.js` script using non-deprecated APIs?
- Are inline `<script>` blocks with `window.__` globals safe from XSS?
- Does the `dist/index.html` output match the canonical structure?

---

### Implementation 4: Astro (`implementations/astro/`)

**Key files:** `src/pages/index.astro`, `src/layouts/Dashboard.astro`, `src/components/*.astro`, `astro.config.mjs`, `scripts/copy-assets.js`

**Architecture:** Astro 5.0 with `output: 'static'` (SSG). 14 Astro components in `src/components/`, 1 layout (`Dashboard.astro`), and 1 page (`index.astro`). Data is loaded at build time via `fs.readFileSync` from `../../data/*.json` using `process.cwd()` path resolution in component frontmatter. No framework integrations (no React/Vue/Svelte) — pure Astro components only. All client-side interactivity is handled by `<script is:inline>` blocks wrapped in IIFEs. `define:vars` is used in some components (Workouts, Hydration) to pass server data to client scripts. Props are passed to components via `Astro.props` (e.g., `<HeartRate health={health} />`). The layout uses `<slot />` for content injection. Global CSS only (no Astro scoped `<style>` tags) — 5 CSS files are copied from the repo root via `scripts/copy-assets.js` as a prebuild step. CDN scripts (Three.js r128, Leaflet 1.9.4) are loaded with `is:inline` in the Dashboard layout. Book data is passed to the client via `JSON.stringify` in `data-book` attributes.

**Research these 20 topics (one search each):**
1. Astro 5.0 `output: 'static'` — is this still the correct SSG configuration? Any changes from Astro 4.x?
2. Astro `fs.readFileSync` in frontmatter — is direct file system access the recommended way to load data at build time, or should Content Collections / Content Loader API be used?
3. Astro `process.cwd()` with relative path (`'..', '..', 'data'`) — is this reliable across build environments? Does `process.cwd()` always resolve to the Astro project root?
4. Astro `<script is:inline>` — what processing does Astro skip? Does it prevent bundling, minification, deduplication, and `type="module"` conversion?
5. Astro `is:inline` on CDN script tags (`<script is:inline src="https://...">`) — is this required for external CDN scripts, or will Astro handle them correctly without it?
6. Astro `define:vars` directive — how are server variables serialized to inline scripts? Does it use `JSON.stringify`? Are there XSS risks with `</script>` in data?
7. Astro component props — is `const { health } = Astro.props;` the correct pattern? Should a TypeScript `Props` interface be defined for type safety?
8. Astro `<slot />` in layout components — correct usage pattern for Dashboard layout; is a default slot sufficient or should named slots be used?
9. Astro global CSS vs scoped `<style>` — the implementation uses 5 global CSS files with no component-scoped styles; is this acceptable, or should components use Astro's scoped `<style>` tags?
10. Astro `scripts/copy-assets.js` build script — is a custom prebuild script the right way to share CSS files from a parent directory, or is there an Astro-native approach (symlinks, `publicDir` config, aliases)?
11. Astro IIFE pattern in inline scripts — are IIFEs necessary to avoid global scope pollution, or does Astro already scope inline scripts?
12. Astro template expressions — `.map()` for lists, ternary for conditionals; are these the correct Astro template patterns? Any differences from JSX?
13. Astro `set:html` directive — the implementation uses `innerHTML` in some inline scripts; should it use `set:html` for server-rendered dynamic HTML instead?
14. Astro + Three.js — is CDN loading with `is:inline` the recommended integration pattern, or should Three.js be installed as an npm dependency and imported?
15. Astro + Leaflet — correct initialization timing; does the `is:inline` script execute after the DOM is ready since it's at the bottom of the body?
16. Astro `JSON.stringify` in `data-book` attributes — is this safe from XSS? Does Astro auto-escape attribute values containing HTML entities?
17. Astro IntersectionObserver in `is:inline` scripts — does this work correctly on statically-generated pages? Any timing issues with DOM elements?
18. Astro build output — does `astro build` produce hashed asset filenames by default? How does it handle the 5 global CSS files from `public/`?
19. Astro without framework integration — is it valid to use pure Astro components without React/Vue/Svelte for an interactive dashboard? Any limitations vs using Islands Architecture?
20. Astro component architecture — 14 components in a flat `components/` directory; is file-based component resolution correct? Any naming conventions to follow?

**After researching, audit:**
- Is `fs.readFileSync` with `process.cwd()` a reliable data loading pattern, or should Content Collections be used?
- Are all `<script is:inline>` blocks correctly structured? Are IIFEs necessary?
- Is `define:vars` used correctly and safely (no XSS via serialized data)?
- Are Astro template expressions (`.map()`, ternary, `{expression}`) used correctly?
- Is `<script is:inline src="...">` required for CDN scripts, or is plain `<script src="...">` sufficient?
- Does the `copy-assets.js` prebuild script correctly sync shared CSS and assets?
- Are `Astro.props` being used correctly in all 14 components?
- Does the workout toggle work correctly with client-side JS on a statically-rendered page?
- Is `JSON.stringify` in `data-book` attributes properly escaped for HTML context?
- Should any components use Astro's scoped `<style>` tags instead of relying entirely on global CSS?

---

### Cross-Implementation Verification

After auditing all four, compare their `dist`/output HTML against the working Astro reference at `implementations/astro/dist/index.html`. Check:
- Same CSS classes on equivalent elements
- Same HTML structure for each widget
- Same data attributes for JS initialization
- Same script loading order for Three.js, Leaflet, and runtime code

Report any discrepancies as a prioritized list of issues to fix.
