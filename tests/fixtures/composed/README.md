# Composed-dashboard measurement fixture

A focus signal and a composed dashboard artifact for the Step 6.10 measurement of the Worker's serving
path (atlas decision 0160, PR B), and since atlas decision 0164 the same composition as KV values. The artifact was composed by `dist-composer/composer.mjs`
(`scripts/build-composer.mjs`) from the design system's `ssrKnownAnswer` fixture exports, at
2026-03-18T12:01:00Z. It holds no live data. Regenerate every file with
`node scripts/build-composer.mjs && node tests/fixtures/composed/generate.mjs` after any change to the
composer or its fragment ids.

Since atlas decision 0164 the artifact also carries `facts`, and the generator writes the same
composition as the two Workers KV values the backend publishes (`src/lib/composed/published.ts`):
`kv-fragments.json` (the `fragments:<build>` value, byte for byte, through the composer's
`publishedEntry`), `kv-fragments.metadata.json` (its metadata) and `kv-focus.json` (the `focus`
value). All three name the build `fixture` and the composition time.

A preview Worker reads `focus.json` and `dashboard.json` only for a request that carries `X-SSR-Data-Plane: fixture`,
and only on a `*.workers.dev` or loopback host with `SSR_FAULT_INJECTION=1`
(`src/lib/data-plane/faults.ts` `fixturePlane`). Send `X-SSR-Clock` near the composition time, or the
artifact is past its age window and the Worker serves the data-free page.
