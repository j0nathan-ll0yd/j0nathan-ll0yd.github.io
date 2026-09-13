// audits/specs/load.mjs -- the dependency-inversion seam for B2's
// spec/eval pilot (decisions/0011). A validator imports its own rule catalog
// through `rules(artifact)` and emits findings through `emit(R, id, msg)`,
// which throws on an id with no rule file and stamps `severity` from the rule
// rather than letting the validator choose it. An unregistered id therefore
// cannot be emitted at all -- surjectivity is structural, not a separate gate
// that checks correspondence after the fact.
//
// Two consumers walk the specs/ tree: this module's own `rules()` (called by
// each validator, and by audits/__tests__/spec-cases.test.ts's directory
// enumeration) and check-spec-severity.mjs (the severity ratchet). Both use
// `artifacts()` below so the directory walk cannot drift between them.

import {readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import Ajv from 'ajv'

const SPECS_DIR = dirname(fileURLToPath(import.meta.url))

const ajv = new Ajv({allErrors: true, strict: false})
const schema = JSON.parse(readFileSync(join(SPECS_DIR, 'rule.schema.json'), 'utf-8'))
const validateAgainstSchema = ajv.compile(schema)

const ruleCache = new Map()

/**
 * List every artifact directory under specs/ (e.g. ['security-txt', 'llms-txt',
 * 'feed-json']). Directories only -- rule.schema.json, load.mjs and
 * severity-baseline.json live directly under specs/ and are excluded because
 * they are files, not artifact catalogs.
 */
export function artifacts() {
  return readdirSync(SPECS_DIR, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

/**
 * Load and validate every `*.rule.json` file for one artifact directory.
 * Returns a map of { [id]: ruleObject }. Throws (does not warn) on:
 *   - malformed JSON in a rule file (a corrupt catalog must be loud, not silently
 *     degrade -- can-fail probe F);
 *   - a rule file that fails ajv validation against rule.schema.json;
 *   - constraint (iii), which ajv cannot express because it compares a rule's
 *     OWN id against a value inside its own `cases[].expect` array: a `failed`
 *     case's `expect` must contain this rule's id, and a `passed`/`inapplicable`
 *     case's `expect` must NOT contain it.
 * Results are cached per artifact for the lifetime of the process -- rules()
 * is called on every audit run (the production path), not only in CI.
 */
export function rules(artifact) {
  if (ruleCache.has(artifact)) {
    return ruleCache.get(artifact)
  }

  const dir = join(SPECS_DIR, artifact)
  if (!statSync(dir, {throwIfNoEntry: false})?.isDirectory()) {
    throw new Error(`specs/load.mjs: no such artifact directory "${artifact}" under ${SPECS_DIR}`)
  }

  const ruleFiles = readdirSync(dir).filter((name) => name.endsWith('.rule.json'))
  const byId = {}

  for (const fileName of ruleFiles) {
    const filePath = join(dir, fileName)
    const raw = readFileSync(filePath, 'utf-8')

    let rule
    try {
      rule = JSON.parse(raw)
    } catch (err) {
      throw new Error(`specs/load.mjs: ${filePath} is not valid JSON: ${err.message}`, {cause: err})
    }

    const valid = validateAgainstSchema(rule)
    if (!valid) {
      const detail = ajv.errorsText(validateAgainstSchema.errors, {separator: '; '})
      throw new Error(`specs/load.mjs: ${filePath} failed schema validation: ${detail}`)
    }

    if (rule.id !== rule.id.trim() || fileName !== `${rule.id}.rule.json`) {
      throw new Error(`specs/load.mjs: ${filePath} declares id "${rule.id}", which does not match its filename`)
    }

    // Constraint (iii): own id present in `expect` iff outcome is `failed`.
    for (const c of rule.cases ?? []) {
      const ownIdInExpect = (c.expect ?? []).some((e) => e.id === rule.id)
      if (c.outcome === 'failed' && !ownIdInExpect) {
        throw new Error(
          `specs/load.mjs: ${filePath} case "${c.name}" has outcome "failed" but its own id ` +
            `"${rule.id}" is absent from expect -- a failing case must prove the rule actually fired`
        )
      }
      if ((c.outcome === 'passed' || c.outcome === 'inapplicable') && ownIdInExpect) {
        throw new Error(
          `specs/load.mjs: ${filePath} case "${c.name}" has outcome "${c.outcome}" but its own id ` +
            `"${rule.id}" is present in expect -- a passing/inapplicable case must prove the rule did NOT fire`
        )
      }
    }

    if (byId[rule.id]) {
      throw new Error(`specs/load.mjs: duplicate rule id "${rule.id}" in ${dir} (${fileName} and an earlier file)`)
    }
    byId[rule.id] = {...rule, __ruleFilePath: filePath}
  }

  ruleCache.set(artifact, byId)
  return byId
}

/**
 * Emit a finding for a registered id. Throws if `id` has no rule file in `R`
 * -- this is what makes surjectivity structural rather than checked: a
 * validator cannot emit a string that was not declared as a rule. Severity is
 * stamped from the rule file, never chosen by the caller, closing the
 * historical hole where a validator's own `severity: 'warn'` literal could
 * silently disagree with the rule's declared severity.
 */
export function emit(R, id, message) {
  const rule = R[id]
  if (!rule) {
    throw new Error(`specs/load.mjs: emit() called with unregistered id "${id}" -- no rule file declares it`)
  }
  return {severity: rule.severity, id, message}
}
