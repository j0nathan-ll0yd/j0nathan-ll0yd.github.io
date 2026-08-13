// Canonical source: atlas/contracts/llms-structure/reference.mjs. Vendored copy,
// pinned by sha256. Edit the atlas canonical, then re-vendor.
//
// The five STRUCTURAL rules of the llms.txt convention (llmstxt.org), as one
// pure function shared by every repo that checks them. The producer
// (mantle-LifegamesPortal, the llm-content capability) and the consumer (this
// site's audit validator) vendor the same bytes, so a file that passes on one
// side cannot fail on the other for a reason neither can see.
//
// FRAMEWORK-FREE ON PURPOSE. No imports, no network, no severity, plain ES
// modules. It must import cleanly into a web .mjs script and a mantle-LP
// TypeScript context alike. Severity, provenance, and the spec citations stay
// in each consumer's own rule catalog, which wraps these findings.
//
// SCOPE. Structural rules only. The operational rules (fetch, freshness,
// llms-full.txt and index.md presence) depend on a live HTTP response and stay
// with each consumer.
//
// THREE BEHAVIORS PINNED BY ATLAS DECISION 0036. A blind regeneration from the
// rule catalog passed every declared case and still diverged from the
// implementation on these. They are load-bearing, not incidental:
//   1. With no valid H1 the check returns early and emits ONLY llms-txt-h1.
//      Structure is unrecoverable past that point, so no section rule runs.
//   2. llms-txt-second-h1 is emitted PER offending line, not once per body.
//   3. A bare trailing colon, "- [Name](url):" with nothing after it, PASSES
//      the link-item check. LINK_ITEM_RE's tail is (:\s*.*)?$ and the notes are
//      optional. Recorded as the implementation's behavior, not endorsed;
//      tightening it is a candidate change that moves both sides at once.

export const LLMS_STRUCTURE_SPEC_VERSION = 1

const H1_RE = /^#\s+\S/
const BLOCKQUOTE_RE = /^>\s+\S/
const H2_RE = /^##\s+(.+?)\s*$/
const LIST_ITEM_RE = /^[-*]\s+/
const LINK_ITEM_RE = /^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(:\s*.*)?$/

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
  let currentSection = null // { name, hasListItem }
  const sectionFindings = []

  const closeSection = () => {
    if (currentSection && !currentSection.hasListItem) {
      sectionFindings.push({
        id: 'llms-txt-h2-no-file-list',
        message: `H2 section "${currentSection.name}" has no [name](url) file-list items` + ' (llmstxt.org: H2 sections are "file lists" of links)'
      })
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const h2Match = H2_RE.exec(line)
    if (h2Match) {
      closeSection()
      sawH2 = true
      currentSection = {name: h2Match[1], hasListItem: false}
      continue
    }
    if (H1_RE.test(line)) {
      // behavior 2: one finding per offending line, not one per body.
      sectionFindings.push({id: 'llms-txt-second-h1', message: `unexpected second H1 at "${line}" -- only one H1 is allowed`})
      continue
    }
    if (!sawH2) {
      continue // free-form pre-H2 body: anything but headings is spec-legal
    }
    if (LIST_ITEM_RE.test(line) && currentSection) {
      currentSection.hasListItem = true
      // behavior 3: LINK_ITEM_RE's optional (:\s*.*)? tail accepts a bare colon.
      if (!LINK_ITEM_RE.test(line)) {
        sectionFindings.push({
          id: 'llms-txt-non-link-list-item',
          message: `H2 section "${currentSection.name}" has a list item that is not a ` +
            `"[name](url)" or "[name](url): notes" markdown link: ${JSON.stringify(line.trim())}`
        })
      }
    }
  }
  closeSection()

  return [...findings, ...sectionFindings]
}
