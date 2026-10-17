// The Reading card's article links on the composed page: the owner's choice between option A and
// option B (atlas decision 0160; the owner chose option A on 2026-10-17, web 4.3.0 / DS #312).
//
// - 'allow' (option A): an article title links to its publisher on any https host, in the exact DS
//   shape the Worker admits (./fragment-policy.ts ARTICLE_LINK).
// - 'strip' (option B): the composer renders every article title as text, and the Worker refuses an
//   any-host link, so the host allowlist stays closed. The browser's runtime still adds the links
//   after its first read.
//
// The composer (./reading-links.ts), the Worker's allowlist, the parity oracle and the behavioral
// suite all read this one value. Flipping it is NOT the whole change: the option-A assertions in
// tests/unit/composed-read.test.ts, composed-article-link.test.ts, composed-reading-links.test.ts
// and composed-fragment.property.test.ts, plus the committed tests/fixtures/composed/dashboard.json
// (composed under option A), must follow it (measured 2026-10-17: 45 tests red under 'strip').
// It imports nothing, so a Playwright spec can read it.
export type ReadingLinks = 'allow' | 'strip'

export const READING_LINKS: ReadingLinks = 'allow'
