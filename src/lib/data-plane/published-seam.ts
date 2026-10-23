// The published page data over HTTP, for the test seams only (atlas decision 0164, Phase 3.3).
//
// Production reads the `PAGE` KV binding. A local or preview run with a fixture data plane (the
// committed tests/fixtures/composed/ files at FIXTURE_DATA_PLANE, or the local data plane at
// DATA_PLANE_BASE, tests/data-plane/server.ts) reads the same two values from three files instead,
// so the visual and behavioral suites drive the published read. Only on a preview or loopback host:
// the fixture header also needs SSR_FAULT_INJECTION=1 (./faults.ts), and DATA_PLANE_BASE is a Worker
// variable the production deploy refuses (./config.ts, scripts/check-deploy-vars.mjs).
import type {PageStore} from '../composed/published'
import {PUBLISHED_FOCUS_KEY} from '../composed/published'
import {PUBLISHED_FILES} from './published-files'

export { PUBLISHED_FILES }

/** A 200's text, null for a 404, and a throw for anything else: KV's own outcomes. */
async function textOf(response: Response): Promise<string | null> {
  if (response.status === 404) {
    await response.body?.cancel()
    return null
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`data plane answered ${response.status}`)
  }
  return response.text()
}

/** A PageStore that reads `base`'s files with `fetch`. Any `fragments:<build>` key reads the one fragments file. */
export function httpPageStore(base: string, fetcher: typeof fetch): PageStore {
  const read = async (file: string) => textOf(await fetcher(`${base}${file}`, {cache: 'no-store'}))
  return {
    async get(key) {
      return key === PUBLISHED_FOCUS_KEY ? read(PUBLISHED_FILES.focus) : null
    },
    async getWithMetadata(key) {
      if (!key.startsWith('fragments:')) {
        return {value: null, metadata: null}
      }
      // Both settle before either is judged, so no body is left unread when one read fails.
      const [valueRead, metadataRead] = await Promise.allSettled([read(PUBLISHED_FILES.fragments), read(PUBLISHED_FILES.metadata)])
      if (valueRead.status === 'rejected' || metadataRead.status === 'rejected') {
        throw new Error('the data plane failed a published read')
      }
      const [value, metadata] = [valueRead.value, metadataRead.value]
      if (value === null || metadata === null) {
        return {value: null, metadata: null}
      }
      return {value, metadata: JSON.parse(metadata) as unknown}
    }
  }
}
