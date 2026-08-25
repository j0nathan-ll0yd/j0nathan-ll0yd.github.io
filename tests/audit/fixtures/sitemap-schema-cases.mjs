// Known-answer case table for the sitemaps.org 0.9 validator
// (scripts/audit/lib/sitemap-schema.mjs).
//
// Every `valid` flag below is the verdict of REAL `xmllint --noout --schema`
// (libxml 20913) against the vendored XSD for that profile, captured while
// replacing the xmllint shell-out with the in-process validator. They are an
// oracle, not an opinion: tests/audit/validate-sitemap.test.ts asserts the Node
// validator reproduces every one of them, and -- when xmllint happens to be on
// PATH, as it is on macOS dev machines -- re-derives them from xmllint itself so
// a wrong flag cannot silently rot.
//
// Do not "fix" a flag to make a test pass. Run the case through xmllint first.

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const LOC = '<loc>https://example.com/a</loc>'

const urlset = (inner, attrs = '') => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="${NS}"${attrs}>${inner}</urlset>`
const url = (inner) => `<url>${inner}</url>`
const sitemapindex = (inner) => `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="${NS}">${inner}</sitemapindex>`

/** @type {Array<{name: string, xml: string, profile: 'urlset'|'sitemapindex', valid: boolean}>} */
export const SITEMAP_SCHEMA_CASES = [
  // --- structurally valid documents
  {name: 'minimal urlset', xml: urlset(url(LOC)), profile: 'urlset', valid: true},
  {
    name: 'all optional fields in schema order',
    xml: urlset(url(`${LOC}<lastmod>2026-08-25</lastmod><changefreq>daily</changefreq><priority>0.5</priority>`)),
    profile: 'urlset',
    valid: true
  },
  {name: 'two urls', xml: urlset(url(LOC) + url('<loc>https://example.com/b</loc>')), profile: 'urlset', valid: true},
  {
    name: 'every changefreq enumeration value',
    xml: urlset(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'].map((v) => url(`${LOC}<changefreq>${v}</changefreq>`)).join('')),
    profile: 'urlset',
    valid: true
  },
  {
    name: 'whitespace around values is collapsed',
    xml: urlset(url('<loc>  https://example.com/a  </loc><priority> 0.5 </priority>')),
    profile: 'urlset',
    valid: true
  },
  {name: 'comment inside url', xml: urlset(url(`${LOC}<!-- c -->`)), profile: 'urlset', valid: true},
  {name: 'loc via CDATA', xml: urlset(url('<loc><![CDATA[https://example.com/a]]></loc>')), profile: 'urlset', valid: true},
  {name: 'loc with entity reference', xml: urlset(url('<loc>https://example.com/a?x=1&amp;y=2</loc>')), profile: 'urlset', valid: true},
  {name: 'minimal sitemapindex', xml: sitemapindex('<sitemap><loc>https://example.com/s.xml</loc></sitemap>'), profile: 'sitemapindex', valid: true},
  {
    name: 'sitemapindex with lastmod',
    xml: sitemapindex('<sitemap><loc>https://example.com/s.xml</loc><lastmod>2026-01-01</lastmod></sitemap>'),
    profile: 'sitemapindex',
    valid: true
  },

  // --- namespace handling
  {
    name: 'prefixed sitemap namespace throughout',
    xml: `<?xml version="1.0"?><sm:urlset xmlns:sm="${NS}"><sm:url><sm:loc>https://example.com/a</sm:loc></sm:url></sm:urlset>`,
    profile: 'urlset',
    valid: true
  },
  {
    name: 'prefixed root with default-ns children',
    xml: `<?xml version="1.0"?><sm:urlset xmlns:sm="${NS}" xmlns="${NS}"><url><loc>https://example.com/a</loc></url></sm:urlset>`,
    profile: 'urlset',
    valid: true
  },
  {name: 'no namespace at all', xml: '<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url></urlset>', profile: 'urlset', valid: false},
  {
    name: 'wrong namespace',
    xml: '<?xml version="1.0"?><urlset xmlns="urn:wrong"><url><loc>https://example.com/a</loc></url></urlset>',
    profile: 'urlset',
    valid: false
  },
  {name: 'wrong root element for profile', xml: sitemapindex(url(LOC)), profile: 'urlset', valid: false},

  // --- xsd:any namespace="##other" processContents="strict"
  // STRICT: no schema is loaded for the foreign namespace, so every one of
  // these fails -- including the common xhtml/image sitemap extensions.
  {
    name: 'foreign-namespace child after priority',
    xml: urlset(url(`${LOC}<priority>0.5</priority><x:e xmlns:x="urn:x"/>`)),
    profile: 'urlset',
    valid: false
  },
  {name: 'foreign-namespace child before loc', xml: urlset(url(`<x:e xmlns:x="urn:x"/>${LOC}`)), profile: 'urlset', valid: false},
  {name: 'foreign-namespace element at root before entry', xml: urlset(`<x:e xmlns:x="urn:x"/>${url(LOC)}`), profile: 'urlset', valid: false},
  {name: 'foreign-namespace element at root after entry', xml: urlset(`${url(LOC)}<x:e xmlns:x="urn:x"/>`), profile: 'urlset', valid: false},
  {
    name: 'xhtml:link i18n alternate',
    xml: urlset(`<url>${LOC}<xhtml:link xmlns:xhtml="http://www.w3.org/1999/xhtml" rel="alternate" href="https://example.com/de"/></url>`),
    profile: 'urlset',
    valid: false
  },
  {
    name: 'image:image extension',
    xml: urlset(
      `<url>${LOC}<image:image xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><image:loc>https://example.com/i.jpg</image:loc></image:image></url>`
    ),
    profile: 'urlset',
    valid: false
  },

  // --- attributes (the complexTypes declare none; xsi:* is always permitted)
  {
    name: 'xsi:schemaLocation on root',
    xml: urlset(url(LOC),
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${NS} http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd"`),
    profile: 'urlset',
    valid: true
  },
  {name: 'undeclared attribute on url', xml: urlset(`<url foo="1">${LOC}</url>`), profile: 'urlset', valid: false},
  {name: 'undeclared attribute on loc', xml: urlset(url('<loc lang="en">https://example.com/a</loc>')), profile: 'urlset', valid: false},
  {name: 'undeclared attribute on urlset', xml: urlset(url(LOC), ' foo="1"'), profile: 'urlset', valid: false},

  // --- xsd:sequence: order, cardinality, required
  {name: 'missing required loc', xml: urlset(url('<priority>0.5</priority>')), profile: 'urlset', valid: false},
  {name: 'duplicate loc', xml: urlset(url(`${LOC}${LOC}`)), profile: 'urlset', valid: false},
  {name: 'duplicate priority', xml: urlset(url(`${LOC}<priority>0.5</priority><priority>0.6</priority>`)), profile: 'urlset', valid: false},
  {name: 'priority before loc (out of sequence)', xml: urlset(url(`<priority>0.5</priority>${LOC}`)), profile: 'urlset', valid: false},
  {
    name: 'changefreq before lastmod (out of sequence)',
    xml: urlset(url(`${LOC}<changefreq>daily</changefreq><lastmod>2026-01-01</lastmod>`)),
    profile: 'urlset',
    valid: false
  },
  {name: 'unknown same-namespace child', xml: urlset(url(`${LOC}<bogus>x</bogus>`)), profile: 'urlset', valid: false},
  {name: 'empty urlset (minOccurs 1)', xml: urlset(''), profile: 'urlset', valid: false},
  {name: 'loc containing a child element', xml: urlset(url('<loc><a/></loc>')), profile: 'urlset', valid: false},
  {name: 'character content inside url', xml: urlset(url(`junk${LOC}`)), profile: 'urlset', valid: false},
  {name: 'character content inside urlset', xml: urlset(`junk${url(LOC)}`), profile: 'urlset', valid: false},
  {name: 'malformed xml', xml: '<?xml version="1.0"?><urlset><url><loc>x</loc></urlset>', profile: 'urlset', valid: false},
  {name: 'empty sitemapindex', xml: sitemapindex(''), profile: 'sitemapindex', valid: false},
  {name: 'sitemapindex missing loc', xml: sitemapindex('<sitemap><lastmod>2026-01-01</lastmod></sitemap>'), profile: 'sitemapindex', valid: false},
  {
    name: 'sitemapindex rejects changefreq (not in tSitemap)',
    xml: sitemapindex('<sitemap><loc>https://example.com/s.xml</loc><changefreq>daily</changefreq></sitemap>'),
    profile: 'sitemapindex',
    valid: false
  },
  {name: 'sitemapindex containing url instead of sitemap', xml: sitemapindex(url(LOC)), profile: 'sitemapindex', valid: false},

  // --- tLoc: xsd:anyURI minLength 12 / maxLength 2048
  {name: 'loc exactly 12 characters', xml: urlset(url(`<loc>${'a'.repeat(12)}</loc>`)), profile: 'urlset', valid: true},
  {name: 'loc 11 characters (under minLength)', xml: urlset(url(`<loc>${'a'.repeat(11)}</loc>`)), profile: 'urlset', valid: false},
  {name: 'loc exactly 2048 characters', xml: urlset(url(`<loc>${'a'.repeat(2048)}</loc>`)), profile: 'urlset', valid: true},
  {name: 'loc 2049 characters (over maxLength)', xml: urlset(url(`<loc>${'a'.repeat(2049)}</loc>`)), profile: 'urlset', valid: false},
  {name: 'loc empty', xml: urlset(url('<loc></loc>')), profile: 'urlset', valid: false},

  // --- tPriority: xsd:decimal in [0.0, 1.0]
  {name: 'priority 0.0', xml: urlset(url(`${LOC}<priority>0.0</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority 1.0', xml: urlset(url(`${LOC}<priority>1.0</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority 1 (integer form)', xml: urlset(url(`${LOC}<priority>1</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority 0 (integer form)', xml: urlset(url(`${LOC}<priority>0</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority .5 (no leading digit)', xml: urlset(url(`${LOC}<priority>.5</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority 0. (trailing point)', xml: urlset(url(`${LOC}<priority>0.</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority +0.5', xml: urlset(url(`${LOC}<priority>+0.5</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority -0.0', xml: urlset(url(`${LOC}<priority>-0.0</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority 1.00000', xml: urlset(url(`${LOC}<priority>1.00000</priority>`)), profile: 'urlset', valid: true},
  {name: 'priority 5.0 (over maxInclusive)', xml: urlset(url(`${LOC}<priority>5.0</priority>`)), profile: 'urlset', valid: false},
  {name: 'priority 1.1 (over maxInclusive)', xml: urlset(url(`${LOC}<priority>1.1</priority>`)), profile: 'urlset', valid: false},
  {name: 'priority -0.1 (under minInclusive)', xml: urlset(url(`${LOC}<priority>-0.1</priority>`)), profile: 'urlset', valid: false},
  {name: 'priority 1e-1 (xsd:decimal forbids exponents)', xml: urlset(url(`${LOC}<priority>1e-1</priority>`)), profile: 'urlset', valid: false},
  {name: 'priority INF (xsd:decimal forbids INF)', xml: urlset(url(`${LOC}<priority>INF</priority>`)), profile: 'urlset', valid: false},
  {name: 'priority non-numeric', xml: urlset(url(`${LOC}<priority>high</priority>`)), profile: 'urlset', valid: false},
  {name: 'priority empty', xml: urlset(url(`${LOC}<priority></priority>`)), profile: 'urlset', valid: false},

  // --- tLastmod: xsd:union of xsd:date and xsd:dateTime
  {name: 'lastmod date', xml: urlset(url(`${LOC}<lastmod>2026-08-25</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod date with timezone', xml: urlset(url(`${LOC}<lastmod>2026-01-01Z</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod dateTime with offset', xml: urlset(url(`${LOC}<lastmod>2005-05-10T17:33:30+08:00</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod dateTime UTC', xml: urlset(url(`${LOC}<lastmod>2005-05-10T17:33:30Z</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod dateTime fractional seconds', xml: urlset(url(`${LOC}<lastmod>2005-05-10T17:33:30.123Z</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod 24:00:00 (end of day)', xml: urlset(url(`${LOC}<lastmod>2026-01-01T24:00:00Z</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod 24:00:01', xml: urlset(url(`${LOC}<lastmod>2026-01-01T24:00:01Z</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod timezone +14:00', xml: urlset(url(`${LOC}<lastmod>2026-01-01T00:00:00+14:00</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod timezone -14:00', xml: urlset(url(`${LOC}<lastmod>2026-01-01T00:00:00-14:00</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod timezone +14:01 (out of range)', xml: urlset(url(`${LOC}<lastmod>2026-01-01T00:00:00+14:01</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod hour 25', xml: urlset(url(`${LOC}<lastmod>2026-01-01T25:00:00Z</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod leap day 2024-02-29', xml: urlset(url(`${LOC}<lastmod>2024-02-29</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod leap day 2000-02-29 (400-year rule)', xml: urlset(url(`${LOC}<lastmod>2000-02-29</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod 1900-02-29 (century non-leap)', xml: urlset(url(`${LOC}<lastmod>1900-02-29</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod 2023-02-29 (non-leap year)', xml: urlset(url(`${LOC}<lastmod>2023-02-29</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod 2026-02-30', xml: urlset(url(`${LOC}<lastmod>2026-02-30</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod month 13', xml: urlset(url(`${LOC}<lastmod>2026-13-01</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod year 0000', xml: urlset(url(`${LOC}<lastmod>0000-01-01</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod negative year', xml: urlset(url(`${LOC}<lastmod>-0500-01-01</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod 5-digit year', xml: urlset(url(`${LOC}<lastmod>12026-01-01</lastmod>`)), profile: 'urlset', valid: true},
  {name: 'lastmod 3-digit year', xml: urlset(url(`${LOC}<lastmod>926-01-01</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod slash-separated', xml: urlset(url(`${LOC}<lastmod>2026/01/01</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod dateTime without seconds', xml: urlset(url(`${LOC}<lastmod>2026-01-01T00:00</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod non-date text', xml: urlset(url(`${LOC}<lastmod>not-a-date</lastmod>`)), profile: 'urlset', valid: false},
  {name: 'lastmod empty', xml: urlset(url(`${LOC}<lastmod></lastmod>`)), profile: 'urlset', valid: false}
]
