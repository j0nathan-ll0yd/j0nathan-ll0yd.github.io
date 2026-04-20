# Human Datastream

A personal portfolio dashboard for Jonathan Lloyd, designed as a sci-fi dashboard with glass-morphism aesthetics and a Three.js particle background. Built with [Astro](https://astro.build) and hosted on GitHub Pages.

## Quick Start

```bash
# Development
npm install
npm run dev       # http://localhost:4321

# Production build
npm run build     # Outputs to dist/
npm run preview   # Preview build locally
```

Deployment is automatic via GitHub Actions on push to `master`.

## Documentation

- **[Astro Implementation](Astro-Implementation.md)** -- Architecture, components, data flow, and build system
- **[Brand Guide](Brand-Guide.md)** -- Colors, typography, glass-morphism, widget structure, responsive breakpoints
- **[Widget Specification](Widget-Specification.md)** -- Requirements, testing, and compliance for all widgets
- **[Why Astro](Why-Astro.md)** -- Framework evaluation and decision rationale
- **[LLM Content Spec](LLM-Content-Spec.md)** -- LLM-optimized content surface, file inventory, freshness expectations, Level 2 health granularity constraint

## Technology Stack

| Technology | Purpose |
|---|---|
| [Astro](https://astro.build) | Static site generation (0 KB JS by default) |
| [Three.js](https://threejs.org) | Particle background animation |
| [Leaflet](https://leafletjs.com) | Interactive map widget |
| [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) | Typography |
| [@vite-pwa/astro](https://github.com/ArmMbworworX/vite-pwa) | Progressive Web App support |
| [Simple Analytics](https://simpleanalytics.com) | Privacy-focused analytics |

## Repository Structure

```
.
├── astro.config.mjs          # Astro + PWA configuration
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── src/
│   ├── components/           # 56 .astro components (15 production + 35 sandbox + 6 non-widget)
│   ├── layouts/              # Dashboard.astro (head, scripts, analytics)
│   └── pages/                # index.astro (data loading, page composition)
├── public/
│   ├── css/                  # tokens, base, layout, components, effects
│   ├── assets/               # SVGs, PWA icons
│   ├── js/                   # particles.js, clock.js
│   └── manifest.webmanifest  # PWA manifest
├── data/                     # 6 JSON files (read at build time)
├── docs/wiki/                # Documentation (synced to GitHub Wiki)
├── legacy/                   # Old root site preserved for reference
├── .github/workflows/        # Deploy + wiki sync actions
├── .editorconfig             # 2-space indent, UTF-8, LF
├── .gitignore
├── .nojekyll                 # Bypass Jekyll on GitHub Pages
├── CLAUDE.md                 # AI assistant instructions
└── README.md
```

## Layout

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
- **Top bar**: "Human Datastream" title and live clock
- **Right panel** (65%): Two-column triptych grid -- Body (health/fitness) and Mind (coding/reading)
