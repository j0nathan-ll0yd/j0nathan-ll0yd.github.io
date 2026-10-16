// The secret-value guard (atlas decision 0160, PR B): scripts/check-no-env-secrets.mjs and
// scripts/build-composer.mjs refuse a built file holding a secret-looking variable's value, and
// report names only.
import {describe, expect, it} from 'vitest'
import {leakedNames, secretValues} from '../../scripts/lib/env-secrets.mjs'

describe('secretValues', () => {
  it('takes credential-named variables with a judgeable value, and nothing else', () => {
    const env = {
      CLOUDFLARE_API_TOKEN: 'cf-token-value-123',
      CF_ACCESS_CLIENT_SECRET: 'access-secret-value',
      CF_ACCESS_CLIENT_ID: 'access-client-id-value',
      NODE_AUTH_TOKEN: 'short',
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      PATH: '/usr/bin:/bin'
    }
    expect(secretValues(env).map(([name]) => name).sort()).toEqual(['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'CLOUDFLARE_API_TOKEN'])
  })
})

describe('leakedNames', () => {
  it('names the variables whose value occurs in the text, never the values', () => {
    const secrets = secretValues({API_TOKEN: 'token-value-abc', OTHER_SECRET: 'not-in-the-text'})
    const names = leakedNames('const x = "token-value-abc"', secrets)
    expect(names).toEqual(['API_TOKEN'])
    expect(JSON.stringify(names)).not.toContain('token-value-abc')
  })
})
