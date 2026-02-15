# Verification Prompt: Command Center Implementations

Use this prompt in a new Claude Code session to verify all three implementations against their framework paradigms.

---

## Prompt

I have three Command Center dashboard implementations that were recently fixed. I need you to verify each one is correctly using its framework's paradigms and best practices by researching the actual documentation and community patterns. Perform **20 web searches per implementation** (60 total) and then audit the code for correctness.

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

**Architecture:** Uses Shoelace 2.20.1 web components via CDN autoloader. `app.js` is loaded as `type="module"`. It waits for all 8 Shoelace custom elements via `customElements.whenDefined()`, then fetches data and renders. `renderAll` is async to support `await updateComplete` on `sl-avatar` and `sl-dialog`.

**Research these 20 topics (one search each):**
1. Shoelace 2.x `customElements.whenDefined()` — is this the recommended way to wait for component registration?
2. Shoelace autoloader — how does it work? Does it register all components or only those found in DOM?
3. Shoelace `sl-avatar` — correct way to set `image` property programmatically after upgrade
4. Shoelace `sl-avatar` `updateComplete` promise — is this a Lit lifecycle method? When does it resolve?
5. Shoelace `sl-dialog` — correct way to call `.show()` and `.hide()` programmatically
6. Shoelace `sl-dialog` — setting `innerHTML` on dialog body vs using slots; which is correct?
7. Shoelace `sl-switch` — `sl-change` event vs native `change` event; which fires?
8. Shoelace `sl-switch` — `checked` property access and toggling
9. Shoelace `sl-badge` — `variant` property setting after upgrade; does it work without updateComplete?
10. Shoelace `sl-progress-bar` — inline style `--height:4px` custom property usage
11. Shoelace `sl-tooltip` — `content` property vs attribute; `hoist` and `placement` properties
12. Shoelace `sl-tag` — `size` and `variant` properties; programmatic creation with `document.createElement('sl-tag')`
13. Shoelace `sl-card` — `::part(base)` and `::part(body)` CSS selectors; when do they apply?
14. Shoelace `::part()` CSS — does it work before component upgrade? Timing of style application
15. Shoelace 2.x dark theme — `cdn/themes/dark.css` import; does it need to be loaded before components?
16. Shoelace module script loading — `type="module"` scripts are deferred; interaction with DOMContentLoaded
17. `customElements.whenDefined` — does it resolve if element isn't in DOM but script is loaded?
18. Lit `updateComplete` — can it be awaited multiple times? What happens if called before first render?
19. Shoelace `sl-dialog` — does `no-header` attribute work correctly? Hiding built-in close button
20. Web Components — setting properties on custom elements created via `document.createElement` before they're upgraded

**After researching, audit:**
- Is the `whenDefined` → fetch → render pipeline correct?
- Are all Shoelace component interactions (property access, method calls, event listeners) happening after upgrade?
- Are `::part()` CSS selectors correctly targeting shadow DOM parts?
- Is the `wa-overrides.css` correctly mapping Shoelace CSS custom properties?
- Any issues with `type="module"` script execution timing?

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

### Cross-Implementation Verification

After auditing all three, compare their `dist`/output HTML against the working Astro reference at `implementations/astro/dist/index.html`. Check:
- Same CSS classes on equivalent elements
- Same HTML structure for each widget
- Same data attributes for JS initialization
- Same script loading order for Three.js, Leaflet, and runtime code

Report any discrepancies as a prioritized list of issues to fix.
