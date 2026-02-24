# Command Center

A personal portfolio dashboard for Jonathan Lloyd, designed as a sci-fi command center with glass-morphism aesthetics and a particle background. Built with [Astro](https://astro.build) and hosted on GitHub Pages.

<!-- TODO: Add screenshot -->

## Overview

The dashboard displays 13 interactive widgets organized in a split-panel layout with a fixed left panel (identity) and a scrollable right panel (body + mind columns). Astro generates static HTML at build time, shipping 0 KB of JavaScript by default. Interactive elements (particles, map, animations) use selective `is:inline` scripts.

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
- **Right panel** (65%): Two-column triptych grid -- Body (health/fitness) and Mind (coding/reading)

## Directory Structure

```
.
├── astro.config.mjs          # Astro + PWA configuration
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── src/
│   ├── components/           # 14 .astro components (one per widget)
│   ├── layouts/              # Dashboard.astro (head, SEO, scripts)
│   └── pages/                # index.astro (data loading, page composition)
├── public/
│   ├── css/                  # Design tokens, base, layout, components, effects
│   ├── assets/               # SVGs, PWA icons
│   ├── js/                   # particles.js, clock.js
│   └── manifest.webmanifest  # PWA manifest
├── data/                     # 6 JSON files (read at build time)
├── docs/wiki/                # Documentation (synced to GitHub Wiki)
├── legacy/                   # Old root site preserved for reference
└── .github/workflows/        # Deploy + wiki sync actions
```

## Running Locally

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # Outputs to dist/
npm run preview   # Preview build locally
```

## Design System

The visual language is built on a dark sci-fi aesthetic with glass-morphism cards:

- **Background**: `#06060f` (near-black)
- **Glass cards**: `rgba(255,255,255,0.07)` background with `rgba(255,255,255,0.1)` borders and `16px` backdrop blur
- **Neon palette**: Pink (`#ff006e`), Blue (`#3a86ff`), Green (`#06d6a0`), Amber (`#f59e0b`), Purple (`#a855f7`)
- **Typography**: [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) with fluid `clamp()` tokens scaling from 0.36rem to 2.4rem across 600px–1400px viewports
- **Responsive scaling**: Fluid `clamp()` design tokens for typography and spacing, CSS Container Queries on `.tri-card` for widget-level adaptation, structural breakpoints at 1100px/900px/600px
- **Animations**: Particle field, count-up numbers, staggered card reveals, terminal typing, wave effects

## Technology Stack

- [Astro](https://astro.build) -- Static site generation (0 KB JS by default, islands architecture)
- [Three.js](https://threejs.org) -- Particle background animation
- [Leaflet](https://leafletjs.com) -- Interactive map widget
- [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) -- Typography
- [@vite-pwa/astro](https://github.com/ArmMbworworX/vite-pwa) -- Progressive Web App support
- [Simple Analytics](https://simpleanalytics.com) -- Privacy-focused analytics

## Documentation

Detailed documentation is available in [`docs/wiki/`](docs/wiki/Home.md) and on the [GitHub Wiki](https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/wiki):

- [Astro Implementation](docs/wiki/Astro-Implementation.md) -- Architecture, components, data flow
- [Brand Guide](docs/wiki/Brand-Guide.md) -- Colors, typography, glass-morphism, widget structure
- [Why Astro](docs/wiki/Why-Astro.md) -- Framework evaluation and decision rationale
