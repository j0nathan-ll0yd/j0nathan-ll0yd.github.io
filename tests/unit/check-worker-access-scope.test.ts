import {describe, expect, it} from 'vitest'
import {judgeAccessScope, judgeProductionResponse} from '../../scripts/check-worker-access-scope.mjs'

// The pre-cutover Access-scope check (atlas decision 0160 D1; plan Step 3.7 precondition).

const TAG = 'e469b02d28cf4d58afe2013b63185528'

describe('judgeAccessScope', () => {
  it('passes when the only destination on the Worker is previews-only', () => {
    expect(judgeAccessScope([{name: 'w', destinations: [{type: 'preview_worker', worker_id: TAG}]}], TAG)).toEqual([])
  })

  it('fails on a "worker" destination, the shape measured on 2026-10-14, because it gates production', () => {
    const failures = judgeAccessScope([{name: 'human-datastream - Cloudflare Workers', destinations: [{type: 'worker', worker_id: TAG}]}], TAG)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/"worker" destination .* production included/)
  })

  it('fails when no application guards the previews, and ignores other Workers and public apps', () => {
    const apps = [{name: 'pages', destinations: [{type: 'public', uri: '*.human-datastream.pages.dev'}]}, {
      name: 'other',
      destinations: [{type: 'worker', worker_id: 'x'}]
    }]
    expect(judgeAccessScope(apps, TAG)).toEqual(['no Access application names this Worker: its Version URLs would be public'])
  })
})

describe('judgeProductionResponse', () => {
  it('passes a 200 from the Worker', () => {
    expect(judgeProductionResponse(200, 'workers')).toEqual([])
  })

  it.each([[302, 'workers'], [401, null], [403, null]])('fails a %s', (status, runtime) => {
    expect(judgeProductionResponse(status, runtime)[0]).toMatch(/not 200/)
  })

  it('fails a production 200 that carries the preview noindex header', () => {
    expect(judgeProductionResponse(200, 'workers', 'noindex')[0]).toMatch(/must not be noindex/)
  })

  it('fails a 200 that Pages answered', () => {
    expect(judgeProductionResponse(200, null)[0]).toMatch(/did not answer/)
  })
})
