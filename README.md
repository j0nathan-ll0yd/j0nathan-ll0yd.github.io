# Command Center

A personal portfolio dashboard for Jonathan Lloyd, designed as a sci-fi command center with glass-morphism aesthetics and a particle background.

<!-- TODO: Add screenshot -->

## Overview

The dashboard displays 13 interactive widgets organized in a split-panel layout with a fixed left panel (identity) and a scrollable right panel (body + mind columns). The site is static HTML/CSS/JS hosted on GitHub Pages, with four parallel framework re-implementations exploring different approaches to building the same UI.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Top Bar (clock)                   │
├──────────────┬──────────────────────────────────────┤
│              │         Body         │     Mind       │
│  Left Panel  │  Heart Rate          │  GitHub        │
│  (Identity)  │  Activity            │  Commits       │
│  Bio Term    │  Workouts            │  Reading       │
│  System      │  Sleep  Hydration    │  Bookshelf     │
│              │  Location            │                │
└──────────────┴──────────────────────────────────────┘
```

- **Left panel** (35%): Identity card, bio terminal with typing animation, system status
- **Top bar**: "Command Center" title and live clock
- **Right panel** (65%): Two-column triptych grid — Body (health/fitness) and Mind (coding/reading)

## Directory Structure

```
.
├── index.html              # Main dashboard
├── brand-guide.html        # Design system reference
├── .nojekyll               # Disables Jekyll processing
├── css/                    # Shared stylesheets (tokens, base, layout, components, effects)
├── data/                   # JSON data files + legacy JS globals + generator script
├── assets/                 # SVGs (avatar, favicon, logo)
├── js/                     # particles.js, clock.js, data-renderer.js
├── components/             # Design system component library pages
└── implementations/
    ├── astro/              # Astro SSG (reference implementation)
    ├── htmx/               # Handlebars + fetch
    ├── marko/              # Marko 5 SSR
    └── webawesome/         # Shoelace web components
```

## Design System

The visual language is built on a dark sci-fi aesthetic with glass-morphism cards:

- **Background**: `#06060f` (near-black)
- **Glass cards**: `rgba(255,255,255,0.07)` background with `rgba(255,255,255,0.1)` borders and `16px` backdrop blur
- **Neon palette**: Pink (`#ff006e`), Blue (`#3a86ff`), Green (`#06d6a0`), Amber (`#f59e0b`), Purple (`#a855f7`)
- **Typography**: [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) with a scale from 0.42rem to 2.2rem
- **Animations**: Particle field, count-up numbers, staggered card reveals, terminal typing, wave effects

See `brand-guide.html` for the full design system reference.

## Implementation Experiments

Four re-implementations of the same dashboard, each using a different framework:

| Implementation | Approach | Build Step | Key Files |
|---|---|---|---|
| **Astro** (reference) | Static site generation, `.astro` components | `npm run build` | `src/components/*.astro`, `src/pages/index.astro` |
| **HTMX** | Handlebars templates, `fetch()` for data | None | `index.html`, `js/app.js`, `js/helpers.js`, `js/init.js` |
| **Marko** | Server-side rendering to static HTML | `npm run build` | `src/index.marko`, `src/components/*.marko`, `build.js` |
| **Web Awesome** | Shoelace 2.x web components, ES modules | None | `index.html`, `js/app.js`, `css/wa-overrides.css` |

The Astro implementation is the reference — other implementations should match its output HTML structure and widget behavior.

## Data Files

Six JSON files in `data/` provide widget content:

| File | Contents |
|---|---|
| `profile.json` | Name, title, bio, avatar URL, social links |
| `health.json` | Heart rate, steps, calories, sleep, hydration, workouts |
| `github.json` | Contribution heatmap grid, recent commits, stats |
| `books.json` | Book covers, titles, authors, reading status |
| `reading.json` | RSS/article feed items |
| `system.json` | System status indicators |

The root site currently loads data via legacy JS globals (`data/mock-data.js`, `data/health-data.js`). Framework implementations fetch the JSON files directly. A future iteration will serve live data from CloudFront.

## Running Locally

**Root site** (no build step):
```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

**Astro** (requires Node.js):
```bash
cd implementations/astro
npm install
npm run dev
```

**Marko** (requires Node.js):
```bash
cd implementations/marko
npm install
npm run build
# Serve dist/ from root: python3 -m http.server 8000
```

**HTMX and Web Awesome** have no build step — serve from the repository root and navigate to their paths.

## Technology Stack

- [Three.js](https://threejs.org) — Particle background animation
- [Leaflet](https://leafletjs.com) — Interactive map widget
- [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) — Typography
- [Astro](https://astro.build) — Static site generation (reference implementation)
- [Marko](https://markojs.com) — Server-side rendering implementation
- [Handlebars](https://handlebarsjs.com) — Client-side templating (HTMX implementation)
- [Shoelace](https://shoelace.style) — Web components (Web Awesome implementation)
