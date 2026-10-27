// The Bookshelf tile link's href, for the Playwright suites. The Playwright runner loads test files
// with Node's type stripping, which refuses `.ts` under node_modules, so these suites cannot import
// the design system's `amazonBookUrl` (`@j0nathan-ll0yd/web/runtime/adapters`). This copy is
// tethered to it: tests/unit/composed-book-link.test.ts fails when the two disagree.

/** The href Bookshelf.astro writes for `asin` (DS `amazonBookUrl`). */
export function bookUrl(asin: string): string {
  return `https://www.amazon.com/dp/${encodeURIComponent(asin)}?tag=lifegames04-20&linkCode=ll2&language=en_US&ref_=as_li_ss_tl`
}
