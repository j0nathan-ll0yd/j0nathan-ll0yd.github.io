/**
 * The canonical path of the page being rendered. With build.format 'file' (astro.config.mjs),
 * Astro reports the built file name at build time: `/index.html`, `/about.html`. The site
 * serves those at `/` and `/about`, so canonical URLs, the home-page gate, and the current-page
 * marker all key on the served path, never on the file name.
 */
export function pagePath(pathname: string): string {
  const path = pathname.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1')
  return path === '' ? '/' : path
}
