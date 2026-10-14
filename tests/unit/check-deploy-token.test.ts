import {describe, expect, it} from 'vitest'
import {probes} from '../../scripts/check-deploy-token.mjs'

describe('check-deploy-token probes', () => {
  it('makes one read-only GET per capability the post-cutover deploy needs, with ids only', () => {
    const list = probes('acct', 'zone')
    expect(list.map(([, path]) => path)).toEqual([
      '/zones/zone',
      '/zones?name=jonathanlloyd.me',
      '/zones/zone/workers/routes',
      '/accounts/acct/workers/scripts/human-datastream/settings',
      '/accounts/acct'
    ])
  })
})
