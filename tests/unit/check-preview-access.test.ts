import {describe, expect, it} from 'vitest'
import {checkPreviewAccess} from '../../scripts/check-preview-access.mjs'

// The Version URL Access check (atlas decision 0160 D1; plan Step 3.5). The fetch is injected,
// so each verdict is pinned without a network.

const URL_UNDER_TEST = 'https://abc123-human-datastream.example.workers.dev/'
const credentials = {id: 'id', secret: 'secret'}

type Answer = {response: Response} | {error: string}

/** A fetch that answers the anonymous and the tokened request separately. */
function fake(anonymous: Answer, authorized: Answer) {
  return async (_url: string, headers: Record<string, string>): Promise<Answer> => ('CF-Access-Client-Id' in headers ? authorized : anonymous)
}

const worker = () => ({response: new Response('ok', {status: 200, headers: {'X-Site-Runtime': 'workers'}})})

describe('checkPreviewAccess', () => {
  it('passes when Access refuses the anonymous request and admits the service token', async () => {
    expect(await checkPreviewAccess(URL_UNDER_TEST, credentials, fake({response: new Response(null, {status: 403})}, worker()))).toEqual([])
    expect(await checkPreviewAccess(URL_UNDER_TEST, credentials, fake({response: new Response(null, {status: 302})}, worker()))).toEqual([])
  })

  it('fails when an anonymous request answers 200', async () => {
    const failures = await checkPreviewAccess(URL_UNDER_TEST, credentials, fake(worker(), worker()))
    expect(failures).toEqual(['an anonymous GET answered 200: Access does not protect this Version URL'])
  })

  it('fails when the service token is refused', async () => {
    const failures = await checkPreviewAccess(URL_UNDER_TEST, credentials,
      fake({response: new Response(null, {status: 401})}, {response: new Response(null, {status: 403})}))
    expect(failures).toEqual(['a GET with the service token answered 403, not 200'])
  })

  it('fails when the 200 does not come from the Worker', async () => {
    const failures = await checkPreviewAccess(URL_UNDER_TEST, credentials,
      fake({response: new Response(null, {status: 401})}, {response: new Response('pages', {status: 200})}))
    expect(failures).toEqual(['the 200 carries X-Site-Runtime: null, not the Worker marker'])
  })

  it('fails on a transport error, naming the egress allowlist, and never passes blind', async () => {
    const failures = await checkPreviewAccess(URL_UNDER_TEST, credentials, fake({error: 'TypeError: fetch failed'}, {error: 'TypeError: fetch failed'}))
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatch(/unreachable anonymously .*abc123-human-datastream\.example\.workers\.dev/)
  })
})
