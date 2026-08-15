#!/usr/bin/env node
import {existsSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {checkCoversDetailed, COVERS_SPEC_VERSION} from './vendor/openspec-covers.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')

export function checkCoversIntegrity() {
  const codePath = resolve(__dirname, 'vendor/openspec-covers.mjs')
  const shaPath = resolve(__dirname, 'vendor/openspec-covers.mjs.sha256')
  if (!existsSync(codePath) || !existsSync(shaPath)) {
    throw new Error('openspec-covers contract files missing in vendor/')
  }
  const code = readFileSync(codePath, 'utf8')
  const expectedSha = readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0]
  const actualSha = createHash('sha256').update(code).digest('hex')
  if (actualSha !== expectedSha) {
    throw new Error(`openspec-covers sha256 mismatch! Expected ${expectedSha}, got ${actualSha}`)
  }
  return true
}

function main() {
  const isBlocking = process.argv.includes('--blocking')
  const isJson = process.argv.includes('--json')

  checkCoversIntegrity()

  const result = checkCoversDetailed({cwd: REPO_ROOT})

  if (isJson) {
    console.log(JSON.stringify({specVersion: COVERS_SPEC_VERSION, ...result}, null, 2))
  } else {
    console.log(
      `openspec-covers (spec version ${COVERS_SPEC_VERSION}): ${result.specsScanned} spec file(s), ` +
        `${result.requirementsFound} requirement(s), ${result.testFilesScanned} test file(s), ` +
        `${result.coversAnnotationsFound} covers: annotation(s)`
    )

    if (result.findings.length === 0) {
      console.log('OK: every requirement has a covering test and every covers: annotation resolves.')
    } else {
      console.log('')
      for (const finding of result.findings) {
        console.log(`[${finding.type}] ${finding.file}:${finding.line} — ${finding.message}`)
      }
      console.log('')
      console.log(isBlocking
        ? `FAIL: ${result.findings.length} covers-conformance finding(s).`
        : `${result.findings.length} covers-conformance finding(s) (report-only; pass --blocking to gate).`)
    }
  }

  if (isBlocking && result.findings.length > 0) {
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
