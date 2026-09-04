#!/usr/bin/env node
// audits/specs/hash-normative-quotes.mjs -- one-time/rerunnable dev
// utility, not part of the audit runtime. Computes sha256(spec.normative_quote)
// for every *.rule.json under specs/*/ and writes it back into that rule's
// own spec.content_sha256 field, idempotently (byte-identical output on a
// second run with no quote changes).
//
// This is what "content_sha256 is computed over this file's own
// normative_quote at authoring time" (rule.schema.json) means in practice: it
// pins the quote against silent editing, not against upstream drift. The
// external-spec re-fetch-and-compare probe is deferred to a follow-up PR
// (decisions/0011 follow-up (h)); this script is unrelated to that probe and
// ships in the pilot because content_sha256 is a required schema field today.

import {createHash} from 'node:crypto'
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {dirname} from 'node:path'
import {artifacts} from './load.mjs'

const SPECS_DIR = dirname(fileURLToPath(import.meta.url))

let changed = 0
for (const artifact of artifacts()) {
  const dir = join(SPECS_DIR, artifact)
  for (const fileName of readdirSync(dir).filter((n) => n.endsWith('.rule.json'))) {
    const filePath = join(dir, fileName)
    const rule = JSON.parse(readFileSync(filePath, 'utf-8'))
    const hash = createHash('sha256').update(rule.spec.normative_quote, 'utf-8').digest('hex')
    if (rule.spec.content_sha256 !== hash) {
      rule.spec.content_sha256 = hash
      writeFileSync(filePath, JSON.stringify(rule, null, 2) + '\n')
      changed++
      console.log(`updated ${artifact}/${fileName} -> ${hash}`)
    }
  }
}
console.log(`\n${changed} rule file(s) updated.`)
