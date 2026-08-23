// Canonical portable covers rule; Atlas is the source and consumers vendor byte-identical copies.
// It requires line-leading test tethers for spec requirements and rejects orphan or near-miss
// tethers. Framework-free language data covers TypeScript, HCL, and Swift; repository policy
// stays with each consumer.

import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'

/**
 * The version of the RULE this file implements, and of the `Finding` shape it returns.
 *
 * Bumping it means: edit this file, regenerate `reference.mjs.sha256`, regenerate
 * `covers-conformance.json` and its sidecar, and re-vendor every consumer in ONE pull request (the
 * `0027` same-PR discipline). A vendored copy that lags is a rule the estate has already moved past.
 *
 * Version 4: ONE NEW RULE — `requirement-without-scenario`. Every `### Requirement:` must carry at
 * least one `#### Scenario:`. This was the ONLY check the vendor validator enforced that this engine
 * did not, so the property held solely in the two repos that ran `openspec validate` (mantle,
 * ios-LifegamesPortal) and was UNGATED across the other 105 of the estate's 134 requirements. Moving
 * it here makes it run wherever the contract runs. A requirement under a `## REMOVED Requirements`
 * section is exempt — measured against `@fission-ai/openspec@1.4.1`, which ERRORs on a bare base,
 * `ADDED` or `MODIFIED` requirement and validates a bare `REMOVED` one clean. See decision `0074`.
 *
 * Version 3: CONFORMANCE HARDENING, plus one dead-code removal. No rule behavior changes and the
 * `Finding` shape is unchanged. An adversarial mutant hunt (49 source mutations) found 20 correct
 * behaviors that no vector could distinguish from their mutants, so the corpus grew from 25 vectors
 * to 37 to pin them. The number moves anyway, because the fixture a consumer vendors is now a
 * different artifact and its `specVersion` must agree with this constant. See decision `0045`.
 *
 * Version 2: the walker FAILS CLOSED on a symlinked directory (see `walkDirectory`). Version 1
 * claimed to reproduce `glob`'s `follow: false` by skipping one; measured against `glob@13.0.6`
 * that was wrong — `glob` RETURNS a spec behind a symlinked directory — so a silent skip could
 * report zero findings over a tree mantle used to check. The `Finding` shape is unchanged.
 */
export const COVERS_SPEC_VERSION = 4

/**
 * The CLOSED set of `Finding.type` values at spec version 4. Exported so a consumer can assert it
 * handles every one — a new type is a rule change and needs a `COVERS_SPEC_VERSION` bump.
 */
export const COVERS_FINDING_TYPES = Object.freeze([
  'uncovered-requirement',
  'stale-reference',
  'covers-near-miss',
  'unresolved-verified-by',
  'citation-missing-line',
  'unlabeled-multi-citation',
  'scenario-gwt-structure',
  'requirement-without-scenario',
  'delta-base-missing',
  'removed-requirement-migration',
  'duplicate-requirement-name'
])

/**
 * Markers for the generated inventory region, INLINED from mantle's `inventory-generator.ts` so
 * this file imports nothing outside `node:*`. mantle's stray-count plugin reads them from here.
 */
export const INVENTORY_BEGIN_MARKER = '<!-- BEGIN generated:inventory -->'
export const INVENTORY_END_MARKER = '<!-- END generated:inventory -->'

