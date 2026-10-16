# Composed-dashboard measurement fixture

A focus signal and a composed dashboard artifact for the Step 6.10 measurement of the Worker's serving
path (atlas decision 0160, PR B). The artifact was composed by `dist-composer/composer.mjs`
(`scripts/build-composer.mjs`) from the design system's `ssrKnownAnswer` fixture exports, at
2026-03-18T12:01:00Z. It holds no live data.

A preview Worker reads these two files only for a request that carries `X-SSR-Data-Plane: fixture`,
and only on a `*.workers.dev` or loopback host with `SSR_FAULT_INJECTION=1`
(`src/lib/data-plane/faults.ts` `fixturePlane`). Send `X-SSR-Clock` near the composition time, or the
artifact is past its age window and the Worker serves the data-free page.
