// The Reading card's article links on the composed page: the owner's choice between option A and
// option B (atlas decision 0160; OWNER DECISION PENDING, web 4.3.0 / DS #312).
//
// - 'allow' (option A): an article title links to its publisher on any https host, in the exact DS
//   shape the Worker admits (./fragment-policy.ts ARTICLE_LINK).
// - 'strip' (option B): the composer renders every article title as text, and the Worker refuses an
//   any-host link, so the host allowlist stays closed. The browser's runtime still adds the links
//   after its first read.
//
// The composer (./reading-links.ts), the Worker's allowlist, the parity oracle and the behavioral
// suite all read this one value: flipping it is the whole change. It imports nothing, so a
// Playwright spec can read it.
export type ReadingLinks = 'allow' | 'strip'

export const READING_LINKS: ReadingLinks = 'allow'
