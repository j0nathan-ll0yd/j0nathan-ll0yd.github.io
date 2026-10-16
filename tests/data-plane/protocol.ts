// The control protocol of the fixture data plane (plan Step 6.2), shared by the server and the tests.

/** How the server stamps `generatedAt` on a served fixture. `now` is fresh; `original` keeps the fixture's own date. */
export type GeneratedAtMode = 'now' | 'original' | (string & {})

/** What the server answers for one export path. Every kind accepts `delayMs` (a slow first byte). */
export type Behavior =
  & (
    | {kind: 'fixture'; file: string; generatedAt?: GeneratedAtMode}
    | {kind: 'json'; body: unknown; generatedAt?: GeneratedAtMode}
    | {kind: 'status'; status: number}
    | {kind: 'suppress'}
    | {kind: 'stall'}
    | {kind: 'malformed'}
    | {kind: 'no-cloudfront-id'; file: string}
  )
  & {delayMs?: number}

export const CONTROL_PREFIX = '/__control'
export const DEFAULT_PORT = 4399
export const DATA_PLANE_ORIGIN = `http://127.0.0.1:${process.env.DATA_PLANE_PORT ?? DEFAULT_PORT}`

/** The body a gated 403 carries when the gate is shut (`isSuppressionBody`). */
export const SUPPRESSION_BODY = {suppressed: true, reason: 'focus mode active'}
