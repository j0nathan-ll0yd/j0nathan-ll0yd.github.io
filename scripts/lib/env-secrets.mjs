// Secret-looking environment values (atlas decision 0160, PR B). Astro's env plugin
// (astro/dist/env/vite-plugin-import-meta-env.js `getReferencedPrivateKeys`) treats every non-PUBLIC_
// variable, process and .env files alike, as private, and inlines its VALUE into a server module
// whenever the variable's NAME appears anywhere in that module's source. A built file can therefore
// carry a token without any code asking for it. scripts/check-no-env-secrets.mjs and
// scripts/build-composer.mjs refuse any file that does.

/** A variable whose name says it holds a credential. */
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH|API_?KEY|ACCESS_?KEY|CLIENT_?ID|COOKIE|SESSION/i
/** Shorter values match too much ordinary text to judge. */
const MIN_SECRET_LENGTH = 8

/** The values of the secret-looking variables in `env`, by name. */
export function secretValues(env = process.env) {
  return Object.entries(env).filter(([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.length >= MIN_SECRET_LENGTH)
}

/** The names of the secret-looking variables whose value occurs in `text`. Never the values. */
export function leakedNames(text, secrets) {
  return secrets.filter(([, value]) => text.includes(value)).map(([name]) => name)
}
