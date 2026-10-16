// The secret-value guard (atlas decision 0160, PR B): scripts/check-no-env-secrets.mjs and
// scripts/build-composer.mjs refuse a built file holding a secret-looking variable's value, as
// written or JSON-escaped, and report names only.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {leakedNames, scanBuiltFiles, secretValues} from '../../scripts/lib/env-secrets.mjs'

const names = (env: Record<string, string>) => secretValues(env).map(([name]) => name).sort()

describe('secretValues', () => {
  it('takes credential-named variables with a judgeable value, and nothing else', () => {
    expect(
      names({
        CLOUDFLARE_API_TOKEN: 'cf-token-value-123',
        CF_ACCESS_CLIENT_SECRET: 'access-secret-value',
        CF_ACCESS_CLIENT_ID: 'access-client-id-value',
        NODE_AUTH_TOKEN: 'short',
        GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
        PATH: '/usr/bin:/bin'
      })
    ).toEqual(['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'CLOUDFLARE_API_TOKEN'])
  })

  it('takes the names a looser pattern used to miss, and any URL carrying a credential', () => {
    expect(
      names({
        HEALTHCHECKS_PING_URL: 'https://hc-ping.com/0f1e2d3c-uuid',
        SENTRY_DSN: 'https://public@o1.ingest.example/1',
        DEPLOY_WEBHOOK: 'https://hooks.example/abc123',
        GH_PAT: 'ghp_example_value',
        SIGNING_KEY: 'signing-key-value',
        MIRROR: 'https://user:password@example.com/repo'
      })
    ).toEqual(['DEPLOY_WEBHOOK', 'GH_PAT', 'HEALTHCHECKS_PING_URL', 'MIRROR', 'SENTRY_DSN', 'SIGNING_KEY'])
  })
})

describe('leakedNames', () => {
  it('names the variables whose value occurs in the text, never the values', () => {
    const secrets = secretValues({API_TOKEN: 'token-value-abc', OTHER_SECRET: 'not-in-the-text'})
    const found = leakedNames('const x = "token-value-abc"', secrets)
    expect(found).toEqual(['API_TOKEN'])
    expect(JSON.stringify(found)).not.toContain('token-value-abc')
  })

  it('finds a value as Astro inlines it: JSON-escaped, and each line of a multi-line key', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----'
    const secrets = secretValues({SIGNING_KEY: pem, QUOTED_SECRET: 'he said "open sesame"'})
    expect(leakedNames(`const k = ${JSON.stringify(pem)}`, secrets)).toEqual(['SIGNING_KEY'])
    expect(leakedNames(`const q = ${JSON.stringify('he said "open sesame"')}`, secrets)).toEqual(['QUOTED_SECRET'])
  })
})

describe('scanBuiltFiles', () => {
  let dir = ''
  afterEach(() => rmSync(dir, {recursive: true, force: true}))

  it('fails a seeded leak in a nested built file, by file and name', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'dist-'))
    mkdirSync(path.join(dir, 'server', 'chunks'), {recursive: true})
    writeFileSync(path.join(dir, 'index.html'), '<p>no secret here</p>')
    writeFileSync(path.join(dir, 'server', 'chunks', 'entry.mjs'),
      `const env = Object.assign({BASE_URL: "/"}, {FAKE_API_TOKEN: ${JSON.stringify('seeded-token-value')}})`)
    const result = scanBuiltFiles(dir, secretValues({FAKE_API_TOKEN: 'seeded-token-value'}))
    expect(result.checked).toBe(2)
    expect(result.leaks).toEqual([`${path.join('server', 'chunks', 'entry.mjs')}: FAKE_API_TOKEN`])
  })
})
