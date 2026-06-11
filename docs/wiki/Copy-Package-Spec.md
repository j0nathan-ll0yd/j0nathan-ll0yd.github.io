# Cross-Platform Copy Package (`@lifegames/copy`)

Single source of truth for every customer-facing string across the four Lifegames
Portal repos. Produced by the **design system** (`design-system-Lifegames`),
consumed by **web**, **iOS**, the **backend**, and the **design system** itself.
The invariant is **zero customer-facing string duplication**.

Origin: ONBOARDING review item #10 ("extract all strings into a format with better
context management, cross-repository").

## Scope

| Wave | Surface |
|---|---|
| **V1 (shipped)** | The **identity slice**: `person`, `site`, `seo`, `a11y`. Migrated everywhere the identity was hardcoded/duplicated (web `Dashboard.astro` + PWA manifest, backend LLM-content pipeline, the DS OG-image widget, iOS Settings→About). |
| **V2 (backlog)** | Widget labels + empty-states, error/validation messages (passthrough model — copy holds display text, client may override), iOS feature-module sweep, a11y breadth, email/notification templates. |

**Never copy:** dynamic/interpolated runtime values (book titles, `${status}`), debug
logs, JSON-LD machine metadata that isn't prose, and **test/`#Preview` mock data**.
Known excluded surfaces today: SwiftUI `#Preview` blocks (e.g. `BioTerminalView`),
and the private, non-deployed `apps/portfolio` DS showcase.

## Authoring model

Strings are authored in `design-system-Lifegames/packages/copy/src/identity.en-US.json`
as a **rich** tree. Every leaf is `{ value, _meta }`:

```jsonc
"shortBio": {
  "value": "A living data dashboard by engineer, Jonathan Lloyd — …",  // ICU MessageFormat 1
  "_meta": {
    "description": "SEO meta description.",
    "usage": ["web:Dashboard.astro:5 (meta description)"],  // every render site
    "tone": "marketing",
    "owner": "jonathan",
    "lastReviewed": "2026-06-11",          // format:date, Ajv-enforced
    "constraints": { "maxChars": 160 },     // CI-linted
    "rationale": "Distinct from socialBio: …"
  }
}
```

- **ICU MessageFormat 1** syntax (static passthrough — no MF runtime in V1; only
  literal `{`/`}` escape). CI parse-tests every string.
- **Uniqueness-first** reconciliation: every existing variant is captured as its own
  field. The V1 identity set keeps **5 distinct bios** (`shortBio`, `socialBio`,
  `longBio`, `site.description`, `flavorBio`) deliberately — merging is a later,
  explicit review, not a default.

## Build & codegen

`packages/copy/scripts/build.ts` (run via `pnpm -F @lifegames/copy build`):

1. **Validate the rich file** against `packages/copy/schema/identity.schema.json`
   (draft-07, `$defs` `CopyString`/`CopyStringList`) with Ajv + `ajv-formats`.
2. **Derive a FLAT schema** by tree-walking the rich schema and replacing only the
   leaf `$ref`s (`CopyString`→`{type:string}`, `CopyStringList`→`{type:array}`),
   preserving every object wrapper, `required`, and `additionalProperties:false`.
3. **Round-trip guard**: the derived flat schema must validate the flat instance, so
   a derivation bug cannot silently drop a `required` field.
4. Generate, **all from the single flat schema** (never the rich one):
   - `dist/identity.flat.json` — flat values (`_meta` stripped)
   - `dist/identity.ts` — flat TS types (`json-schema-to-typescript`)
   - `dist/identity.zod.ts` — flat Zod `identitySchema` (`json-schema-to-zod`)
   - `dist/index.ts` — typed barrel (zero-dep; no Zod import)
   - `Sources/LifegamesCopy/Identity.generated.swift` — `public Sendable` Codable (`quicktype`)
   - `Sources/LifegamesCopy/Resources/identity.en-US.json` — bundled device resource

Build is idempotent (byte-identical re-runs). Generated artifacts are committed and
freshness-gated (`git diff` over `packages/copy/dist` + `Sources/LifegamesCopy`).

## Consumption

| Layer | How |
|---|---|
| **Web** | Astro Content Collection `copy` in `src/content.config.ts` — `file()` loader over `@lifegames/copy/identity.flat.json` (object-map parser: `{ identity: data }`, so Astro uses the key as id and validates the untouched value), `schema: identitySchema` (the generated flat Zod). `Dashboard.astro` reads `getEntry('copy','identity').data`. `astro.config.mjs` imports the flat JSON for the PWA manifest. |
| **iOS** | SPM product `LifegamesCopy` (`design-system-Lifegames`). `CopyLoader.loadIdentity()` (throwing) or `CopyLoader.identity` (non-throwing, for default args). Shown in Settings → About. |
| **Backend** | `import identity from '@lifegames/copy/identity.flat.json'` — esbuild inlines it into the `ComposeLlmContent` Lambda. Drives `profile.ts`, `view.ts` (`EXPERTISE`), and the `llms-txt.eta` blockquote (`siteDescription`). |
| **Design system** | `LifegamesWidgets` `OGImageProps` defaults from `CopyLoader.identity`. |

## Enforcement (highest-tier, not docs)

- **D9 leaf boundary**: `eslint-local-rules/copy-src-no-dependencies.js` forbids
  `packages/copy/src` from importing any `@lifegames/*` or UI framework, so the
  backend Lambda imports copy without pulling in UI/DS code. The schema is a
  build-time devDep importable only from `packages/copy/scripts/`.
- **CI** `copy` job: `build` + `test` (Ajv + ICU MF1 parse + `maxChars` + flat
  round-trip) + `lint`.
- **Freshness** git-diff in `packages/schemas/scripts/check-freshness.sh`.
- **GOVERNANCE P3.1** (`design-system-Lifegames/GOVERNANCE.md`).

## Distribution

Phase 1 yalc (today): `pnpm yalc:publish` from the DS builds + pushes
`@lifegames/copy` to consumers' `.yalc/`. iOS resolves the DS via SPM path/tag.
Backend is a first-time yalc *consumer* (`.yalc/` gitignored; `file:.yalc/...` in
`package.json` is the durable ref — CI parity needs a yalc-setup step, tracked for
follow-up). Phase 2 flips JS consumers to GitHub Packages npm.
