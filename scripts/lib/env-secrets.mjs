// Secret-looking environment values (atlas decision 0160, PR B). Astro's env plugin
// (astro/dist/env/vite-plugin-import-meta-env.js `getReferencedPrivateKeys`) treats every non-PUBLIC_
// variable, process and .env files alike, as private, and inlines `JSON.stringify(value)` into a
// server module whenever the variable's NAME appears anywhere in that module's source. A built file
// can therefore carry a token without any code asking for it. scripts/check-no-env-secrets.mjs and
// scripts/build-composer.mjs refuse any file that does.

import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'

/** A variable whose name says it holds a credential. */
const SECRET_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH|API_?KEY|ACCESS_?KEY|CLIENT_?ID|COOKIE|SESSION|SIGNING|_KEY$|KEY_|_PAT$|DSN|WEBHOOK|PING_URL/i
/** A URL that carries a user or password: a credential whatever the variable is called. */
const URL_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+@/i
/** Shorter values match too much ordinary text to judge. */
const MIN_SECRET_LENGTH = 8

/** Every form a value can take in a built file: as written, JSON-escaped, and each long line of a multi-line value. */
function forms(value) {
  const escaped = JSON.stringify(value).slice(1, -1)
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= MIN_SECRET_LENGTH)
  return [...new Set([value, escaped, ...lines])]
}

/** The secret-looking variables in `env`, as [name, forms] pairs. */
export function secretValues(env = process.env) {
  return Object.entries(env).filter(([name, value]) =>
    typeof value === 'string' && value.length >= MIN_SECRET_LENGTH && (SECRET_NAME.test(name) || URL_USERINFO.test(value))
  ).map(([name, value]) => [name, forms(value)])
}

/** The names of the secret-looking variables any form of whose value occurs in `text`. Never the values. */
export function leakedNames(text, secrets) {
  return secrets.filter(([, valueForms]) => valueForms.some((form) => text.includes(form))).map(([name]) => name)
}

/** Built files that can carry text: code, data, markup and styles, and files with no extension. */
const TEXT_FILE = /\.(?:m?js|cjs|ts|json|html|txt|css|map|xml|md|svg|webmanifest)$/

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* files(full)
    } else if (TEXT_FILE.test(entry) || !entry.includes('.')) {
      yield full
    }
  }
}

/** Every text file under `dir` checked against `secrets`: the count, and `file: names` per leak. */
export function scanBuiltFiles(dir, secrets) {
  const leaks = []
  let checked = 0
  for (const file of files(dir)) {
    checked++
    const names = leakedNames(readFileSync(file, 'utf8'), secrets)
    if (names.length > 0) {
      leaks.push(`${path.relative(dir, file)}: ${names.join(', ')}`)
    }
  }
  return {checked, leaks}
}
