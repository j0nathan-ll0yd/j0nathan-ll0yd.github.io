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
// V2 RELAXATION. A real llms.txt mixes file lists with descriptive sections.
// The producer contract test found the live index doing exactly that, and v1
// called it broken. v2 relaxes the two section rules and touches nothing else:
//   - llms-txt-non-link-list-item now fires only when a list item carries a
//     BARE URL that is not wrapped as a markdown link. Strip every [text](url)
//     from the line; if an http(s) URL survives, the author meant to link and
//     did not. A descriptive item with no URL ("- Framework: Astro (...)") is
//     legal. This keeps catching unlinked URLs, which is the failure that
//     actually costs an agent a fetch, and stops flagging prose.
//   - llms-txt-h2-no-file-list now fires only on a DANGLING H2: a heading with
//     no list items AND no prose under it, up to the next H2 or end of file. A
//     prose section ("## Expertise" followed by a paragraph) is legal. The id
//     still reads true, it is just narrower: an empty section has no file list
//     and nothing else either, which is an authoring defect rather than a
//     stylistic choice.
// Both relaxations diverge from the llmstxt.org clause the rule files cite.
// That divergence is recorded in each rule's policy_note, not hidden here.
//
// THREE BEHAVIORS PINNED BY ATLAS DECISION 0036, UNCHANGED BY v2. A blind
// regeneration from the rule catalog passed every declared case and still
// diverged from the implementation on these. They are load-bearing:
//   1. With no valid H1 the check returns early and emits ONLY llms-txt-h1.
//      Structure is unrecoverable past that point, so no section rule runs.
//   2. llms-txt-second-h1 is emitted PER offending line, not once per body.
//   3. A bare trailing colon, "- [Name](url):" with nothing after it, PASSES
//      the link-item check. v1 allowed it through LINK_ITEM_RE's optional
//      (:\s*.*)? tail; v2 allows it because stripping the markdown link leaves
//      no URL behind. The behavior is identical, the mechanism is not.

export const LLMS_STRUCTURE_SPEC_VERSION = 2

const H1_RE = /^#\s+\S/
const BLOCKQUOTE_RE = /^>\s+\S/
const H2_RE = /^##\s+(.+?)\s*$/
const LIST_ITEM_RE = /^[-*]\s+/
const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]*\)/g
const BARE_URL_RE = /https?:\/\//

/** True when a list item carries an http(s) URL that is not inside a [text](url) link. */
const hasUnlinkedUrl = (line) => BARE_URL_RE.test(line.replace(MARKDOWN_LINK_RE, ''))

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
    if (LIST_ITEM_RE.test(line) && currentSection && hasUnlinkedUrl(line)) {
      sectionFindings.push({
        id: 'llms-txt-non-link-list-item',
        message: `H2 section "${currentSection.name}" has a list item with a bare URL that is not a ` +
          `"[name](url)" markdown link: ${JSON.stringify(line.trim())}`
      })
    }
  }
  closeSection()

  return [...findings, ...sectionFindings]
}
