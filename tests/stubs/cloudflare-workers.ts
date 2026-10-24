// A Node stand-in for the workerd built-in module `cloudflare:workers`, for unit tests that import
// the Worker entry or the Durable Object class (vitest.unit.config.ts aliases the specifier here).
// Production and `wrangler dev` resolve the real module; this one carries only what the site uses.

export const env: Readonly<Record<string, unknown>> = Object.freeze({})

export abstract class DurableObject<Env = unknown> {
  protected ctx: unknown
  protected env: Env
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
