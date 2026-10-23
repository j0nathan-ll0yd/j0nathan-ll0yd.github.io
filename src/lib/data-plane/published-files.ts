// The files of a fixture data plane that stand for the published KV values (atlas decision 0164):
// read by the Worker's test seam (./published-seam.ts), written by tests/fixtures/composed/generate.mjs
// and served by tests/data-plane/server.ts. This module imports nothing, so the Playwright suites
// and the data plane read it directly.
export const PUBLISHED_FILES = Object.freeze({focus: '/kv-focus.json', fragments: '/kv-fragments.json', metadata: '/kv-fragments.metadata.json'})
