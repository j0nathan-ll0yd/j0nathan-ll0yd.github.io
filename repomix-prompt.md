This is the **Human Datastream** portfolio — a single-page sci-fi dashboard built with Astro 6.x (static output, zero JS by default), hosted on Cloudflare Pages at jonathanlloyd.me. Created by Jonathan Lloyd.

## Read CLAUDE.md First

`CLAUDE.md` is the authoritative source for all coding conventions, design tokens, responsive breakpoints, SEO metadata, data flow, and caching architecture. Read it before making any changes.

## File Ordering in This Pack

Files are organized for progressive understanding:

1. **Conventions** — `CLAUDE.md`, `AGENTS.md`, `.editorconfig`, config files
2. **Types & Constants** — `exports.ts` (all data contracts), `constants.ts` (endpoints, thresholds)
3. **Design Tokens** — `tokens.css` (colors, typography, spacing — the design system source of truth)
4. **Architecture** — `Dashboard.astro` (HTML head, SEO, JSON-LD), `index.astro` (page composition + all inline JS)
5. **Data Pipeline** — `api.ts` → `adapters.ts` → `updaters.ts` + `poll-engine.ts` / `ws-client.ts`
6. **CSS** — `base.css`, `effects.css`, `components.css`, `layout.css`
7. **Components** — `.astro` widget templates (if included in this pack)
8. **Data** — `data/*.json` build-time data schemas

## Quick Reference: When Working On...

- **Styling**: `public/css/tokens.css` + `public/css/components.css` + `src/styles/layout.css`
- **Data flow**: `src/lib/adapters.ts` → `src/lib/updaters.ts` + `src/lib/poll-engine.ts` + `src/lib/ws-client.ts` + `src/lib/api.ts`
- **New widget**: Follow `.tri-card` pattern in any component → add types in `exports.ts` → compose in `index.astro`
- **Inline JS**: ES5 only — `var`, IIFEs, `function` declarations. No `let`/`const`/arrows in `<script is:inline>`.

## What Is NOT Included

Dev-only showcase pages (`src/showcase/`), standalone preview HTML (`previews/`), `.query.ts` sample data files, binary assets (images, fonts), and vendored libraries (Leaflet). These are excluded to maximize signal density. If you need showcase context, ask the user to run `npx repomix` with the showcase files included.