/** Strict line-leading covers annotation for `//`-comment languages: TypeScript, JavaScript, Swift. */
export const STRICT_TS_COVERS = /^\s*\/\/\s*covers:\s*([^#\s]+)#(.+)$/

/** Strict line-leading covers annotation for `#`-comment languages: HCL. */
export const STRICT_HCL_COVERS = /^\s*#\s*covers:\s*([^#\s]+)#(.+)$/

/**
 * The three languages the estate speaks today. A language is data, not a branch.
 *
 *   - `id`           stable identifier, surfaced on findings when `annotateLanguage` is on
 *   - `glob`         which test files to scan, relative to `cwd`
 *   - `commentRegex` the strict line-leading annotation pattern; capture 1 = capability, 2 = name
 *   - `nearMiss`     whether to run near-miss detection over this language's test files
 *
 * `nearMiss: false` on HCL is NOT an oversight. mantle ran near-miss detection over spec files and
 * TypeScript test files and not over `*.tftest.hcl` (`openspec-checker.ts:820` vs `:824`), so
 * turning it on here would emit findings mantle never emitted and break the extraction's
 * outcome-identity. Flipping it is a rule change: bump `COVERS_SPEC_VERSION`.
 *
 * Language globs MUST be disjoint. A file matched by two entries is scanned twice and counted twice.
 */
export const DEFAULT_LANGUAGES = Object.freeze([
  Object.freeze({id: 'ts', glob: '**/*.test.ts', commentRegex: STRICT_TS_COVERS, nearMiss: true}),
  Object.freeze({id: 'hcl', glob: '**/*.tftest.hcl', commentRegex: STRICT_HCL_COVERS, nearMiss: false}),
  Object.freeze({id: 'swift', glob: '**/*Tests.swift', commentRegex: STRICT_TS_COVERS, nearMiss: true})
])

/** The four scan signatures, spelled exactly as mantle's four `glob.sync` call sites spelled them. */
export const DEFAULT_SPEC_GLOB = 'openspec/specs/**/spec.md'
export const DEFAULT_SPEC_IGNORE = Object.freeze(['**/node_modules/**'])
export const DEFAULT_DELTA_GLOB = 'openspec/changes/**/specs/**/spec.md'
export const DEFAULT_DELTA_IGNORE = Object.freeze(['**/node_modules/**', '**/archive/**'])
export const DEFAULT_TEST_IGNORE = Object.freeze(['**/node_modules/**', '**/dist/**', '**/.turbo/**'])

// ---------------------------------------------------------------------------------------------
// The walker. Replaces `glob`, which was this engine's only third-party dependency.
// ---------------------------------------------------------------------------------------------

/** A `**` segment: matches ZERO or more path segments. Everything else matches exactly one. */
const GLOBSTAR = Symbol('globstar')

const REGEXP_SPECIALS = /[.+^${}()|[\]\\]/g

/** Compile one path segment of a glob into an anchored RegExp. `*` and `?` never cross a `/`. */
function segmentRegExp(segment) {
  let source = ''
  for (const char of segment) {
    if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(REGEXP_SPECIALS, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/** Compile a whole glob into an array of segment matchers. */
function compilePattern(pattern) {
  return pattern.split('/').map((segment) => segment === '**' ? GLOBSTAR : {dotOk: segment.startsWith('.'), regexp: segmentRegExp(segment)})
}

/**
 * glob's default `dot: false`: a leading-dot entry is invisible to `*` and `**`. A pattern segment
 * that literally starts with `.` can still name one, which is why `.turbo` in an ignore list works.
 */
function segmentMatches(segment, name) {
  if (name.startsWith('.') && !segment.dotOk) {
    return false
  }
  return segment.regexp.test(name)
}

/** Every position reachable WITHOUT consuming a path segment — a `**` may match zero segments. */
function closure(segments, states) {
  const reachable = new Set()
  const visit = (index) => {
    if (reachable.has(index)) {
      return
    }
    reachable.add(index)
    if (segments[index] === GLOBSTAR) {
      visit(index + 1)
    }
  }
  for (const index of states) {
    visit(index)
  }
  return reachable
}

/** Advance the state set by one path segment named `name`. */
function step(segments, states, name) {
  const next = new Set()
  for (const index of closure(segments, states)) {
    if (index >= segments.length) {
      continue
    }
    if (segments[index] === GLOBSTAR) {
      // A `**` consumes this segment and stays put. Dot entries stay invisible to it.
      if (!name.startsWith('.')) {
        next.add(index)
      }
    } else if (segmentMatches(segments[index], name)) {
      next.add(index + 1)
    }
  }
  return next
}

/**
 * Does `relPath` match `pattern`? Path separators are `/` on every platform.
 *
 * @param {string} pattern a glob: literal segments, `*`, `?`, and `**`
 * @param {string} relPath a `/`-separated path relative to the scan root
 * @returns {boolean}
 */
export function matchGlob(pattern, relPath) {
  const segments = compilePattern(pattern)
  let states = new Set([0])
  for (const name of relPath.split('/')) {
    states = step(segments, states, name)
    if (states.size === 0) {
      return false
    }
  }
  return closure(segments, states).has(segments.length)
}

function isIgnored(relPath, compiledIgnores) {
  for (const segments of compiledIgnores) {
    let states = new Set([0])
    for (const name of relPath.split('/')) {
      states = step(segments, states, name)
      if (states.size === 0) {
        break
      }
    }
    if (states.size > 0 && closure(segments, states).has(segments.length)) {
      return true
    }
  }
  return false
}

/**
 * Does this entry point at a DIRECTORY? A `Dirent` reflects `lstat`, so a symlink reports
 * `isDirectory() === false` whatever it points at. This is the one place the walker follows one.
 *
 * A dangling symlink resolves to nothing and is therefore not a directory: it falls through to the
 * file branch and can be returned as a match, which is what `glob` does with one too.
 */
function pointsAtDirectory(absolutePath) {
  return statSync(absolutePath, {throwIfNoEntry: false})?.isDirectory() === true
}

function walkDirectory(cwd, relDir, states, segments, compiledIgnores, results) {
  let entries
  try {
    entries = readdirSync(relDir === '' ? cwd : join(cwd, relDir), {withFileTypes: true})
  } catch {
    // An unreadable directory yields nothing. A scan is not a permissions audit.
    return
  }
  // Sort the DIRECTORY ENTRIES, not just the results. The final `results.sort()` in `globSync`
  // already makes the returned LIST deterministic, so this line looks redundant and is not: it makes
  // the WALK ORDER deterministic, and two behaviors read the walk order rather than the result list.
  //
  //   1. The fail-closed throw below names the FIRST offending symlinked directory. A tree holding
  //      two of them would otherwise name whichever one `readdir` happened to yield first.
  //   2. The `glob-results-are-sorted-not-walk-ordered` vector proves `results.sort()` is load-bearing
  //      by requiring the walk order to DIFFER from the sorted order. Without this line that proof
  //      depends on the filesystem: APFS returns entries already sorted (measured: 0 deviations in
  //      200 trials of 40 names), ext4 returns them in hash order. Enumerating all 24 orderings of
  //      that vector's four top-level entries, exactly ONE hides a dropped `results.sort()`. This
  //      line takes that 1-in-24 off the table on every filesystem.
  //
  // Spec version 3 considered removing it as redundant and measured the above instead. It is cheap:
  // one comparison per directory entry, on a walk that already stats and reads every one of them.
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  for (const entry of entries) {
    const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`
    // A trailing `**` matches zero segments, so `**/node_modules/**` matches the DIRECTORY
    // `a/node_modules` itself. One test therefore both filters files and prunes subtrees.
    if (isIgnored(relPath, compiledIgnores)) {
      continue
    }
    const next = step(segments, states, entry.name)
    if (next.size === 0) {
      continue
    }
    const reachable = closure(segments, next)

    /**
     * Refuses reachable symlinked directories because following or skipping them silently changes the
     * scanned tree. Ignored symlink paths remain skippable; other symlinked directories fail closed
     * before descent.
     */
    if (entry.isSymbolicLink() && pointsAtDirectory(join(cwd, relPath))) {
      throw new Error(
        `openspec-covers: refusing to scan symlinked directory ${relPath} — resolve or remove the symlink, or add it to specIgnore/testIgnore to skip it deliberately`
      )
    }

    if (entry.isDirectory()) {
      // Descend only while some pattern position is still unconsumed. A state set holding nothing
      // but the end position means no deeper path can match.
      const canMatchDeeper = [...reachable].some((index) => index < segments.length)
      if (canMatchDeeper) {
        walkDirectory(cwd, relPath, next, segments, compiledIgnores, results)
      }
    } else if (reachable.has(segments.length)) {
      results.push(relPath)
    }
  }
}

/**
 * Synchronous glob over a directory tree, using `node:fs` only.
 *
 * TWO DELIBERATE DIVERGENCES FROM `glob`, both of them narrower than what they replace:
 *
 *   1. Results are SORTED. `glob` returns them in readdir order, which is filesystem-dependent, so
 *      the finding order of the engine this replaces was never defined. Sorting makes a report
 *      reproducible across machines.
 *   2. A symlinked DIRECTORY inside the scanned tree THROWS rather than being skipped or followed
 *      (spec version 2). `glob` returns what is behind one; a silent skip would report zero
 *      findings over a tree it never opened.
 *
 * Everything else — `**` spanning zero or more segments, `dot: false`, symlinked FILES matching,
 * ignore patterns filtering results and pruning subtrees — reproduces `glob`'s defaults as this
 * engine used them.
 *
 * @param {string} pattern glob relative to `cwd`
 * @param {{cwd: string, ignore?: readonly string[]}} options
 * @returns {string[]} matching paths relative to `cwd`, `/`-separated, sorted
 * @throws {Error} on a reachable, non-ignored symlinked directory
 */
export function globSync(pattern, {cwd, ignore = []} = {}) {
  const segments = compilePattern(pattern)
  const compiledIgnores = ignore.map(compilePattern)
  const results = []
  walkDirectory(cwd, '', new Set([0]), segments, compiledIgnores, results)
  return results.sort()
}

// ---------------------------------------------------------------------------------------------
// Parsers. Ported from openspec-checker.ts with no behavior change.
// ---------------------------------------------------------------------------------------------

/** The capability a spec belongs to: the name of the directory holding `spec.md`. */
function capabilityOf(relPath) {
  return relPath.split('/').at(-2)
}

/**
 * Extract all `### Requirement: <name>` headers from spec content.
 *
 * @param {string} content raw spec.md text
 * @param {string} specFile path relative to the scan root, for finding messages
 * @param {string} capability capability directory name
 * @returns {Array<{capability: string, requirementName: string, specFile: string, line: number}>}
 */
export function parseRequirements(content, specFile, capability) {
  const requirements = []
  const lines = content.split('\n')
  for (const [index, line] of lines.entries()) {
    const match = /^### Requirement:\s*(.+)$/.exec(line)
    if (match) {
      requirements.push({capability, requirementName: match[1].trim(), specFile, line: index + 1})
    }
  }
  return requirements
}

/**
 * Extract every strict line-leading covers annotation from a test file.
 *
 * The annotation must be a dedicated line comment; it may be indented. The segment before `#` is
 * the capability directory name under the spec root, the segment after `#` is the requirement name
 * verbatim from its `### Requirement:` header, trimmed. The format is grep-parseable and
 * independent of any test framework's API.
 *
 * Example: `// covers: bookshelf#Load the bookshelf from GET /books on appear`
 *
 * @param {string} content raw test file text
 * @param {string} testFile path relative to the scan root
 * @param {RegExp} commentRegex a language's strict pattern; capture 1 = capability, 2 = name
 * @param {string|null} language language id recorded on each annotation
 */
export function parseCoversAnnotationsWith(content, testFile, commentRegex, language = null) {
  const annotations = []
  const lines = content.split('\n')
  for (const [index, line] of lines.entries()) {
    const match = commentRegex.exec(line)
    if (match) {
      // `match[2]` IS trimmed: the name capture is `(.+)`, which holds trailing whitespace. `match[1]`
      // is NOT: every language's capability capture is `([^#\s]+)`, which cannot hold any.
      annotations.push({capability: match[1], requirementName: match[2].trim(), testFile, line: index + 1, language})
    }
  }
  return annotations
}

/** `// covers:` annotations. Kept as a named export because mantle's wrapper calls it directly. */
export function parseCoversAnnotations(content, testFile) {
  return parseCoversAnnotationsWith(content, testFile, STRICT_TS_COVERS, 'ts')
}

/** `# covers:` annotations in HCL test files. Mirrors `parseCoversAnnotations`. */
export function parseCoversAnnotationsHcl(content, testFile) {
  return parseCoversAnnotationsWith(content, testFile, STRICT_HCL_COVERS, 'hcl')
}

/**
 * True when a covers-index annotation file matches a spec-cited file. Suffix matching, because a
 * spec cites a partial path and the index holds a full path relative to the scan root.
 */
export function fileMatchesCitation(annotationFile, citationFile) {
  const normalize = (file) => file.replaceAll('\\', '/')
  const annotation = normalize(annotationFile)
  const citation = normalize(citationFile)
  return annotation === citation || annotation.endsWith('/' + citation) || citation.endsWith('/' + annotation)
}

// ---------------------------------------------------------------------------------------------
// Checks. Ported from openspec-checker.ts with no behavior change.
// ---------------------------------------------------------------------------------------------

/**
 * Flag lines that mention `covers:` and `#` but miss the strict line-leading parser — a trailing
 * comment, a block comment, or prose. Those read as tethers to a human and are invisible to the
 * reconcile, which is the worst of both.
 *
 * @param {string} content raw file text
 * @param {string} filePath path relative to the scan root
 * @param {readonly RegExp[]} strictPatterns every registered language's strict pattern
 */
export function checkCoversNearMiss(content, filePath, strictPatterns = [STRICT_TS_COVERS, STRICT_HCL_COVERS]) {
  const findings = []
  const TRIGGER = /covers:.*#/
  const lines = content.split('\n')

  for (const [index, line] of lines.entries()) {
    if (!TRIGGER.test(line)) {
      continue
    }
    if (strictPatterns.some((pattern) => pattern.test(line))) {
      continue
    }

    // Skip lines where `covers:` sits inside a string literal rather than being an annotation.
    // Pattern A: the whole line is a string literal value, such as an array element.
    const trimmed = line.trimStart()
    if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) {
      continue
    }

    // Pattern B: `covers:` sits inside a double-quoted string argument, as in
    //   makeTest(dir, path, "// covers: cap#req\n...")
    // An odd count of `"` before the `// covers:` position means we are inside a string.
    const coversIndex = line.indexOf('// covers:')
    if (coversIndex !== -1) {
      const before = line.slice(0, coversIndex)
      const doubleQuotes = (before.match(/"/g) ?? []).length
      if (doubleQuotes % 2 !== 0) {
        continue
      }
    }

    findings.push({
      type: 'covers-near-miss',
      severity: 'warning',
      file: filePath,
      line: index + 1,
      message:
        `Near-miss covers: annotation — not matched by the strict line-leading parser. Move 'covers:' to its own line-leading comment (// covers: or # covers:).`
    })
  }

  return findings
}

/**
 * Check that every `#### Scenario:` block carries GIVEN, WHEN, and THEN lines. Runs on base and
 * delta specs alike. Additive to the vendor validator, which checks presence of scenarios only.
 */
export function checkScenarioGwtStructure(content, filePath) {
  const findings = []
  const lines = content.split('\n')

  let inScenario = false
  let scenarioStartLine = 0
  let hasGiven = false
  let hasWhen = false
  let hasThen = false

  const emitIfIncomplete = () => {
    if (hasGiven && hasWhen && hasThen) {
      return
    }
    const missing = [!hasGiven && 'GIVEN', !hasWhen && 'WHEN', !hasThen && 'THEN'].filter(Boolean).join(', ')
    findings.push({
      type: 'scenario-gwt-structure',
      severity: 'warning',
      file: filePath,
      line: scenarioStartLine,
      message: `#### Scenario: block is missing ${missing} line(s). All scenarios must have GIVEN, WHEN, and THEN.`
    })
  }

  for (const [index, line] of lines.entries()) {
    if (/^####\s+Scenario:/.test(line)) {
      if (inScenario) {
        emitIfIncomplete()
      }
      inScenario = true
      scenarioStartLine = index + 1
      hasGiven = hasWhen = hasThen = false
      continue
    }

    if (inScenario) {
      // A heading at `###` or shallower ends the scenario block.
      if (/^#{1,3}\s/.test(line)) {
        emitIfIncomplete()
        inScenario = false
      } else {
        if (/\bGIVEN\b/i.test(line)) {
          hasGiven = true
        }
        if (/\bWHEN\b/i.test(line)) {
          hasWhen = true
        }
        if (/\bTHEN\b/i.test(line)) {
          hasThen = true
        }
      }
    }
  }

  if (inScenario) {
    emitIfIncomplete()
  }

  return findings
}

/**
 * Check that every `### Requirement:` carries at least one `#### Scenario:`. Runs on base and delta
 * specs alike.
 *
 * This is the rule added at `COVERS_SPEC_VERSION` 4, and it is deliberately the vendor validator's
 * rule rather than a new invention: `checkScenarioGwtStructure` above says it is "additive to the
 * vendor validator, which checks presence of scenarios only", and presence was exactly what no
 * engine in this estate checked outside the two repos that shell out to `openspec validate`.
 *
 * A requirement under a `## REMOVED Requirements` section is EXEMPT. That is not a judgement call —
 * it is what `@fission-ai/openspec@1.4.1` does, measured directly: a bare `REMOVED` requirement
 * validates clean, while bare base, `ADDED` and `MODIFIED` requirements each raise
 * `must include at least one scenario` as an ERROR. A removed requirement is being deleted;
 * demanding a scenario for it would reject a legitimate retirement delta.
 *
 * @param {string} content raw spec.md text
 * @param {string} filePath path relative to the scan root, for finding messages
 */
export function checkRequirementHasScenario(content, filePath) {
  const findings = []
  const lines = content.split('\n')

  let inRemovedSection = false
  let requirementName = null
  let requirementLine = 0
  let sawScenario = false

  const emitIfBare = () => {
    if (requirementName === null || sawScenario || inRemovedSection) {
      return
    }
    findings.push({
      type: 'requirement-without-scenario',
      severity: 'warning',
      file: filePath,
      line: requirementLine,
      message: `### Requirement: ${requirementName} has no #### Scenario: block. Every requirement must have at least one scenario.`
    })
  }

  for (const [index, line] of lines.entries()) {
    // A heading at `##` or shallower closes any open requirement and switches section. Evaluated
    // BEFORE the section flag moves, so the closing requirement is judged under its OWN section.
    if (/^#{1,2}\s/.test(line)) {
      emitIfBare()
      requirementName = null
      inRemovedSection = /^##\s+REMOVED\b/i.test(line)
      continue
    }

    const requirement = /^### Requirement:\s*(.+)$/.exec(line)
    if (requirement) {
      emitIfBare()
      requirementName = requirement[1].trim()
      requirementLine = index + 1
      sawScenario = false
      continue
    }

    if (requirementName !== null && /^####\s+Scenario:/.test(line)) {
      sawScenario = true
    }
  }

  emitIfBare()

  return findings
}

/**
 * Resolve a spec's `verified by` citations against the covers index.
 *
 * Emits:
 *   - `citation-missing-line`    a `file` citation with no `:line`
 *   - `unresolved-verified-by`   the cited file holds no covers annotation for this key within ±1
 *                                of the cited line. File-aware: `fileA:405` must NOT resolve
 *                                against a covers line in `fileB`.
 *   - `unlabeled-multi-citation` a requirement with more than one citation where any lacks a
 *                                `(scope)` label
 *
 * @param {string} specContent raw spec.md text
 * @param {string} specFile path relative to the scan root
 * @param {string} capability capability directory name
 * @param {Map<string, Array<{file: string, line: number}>>} coversIndex `capability#name` → sites
 */
export function checkVerifiedBy(specContent, specFile, capability, coversIndex) {
  const findings = []
  const lines = specContent.split('\n')

  // One backtick-quoted token, optionally followed by a `(scope label)`.
  // Group 1 = raw file[:line], group 2 = label when present.
  const CITATION_RE = /`([^`]+)`(?:\s*\(([^)]+)\))?/g

  let currentReqName = null
  let currentReqLine = 0
  let currentReqCitations = []

  const processReqCitations = (reqName, reqLine, citations) => {
    const reqKey = `${capability}#${reqName}`
    const indexEntries = coversIndex.get(reqKey) ?? []

    for (const citation of citations) {
      const lastColon = citation.raw.lastIndexOf(':')
      let citedFile
      let citedLine = null

      if (lastColon > 0) {
        const suffix = citation.raw.slice(lastColon + 1)
        if (/^\d+$/.test(suffix)) {
          citedFile = citation.raw.slice(0, lastColon)
          citedLine = Number(suffix)
        } else {
          citedFile = citation.raw
        }
      } else {
        citedFile = citation.raw
      }

      if (citedLine === null) {
        findings.push({
          type: 'citation-missing-line',
          severity: 'warning',
          file: specFile,
          line: citation.sourceLine,
          capability,
          requirementName: reqName,
          message: `Citation \`${citation.raw}\` for '${reqKey}' has no :line — add the line number of the covers: annotation`
        })
        continue
      }

      const inFile = indexEntries.filter((entry) => fileMatchesCitation(entry.file, citedFile))

      if (inFile.length === 0) {
        findings.push({
          type: 'unresolved-verified-by',
          severity: 'warning',
          file: specFile,
          line: citation.sourceLine,
          capability,
          requirementName: reqName,
          message: `Citation \`${citation.raw}\` for '${reqKey}' — no covers: annotation for this key found in '${citedFile}'`
        })
      } else {
        const withinRange = inFile.some((entry) => Math.abs(entry.line - citedLine) <= 1)
        if (!withinRange) {
          const nearest = inFile.map((entry) => entry.line).join(', ')
          findings.push({
            type: 'unresolved-verified-by',
            severity: 'warning',
            file: specFile,
            line: citation.sourceLine,
            capability,
            requirementName: reqName,
            message:
              `Citation \`${citation.raw}\` for '${reqKey}' — covers: annotation in '${citedFile}' is at line ${nearest}, not within ±1 of cited line ${citedLine}`
          })
        }
      }
    }

    if (citations.length > 1 && citations.some((citation) => citation.label === null)) {
      findings.push({
        type: 'unlabeled-multi-citation',
        severity: 'warning',
        file: specFile,
        line: reqLine,
        capability,
        requirementName: reqName,
        message:
          `Requirement '${reqKey}' has ${citations.length} citations but at least one lacks a (scope) label — add parenthetical labels to distinguish each citation`
      })
    }
  }

  for (const [index, line] of lines.entries()) {
    const reqMatch = /^### Requirement:\s*(.+)$/.exec(line)
    if (reqMatch) {
      if (currentReqName) {
        processReqCitations(currentReqName, currentReqLine, currentReqCitations)
      }
      currentReqName = reqMatch[1].trim()
      currentReqLine = index + 1
      currentReqCitations = []
      continue
    }

    // A heading at `##` or `#` ends the current requirement block.
    if (/^#{1,2}\s/.test(line) && !/^###/.test(line)) {
      if (currentReqName) {
        processReqCitations(currentReqName, currentReqLine, currentReqCitations)
        currentReqName = null
        currentReqCitations = []
      }
      continue
    }

    if (currentReqName && /verified\s+by/i.test(line)) {
      CITATION_RE.lastIndex = 0
      let match
      while ((match = CITATION_RE.exec(line)) !== null) {
        currentReqCitations.push({raw: match[1], label: match[2] ?? null, sourceLine: index + 1})
      }
    }
  }

  if (currentReqName) {
    processReqCitations(currentReqName, currentReqLine, currentReqCitations)
  }

  return findings
}

/**
 * Check delta specs for requirement integrity.
 *
 * Emits:
 *   - `delta-base-missing`            a MODIFIED/REMOVED/RENAMED requirement absent from the base
 *   - `removed-requirement-migration` a REMOVED requirement with no `Reason:` or `Migration:` note
 *   - `duplicate-requirement-name`    an ADDED requirement whose name already exists in the base
 *   - `scenario-gwt-structure`        folded in, so delta scenarios are held to the same structure
 *
 * @param {string} cwd scan root holding the spec tree
 * @param {Array<{capability: string, requirementName: string}>} baseRequirements parsed base specs
 * @param {{deltaGlob?: string, deltaIgnore?: readonly string[]}} [options]
 */
export function checkDeltaRequirements(cwd, baseRequirements, options = {}) {
  const {deltaGlob = DEFAULT_DELTA_GLOB, deltaIgnore = DEFAULT_DELTA_IGNORE} = options
  const findings = []

  const baseByCapability = new Map()
  for (const requirement of baseRequirements) {
    const names = baseByCapability.get(requirement.capability) ?? new Set()
    names.add(requirement.requirementName)
    baseByCapability.set(requirement.capability, names)
  }

  // Delta specs, skipping `archive/`: an archived change describes a past state of the world and
  // its requirements are expected to be absent from the base.
  const deltaFiles = globSync(deltaGlob, {cwd, ignore: deltaIgnore})

  for (const deltaFile of deltaFiles) {
    const content = readFileSync(join(cwd, deltaFile), 'utf-8')
    const capability = capabilityOf(deltaFile)
    const lines = content.split('\n')
    const baseSet = baseByCapability.get(capability) ?? new Set()

    let section = null
    let currentReqName = null
    let currentReqLine = 0
    const currentReqBody = []

    const flushRequirement = () => {
      if (!currentReqName || !section) {
        return
      }

      if (section === 'MODIFIED' || section === 'REMOVED' || section === 'RENAMED') {
        if (!baseSet.has(currentReqName)) {
          findings.push({
            type: 'delta-base-missing',
            severity: 'warning',
            file: deltaFile,
            line: currentReqLine,
            capability,
            requirementName: currentReqName,
            message: `${section} requirement '${currentReqName}' does not exist in base openspec/specs/${capability}/spec.md`
          })
        }

        if (section === 'REMOVED') {
          const body = currentReqBody.join('\n')
          if (!/Reason:|Migration:/i.test(body)) {
            findings.push({
              type: 'removed-requirement-migration',
              severity: 'warning',
              file: deltaFile,
              line: currentReqLine,
              capability,
              requirementName: currentReqName,
              message: `REMOVED requirement '${currentReqName}' lacks a Reason: or Migration: note`
            })
          }
        }
      } else if (baseSet.has(currentReqName)) {
        findings.push({
          type: 'duplicate-requirement-name',
          severity: 'warning',
          file: deltaFile,
          line: currentReqLine,
          capability,
          requirementName: currentReqName,
          message: `ADDED requirement '${currentReqName}' already exists in base openspec/specs/${capability}/spec.md — use MODIFIED instead`
        })
      }

      currentReqName = null
      currentReqBody.length = 0
    }

    for (const [index, line] of lines.entries()) {
      if (/^##\s+ADDED/.test(line)) {
        flushRequirement()
        section = 'ADDED'
        continue
      }
      if (/^##\s+MODIFIED/.test(line)) {
        flushRequirement()
        section = 'MODIFIED'
        continue
      }
      if (/^##\s+REMOVED/.test(line)) {
        flushRequirement()
        section = 'REMOVED'
        continue
      }
      if (/^##\s+RENAMED/.test(line)) {
        flushRequirement()
        section = 'RENAMED'
        continue
      }

      const reqMatch = /^### Requirement:\s*(.+)$/.exec(line)
      if (reqMatch) {
        flushRequirement()
        currentReqName = reqMatch[1].trim()
        currentReqLine = index + 1
        continue
      }

      if (currentReqName) {
        currentReqBody.push(line)
      }
    }

    flushRequirement()

    findings.push(...checkScenarioGwtStructure(content, deltaFile))
    findings.push(...checkRequirementHasScenario(content, deltaFile))
  }

  return findings
}

// ---------------------------------------------------------------------------------------------
// The entry point.
// ---------------------------------------------------------------------------------------------

/**
 * Reconciles specs and tests. Findings are advisory and shape-stable; consumers own severity and
 * blocking policy. It throws only when a symlink prevents a complete scan. Optional finding keys
 * are omitted; `language` appears only when requested.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] scan root
 * @param {string} [options.specGlob] base spec glob
 * @param {readonly string[]} [options.specIgnore] base spec ignore list
 * @param {string} [options.deltaGlob] delta spec glob
 * @param {readonly string[]} [options.deltaIgnore] delta spec ignore list
 * @param {readonly string[]} [options.testIgnore] default ignore list for language globs
 * @param {readonly object[]} [options.languages] language table
 * @param {boolean} [options.annotateLanguage] include language on test-file findings
 * @returns {{findings: object[], specsScanned: number, testFilesScanned: number,
 *   requirementsFound: number, coversAnnotationsFound: number}}
 */
export function checkCoversDetailed(options = {}) {
  const {
    cwd = process.cwd(),
    specGlob = DEFAULT_SPEC_GLOB,
    specIgnore = DEFAULT_SPEC_IGNORE,
    deltaGlob = DEFAULT_DELTA_GLOB,
    deltaIgnore = DEFAULT_DELTA_IGNORE,
    testIgnore = DEFAULT_TEST_IGNORE,
    languages = DEFAULT_LANGUAGES,
    annotateLanguage = false
  } = options

  const findings = []
  const strictPatterns = languages.map((language) => language.commentRegex)

  // --- Base specs ---
  const specFiles = globSync(specGlob, {cwd, ignore: specIgnore})
  const allRequirements = []
  // Spec content is kept because `checkVerifiedBy` needs it AFTER the covers index exists.
  const specContents = []

  for (const specFile of specFiles) {
    const content = readFileSync(join(cwd, specFile), 'utf-8')
    const capability = capabilityOf(specFile)

    allRequirements.push(...parseRequirements(content, specFile, capability))
    findings.push(...checkScenarioGwtStructure(content, specFile))
    findings.push(...checkRequirementHasScenario(content, specFile))
    findings.push(...checkCoversNearMiss(content, specFile, strictPatterns))

    specContents.push({file: specFile, content, capability})
  }

  // --- Test files, one pass per registered language ---
  const allCovers = []
  let testFilesScanned = 0

  for (const language of languages) {
    const testFiles = globSync(language.glob, {cwd, ignore: language.ignore ?? testIgnore})
    for (const testFile of testFiles) {
      const content = readFileSync(join(cwd, testFile), 'utf-8')
      allCovers.push(...parseCoversAnnotationsWith(content, testFile, language.commentRegex, language.id))
      if (language.nearMiss !== false) {
        const nearMiss = checkCoversNearMiss(content, testFile, strictPatterns)
        findings.push(...(annotateLanguage ? nearMiss.map((finding) => ({...finding, language: language.id})) : nearMiss))
      }
      testFilesScanned++
    }
  }

  // --- Index ---
  const reqKey = (capability, name) => `${capability}#${name}`
  const requirementKeys = new Set(allRequirements.map((requirement) => reqKey(requirement.capability, requirement.requirementName)))
  const coveredKeys = new Set(allCovers.map((cover) => reqKey(cover.capability, cover.requirementName)))

  const coversIndex = new Map()
  for (const cover of allCovers) {
    const key = reqKey(cover.capability, cover.requirementName)
    const existing = coversIndex.get(key) ?? []
    existing.push({file: cover.testFile, line: cover.line})
    coversIndex.set(key, existing)
  }

  // Reconcile, forward: every requirement has at least one covering test.
  for (const requirement of allRequirements) {
    const key = reqKey(requirement.capability, requirement.requirementName)
    if (!coveredKeys.has(key)) {
      findings.push({
        type: 'uncovered-requirement',
        severity: 'warning',
        file: requirement.specFile,
        line: requirement.line,
        capability: requirement.capability,
        requirementName: requirement.requirementName,
        message: `Requirement '${requirement.requirementName}' (${requirement.capability}) has no covering test. Add: // covers: ${key}`
      })
    }
  }

  // Reconcile, backward: every covers annotation names a requirement that exists.
  for (const cover of allCovers) {
    const key = reqKey(cover.capability, cover.requirementName)
    if (!requirementKeys.has(key)) {
      const finding = {
        type: 'stale-reference',
        severity: 'warning',
        file: cover.testFile,
        line: cover.line,
        capability: cover.capability,
        requirementName: cover.requirementName,
        message: `Stale covers reference: '${key}' — no matching ### Requirement in openspec/specs/${cover.capability}/spec.md`
      }
      findings.push(annotateLanguage ? {...finding, language: cover.language} : finding)
    }
  }

  // `verified by` citations, which need the finished index.
  for (const {file, content, capability} of specContents) {
    findings.push(...checkVerifiedBy(content, file, capability, coversIndex))
  }

  // Delta specs.
  findings.push(...checkDeltaRequirements(cwd, allRequirements, {deltaGlob, deltaIgnore}))

  return {findings, specsScanned: specFiles.length, testFilesScanned, requirementsFound: allRequirements.length, coversAnnotationsFound: allCovers.length}
}

/**
 * The rule, as one call. `checkCoversDetailed` is the same run with the scan counts a CLI wants.
 *
 * @param {object} [options] see `checkCoversDetailed`
 * @returns {object[]} findings, in emission order
 */
export function checkCovers(options = {}) {
  return checkCoversDetailed(options).findings
}
