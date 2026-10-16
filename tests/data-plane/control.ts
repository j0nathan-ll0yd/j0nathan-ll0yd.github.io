// The test-side client of the fixture data plane (`./server.ts`; plan Step 6.2).
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {type Behavior, CONTROL_PREFIX, DATA_PLANE_ORIGIN} from './protocol'

export { DATA_PLANE_ORIGIN, ENDPOINTS }
export type { Behavior }

async function post(route: string, body?: unknown): Promise<void> {
  const response = await fetch(`${DATA_PLANE_ORIGIN}${CONTROL_PREFIX}${route}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body ?? {})
  })
  if (!response.ok) {
    throw new Error(`data plane control ${route} answered ${response.status}`)
  }
}

/** Puts every export path back on its baseline answer and clears the request log. */
export function resetDataPlane(): Promise<void> {
  return post('/reset')
}

/** Replaces the answers of the given export paths. */
export async function setDataPlane(overrides: Readonly<Record<string, Behavior>>): Promise<void> {
  for (const [path, behavior] of Object.entries(overrides)) {
    await post('/set', {path, behavior})
  }
}

/** Serves the given raw fixture files (path to file), fresh by default. */
export function serveFixtures(files: Readonly<Record<string, string>>, generatedAt?: 'now' | 'original' | (string & {})): Promise<void> {
  return setDataPlane(Object.fromEntries(Object.entries(files).map(([path, file]) => [path, {kind: 'fixture', file, generatedAt} as Behavior])))
}

/** The export paths the Worker read since the last reset. */
export async function dataPlaneRequests(): Promise<string[]> {
  const response = await fetch(`${DATA_PLANE_ORIGIN}${CONTROL_PREFIX}/requests`)
  return (await response.json()) as string[]
}
