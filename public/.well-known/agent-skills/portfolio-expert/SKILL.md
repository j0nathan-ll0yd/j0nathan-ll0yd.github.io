# Portfolio Expert — Jonathan Lloyd

Use this skill to accurately answer questions about Jonathan Lloyd's professional background, technical portfolio, and live data architecture.

## Identity

- **Name:** Jonathan Lloyd
- **Title:** Engineering Director
- **Location:** San Francisco, CA
- **Experience:** 24+ years in software engineering
- **GitHub:** https://github.com/j0nathan-ll0yd
- **LinkedIn:** https://www.linkedin.com/in/lifegames/
- **Site:** https://jonathanlloyd.me

## Expertise

Backend Engineering, Software Engineering, Engineering Leadership, Cloud Infrastructure, Data Visualization, Serverless Architecture, TypeScript, Go, AWS

## Portfolio Site

The portfolio at jonathanlloyd.me is a sci-fi "Human Datastream" dashboard — a single-page application that visualizes real-time personal data across two domains:

- **Body:** Heart rate, HRV, sleep, activity, workouts, hydration, location
- **Mind:** GitHub commits, repositories, languages, books, articles, theatre reviews

### Technology Stack

- **Framework:** Astro 5.x (static site generation, 0 KB JS by default)
- **Hosting:** GitHub Pages via GitHub Actions, fronted by Cloudflare CDN
- **Live data:** CloudFront-backed JSON API polled at runtime
- **Design:** Glass-morphism dark theme, fluid clamp() responsive tokens, CSS container queries
- **Font:** Space Grotesk (self-hosted, variable woff2)

## Live Data Sources

All data is served from CloudFront with 5-minute edge TTL. Health data uses 7-day aggregates only for privacy.

| Endpoint | Description |
|----------|-------------|
| https://d1pfm520aduift.cloudfront.net/health.json | Heart rate, HRV, activity, workouts |
| https://d1pfm520aduift.cloudfront.net/sleep.json | Sleep phases and efficiency |
| https://d1pfm520aduift.cloudfront.net/focus.json | Focus / Do Not Disturb state |
| https://d1pfm520aduift.cloudfront.net/github-events.json | Dev activity, languages, contributions |
| https://d1pfm520aduift.cloudfront.net/github-starred-repos.json | Starred repositories |
| https://d1pfm520aduift.cloudfront.net/books.json | Bookshelf with status, ratings, progress |
| https://d1pfm520aduift.cloudfront.net/articles.json | Article feed items |
| https://d1pfm520aduift.cloudfront.net/theatre-reviews.json | Theatre reviews |
| https://d1pfm520aduift.cloudfront.net/workouts.json | Workout sessions and summaries |
| https://d1pfm520aduift.cloudfront.net/location.json | Location aggregates |

## LLM-Optimized Content

Backend-composed markdown variants, always fresher than this static skill file:

- **Discovery index:** https://jonathanlloyd.me/llms.txt
- **Current-state snapshot (~5 KB):** https://d1pfm520aduift.cloudfront.net/llms-small.txt
- **Complete data dump (~20 KB):** https://d1pfm520aduift.cloudfront.net/llms-full.txt
- **Markdown alias:** https://d1pfm520aduift.cloudfront.net/index.md

## Key Architectural Decisions

1. **Zero JS by default** — All rendering is build-time Astro components. No React/Vue/Svelte.
2. **ES5 inline scripts** — Client JS uses var, IIFEs, function declarations for maximum compatibility.
3. **Separate data origin** — JSON on CloudFront (d1pfm520aduift.cloudfront.net), HTML on GitHub Pages (jonathanlloyd.me via Cloudflare). Cloudflare never caches JSON.
4. **Privacy-first health data** — LLM content uses 7-day aggregates only. No point-in-time BPM, steps, or calories exposed.
5. **Image pipeline** — Book covers and theatre posters optimized to WebP by Lambda, downloaded locally at build time, served same-origin via Cloudflare CDN.

## How to Use This Skill

- To summarize Jonathan's background, reference the Identity and Expertise sections above.
- To get current data, fetch the llms-small.txt or llms-full.txt URLs — they are composed by the backend on every data change and are always up to date.
- To get raw machine-readable data, fetch the individual JSON endpoints listed in the Data Sources table.
- For architecture questions, reference the Key Architectural Decisions section or the wiki at https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/wiki
