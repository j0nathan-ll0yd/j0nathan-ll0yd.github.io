# CLAUDE.md -- Command Center Portfolio

## Project Overview

Personal portfolio site for Jonathan Lloyd, styled as a "Command Center" dashboard. Built with Astro (static site generation) and hosted on GitHub Pages. The site ships 0 KB JavaScript by default, with selective `is:inline` scripts for particles, map, and animations.

## Repository Structure

```
.
├── astro.config.mjs          # Astro + PWA configuration
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript (extends astro/tsconfigs/strict)
├── src/
│   ├── components/           # 14 .astro components (one per widget)
│   ├── layouts/              # Dashboard.astro, Showcase.astro
│   ├── pages/                # index.astro (data loading, page composition)
│   └── showcase/             # Dev-only component showcase pages (not in src/pages/)
├── public/
│   ├── css/
│   │   ├── tokens.css        # Design tokens (colors, typography, spacing, radii, blur, glows)
│   │   ├── base.css          # Reset, body, scrollbar, global styles
│   │   ├── layout.css        # .command-layout, .left-panel, .top-bar, .right-panel, responsive
│   │   ├── components.css    # Widget cards, identity card, terminal, map, charts, modals
│   │   ├── effects.css       # Animations, transitions, glows, particle canvas
│   │   └── showcase.css      # Styles for dev-only component showcase
│   ├── assets/               # avatar.svg, favicon.svg, logo.svg, PWA icons
│   ├── js/
│   │   ├── particles.js      # Three.js particle background (legacy, now inlined in index.astro)
│   │   └── clock.js          # Live clock (legacy, now inlined in index.astro)
│   └── manifest.webmanifest  # PWA manifest
├── data/
│   ├── profile.json          # Name, title, bio, avatar, social links
│   ├── health.json           # Heart rate, steps, sleep, hydration, workouts
│   ├── github.json           # Contribution heatmap, recent commits, stats
│   ├── books.json            # Bookshelf with covers, authors, status
│   ├── reading.json          # RSS/article feed items
│   ├── system.json           # System status indicators
│   └── showcase-empty.json   # Empty state props for showcase pages
├── docs/
│   └── wiki/                 # Documentation (synced to GitHub Wiki)
│       ├── Home.md           # Wiki homepage
│       ├── Astro-Implementation.md  # Architecture and components
│       ├── Brand-Guide.md    # Design system reference
│       └── Why-Astro.md      # Framework evaluation
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml        # Build + deploy Astro to GitHub Pages
│   │   └── sync-wiki.yml     # Sync docs/wiki/ to GitHub Wiki
│   └── scripts/              # sync-wiki.sh, generate-sidebar.sh
├── .editorconfig             # 2-space indent, UTF-8, LF
├── .gitignore
├── .nojekyll                 # Bypass Jekyll on GitHub Pages
└── README.md
```

## Conventions

### Editor / Formatting
- 2-space indentation (all files)
- UTF-8 charset, LF line endings
- Trim trailing whitespace (except `.md`)
- Insert final newline

### CSS
- All colors, typography, spacing, and effects use custom properties from `public/css/tokens.css`
- Glass-morphism pattern: `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--blur-md));`
- Widget card structure: `.tri-card` > `.widget-header` + `.widget-body`
- Widget header: `.widget-label` + `.widget-header-right` > `.live-dot` + `.widget-timestamp`
- Accent classes: `.tri-card-accent-pink`, `-blue`, `-green`, `-amber`, `-purple`

### JavaScript (Inline Scripts)
- ES5 only: `var`, IIFEs, `function` declarations -- no `let`/`const`/arrow functions
- Each script wrapped in an IIFE: `(function() { ... })();`
- All client JS is embedded in `src/pages/index.astro` as `<script is:inline>` blocks

### Astro Components
- 14 components in `src/components/`, one per widget
- Props receive data objects parsed from JSON files
- No client-side framework -- all rendering is build-time

## Data Flow

