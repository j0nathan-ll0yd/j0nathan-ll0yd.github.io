// Shared llms-structure reference, byte-pinned across Atlas, LP, and the site.
// Keep this dependency-free because both Node audit scripts and Mantle code import it.
// Consumers own severity, provenance, and live-HTTP checks.
//
// Atlas decision 0036 and the conformance vectors record the rule history. Three behaviors
// are intentional: an invalid H1 stops later checks, each extra H1 emits a finding, and a
// linked list item with only a trailing colon remains valid.

export const LLMS_STRUCTURE_SPEC_VERSION = 3

const H1_RE = /^#\s+\S/
const BLOCKQUOTE_RE = /^>\s+\S/
const H2_RE = /^##\s+(.+?)\s*$/
const LIST_ITEM_RE = /^[-*]\s+/
// A WELL-FORMED markdown link needs a nonempty label AND a nonempty destination.
// v2 used `[^\]]*`/`[^)]*` (both optional), so `[](url)` and `[name]()` passed as
// links: the first hid an unlinked URL, the second was a broken link with no
// destination. v3 requires `+` on both sides, so only a real link is stripped as one.
const MARKDOWN_LINK_RE = /\[[^\]]+\]\([^)]+\)/g
// Any `[..](..)` shape, empty parts included — used to catch the two malformed cases.
const ANY_LINK_SHAPE_RE = /\[[^\]]*\]\([^)]*\)/g
const WELL_FORMED_LINK_RE = /^\[[^\]]+\]\([^)]+\)$/
const BARE_URL_RE = /https?:\/\//

/** True when a list item carries an http(s) URL that is not inside a well-formed [text](url) link. */
const hasUnlinkedUrl = (line) => BARE_URL_RE.test(line.replace(MARKDOWN_LINK_RE, ''))

/** True when a list item carries a `[..](..)` shape with an empty label or empty destination. */
const hasMalformedLink = (line) => (line.match(ANY_LINK_SHAPE_RE) ?? []).some((shape) => !WELL_FORMED_LINK_RE.test(shape))

/**
 * Check the structure of an llms.txt body against the llmstxt.org convention.
 *
 * Pure: string in, findings out. Findings carry no severity -- the consumer's
 * rule catalog stamps that. Order is stable: the H1 and blockquote findings
 * first, then the section findings in document order.
 *
 * @param {string} rawText raw llms.txt contents, BOM allowed
 * @returns {Array<{id: string, message: string}>} structural findings, empty if conformant
 */
export function checkLlmsStructure(rawText) {
  const findings = []
  let text = rawText

  // 1. Optional BOM.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
  }

  const lines = text.split(/\r\n|\r|\n/)
  let i = 0
  const nextNonBlank = () => {
    while (i < lines.length && lines[i].trim() === '') {
      i++
    }
    return i < lines.length ? lines[i] : null
  }

  // 2. First non-blank line MUST be an H1.
  const h1Line = nextNonBlank()
  if (h1Line === null || !H1_RE.test(h1Line)) {
    findings.push({id: 'llms-txt-h1', message: `first non-blank line must be "# <title>"; got ${JSON.stringify(h1Line)}`})
    return findings // behavior 1: structure is unrecoverable past this point
  }
  i++

  // 3. Next non-blank line MUST be a blockquote. Each consumer's own
  // llms-txt-blockquote rule records why this is treated as required even
  // though the convention's prose marks only the H1 as strictly required.
  const bqLine = nextNonBlank()
  if (bqLine === null || !BLOCKQUOTE_RE.test(bqLine)) {
    findings.push({id: 'llms-txt-blockquote', message: `expected a "> summary" blockquote immediately after the H1; got ${JSON.stringify(bqLine)}`})
  } else {
    i++
  }

  // 4/5. Walk remaining lines. Before the first H2: anything except another
  // H1 is fine (free-form body). From the first H2 onward: every H2 section's
  // list items must be markdown links.
  let sawH2 = false
  let currentSection = null // { name, hasContent }
  const sectionFindings = []

  // v2: fires only on a DANGLING heading -- nothing at all under it. A section
  // holding prose, a sub-heading, or a list is content-bearing and legal.
  const closeSection = () => {
    if (currentSection && !currentSection.hasContent) {
      sectionFindings.push({
        id: 'llms-txt-h2-no-file-list',
        message: `H2 section "${currentSection.name}" is empty -- no file list and no prose before the next H2 or end of file`
      })
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const h2Match = H2_RE.exec(line)
    if (h2Match) {
      closeSection()
      sawH2 = true
      currentSection = {name: h2Match[1], hasContent: false}
      continue
    }
    if (currentSection && line.trim() !== '') {
      currentSection.hasContent = true
    }
    if (H1_RE.test(line)) {
      // behavior 2: one finding per offending line, not one per body.
      sectionFindings.push({id: 'llms-txt-second-h1', message: `unexpected second H1 at "${line}" -- only one H1 is allowed`})
      continue
    }
    if (!sawH2) {
      continue // free-form pre-H2 body: anything but headings is spec-legal
    }
    // v2: a descriptive item with no URL is legal; an unlinked URL is not.
    // behavior 3 falls out of this: "- [Name](url):" strips to "- :", no URL.
    // v3: a malformed link — empty label "[](url)" or empty destination "[name]()"
    // — is flagged too: the first hides an unlinked URL, the second is a broken link.
    if (LIST_ITEM_RE.test(line) && currentSection && (hasUnlinkedUrl(line) || hasMalformedLink(line))) {
      sectionFindings.push({
        id: 'llms-txt-non-link-list-item',
        message: `H2 section "${currentSection.name}" has a list item that is not a well-formed ` +
          `"[name](url)" markdown link (bare, empty-label, or empty-destination URL): ${JSON.stringify(line.trim())}`
      })
    }
  }
  closeSection()

  return [...findings, ...sectionFindings]
}
