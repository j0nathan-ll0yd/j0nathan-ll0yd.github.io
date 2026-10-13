// The `_redirects` file for the Workers static-asset plane (atlas decision 0160, PR A).
//
// Pages answered every non-canonical form of a page with a 308 to its canonical URL: `/x.html` and
// `/x/` to `/x`, `/index.html` to `/`. Workers `html_handling` answers the same forms with a 307.
// A 307 is temporary, so a crawler would keep the old URL; PR A changes no status. One static
// `_redirects` rule per form keeps the 308; a `_redirects` rule runs before `html_handling`.
// The query string carries over, as it did on Pages.
//
// Residual: a path with a doubled slash (`/privacy//`) still meets the 307, because a static rule
// cannot name every slash count. The canonical-URL gate links to no such path.

/**
 * @param {string[]} htmlFiles the built HTML files, relative to the client directory, `/`-separated
 * @returns {string} the `_redirects` file
 */
export function renderRedirectsFile(htmlFiles) {
  const lines = []
  for (const file of [...htmlFiles].sort()) {
    if (file === 'index.html') {
      lines.push('/index.html / 308')
      continue
    }
    if (file.endsWith('/index.html')) {
      throw new Error(
        `${file}: a directory index is served only at its slash URL; build.format 'file' must emit x.html (tests/build/canonical-urls.test.ts)`
      )
    }
    const canonical = '/' + file.slice(0, -'.html'.length)
    lines.push(`/${file} ${canonical} 308`, `${canonical}/ ${canonical} 308`)
  }
  return lines.join('\n') + '\n'
}