| Context | How data is loaded |
|---|---|
| Astro build | `fs.readFileSync` from `data/*.json` in `src/pages/index.astro` frontmatter |
| Future | CloudFront-backed API serving real data |

## Component Showcase (Dev Only)

A visual storyboard for iterating on components, available only during `npm run dev` at `/showcase/`. Routes are injected via a local Astro integration (`showcase-dev-only` in `astro.config.mjs`) that only activates when `command === 'dev'`. Showcase files live in `src/showcase/` (not `src/pages/`), so they are excluded from production builds.

| Route | Page | Components |
|---|---|---|
| `/showcase` | `index.astro` | Landing page with cards linking to each domain group |
| `/showcase/brand-guide` | `brand-guide.astro` | Colors, typography, glass-morphism, glows, spacing, animations |
| `/showcase/identity-system` | `identity-system.astro` | IdentityCard, BioTerminal, SystemStatus, Command Bar, ComingSoon |
| `/showcase/health-wellness` | `health-wellness.astro` | HeartRate, DailyActivity, Workouts, NightSummary, Hydration, Location |
| `/showcase/contributions-commits` | `contributions-commits.astro` | ContributionGrid, ContributionCalendar, GitHubHeatmap, CommitLog, CommitTimeline, RecentCommits, + 6 trend widgets |
| `/showcase/repositories-languages` | `repositories-languages.astro` | PinnedRepos, TopRepos, RepoShowcase, StarredRepoList, + 9 language/profile widgets |
| `/showcase/activity-feeds` | `activity-feeds.astro` | DevActivityLog, DevActivityTimeline, DevActivityCards, DevActivityByRepo, DevActivityPulse, ActivityFeed |
| `/showcase/reading-books` | `reading-books.astro` | ReadingFeed, Bookshelf, BookModal |

Each component page renders all 45 components in 3 states (skeleton, empty, active) using data from `data/showcase-empty.json`, `data/*.json`, and `.query.ts` co-located exports.

## Design System Quick Reference

### Colors
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#06060f` | Page background |
| `--neon-pink` | `#ff006e` | Primary accent, left panel border |
| `--neon-blue` | `#3a86ff` | Secondary accent, hydration |
| `--neon-green` | `#06d6a0` | Success, mind column |
| `--neon-amber` | `#f59e0b` | Warning, heart rate |
| `--neon-purple` | `#a855f7` | Sleep, night summary |
| `--neon-red` | `#ef4444` | Alert states |
| `--text` | `#f0f0f0` | Primary text |
| `--text-muted` | `#9ca3af` | Secondary text |

### Glass-morphism
```css
background: var(--glass-bg);        /* rgba(255,255,255,0.07) */
border: 1px solid var(--glass-border); /* rgba(255,255,255,0.1) */
backdrop-filter: blur(var(--blur-md)); /* 16px */
```

### Typography
- Font: `Space Grotesk` (Google Fonts)
- Scale: `--font-size-xs` (0.42rem) through `--font-size-hero` (2.2rem)

### Responsive Breakpoints
| Breakpoint | Behavior |
|---|---|
| `1400px` | Adjusts panel proportions |
| `1100px` | Further layout adjustments |
| `900px` | Stacks to single column |
| `600px` | Mobile optimizations |

## Running Locally

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # Outputs to dist/
npm run preview   # Preview build locally
```

## Rules and Guardrails

### DO NOT
- Use ES6+ syntax (`let`, `const`, arrow functions, template literals) in inline `<script is:inline>` blocks
- Remove `.nojekyll` -- GitHub Pages needs it to serve the site without Jekyll processing
- Modify `public/css/` files without testing all responsive breakpoints

### DO
- Use CSS custom properties from `public/css/tokens.css` for all colors, spacing, and typography
- Follow the widget HTML structure: `.tri-card` > `.widget-header` + `.widget-body`
- Test all four responsive breakpoints (1400px, 1100px, 900px, 600px)
- Run `npm run build` to verify changes compile correctly
- Refer to `docs/wiki/` for detailed documentation on architecture, design system, and decisions
