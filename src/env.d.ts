/// <reference types="astro/client" />

// The Worker bindings and variables (atlas decision 0160, PR B). The server render reads only
// DATA_PLANE_BASE and SSR_FAULT_INJECTION (src/lib/data-plane/request.ts); the developer API facade
// reads those two and the API_RATE_LIMITER Durable Object binding (src/lib/edge/api-v1.ts). The repo
// does not pull in @cloudflare/workers-types for these few members.
declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>>

  // The Durable Object base class and the members the API rate limiter uses
  // (src/durable/ApiRateLimiter.ts; developers.cloudflare.com/durable-objects/api/base/).
  interface DurableObjectSyncKv {
    get(key: string): unknown
    put(key: string, value: unknown): void
    delete(key: string): boolean
  }
  interface DurableObjectStorage {
    readonly kv: DurableObjectSyncKv
    setAlarm(scheduledTime: number | Date): Promise<void>
    deleteAll(): Promise<void>
  }
  interface DurableObjectState {
    readonly storage: DurableObjectStorage
  }
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState
    protected env: Env
    constructor(ctx: DurableObjectState, env: Env)
  }
}

// workerd's streaming HTMLRewriter (lol-html), which cuts the data-free page into the composed shell (atlas decision
// 0160, PR B, owner decision 2026-10-16). Declared for the members the site uses; the repo does not
// pull in @cloudflare/workers-types.
interface HTMLRewriterContentOptions {
  html?: boolean
}
interface HTMLRewriterElement {
  tagName: string
  readonly removed: boolean
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): HTMLRewriterElement
  removeAttribute(name: string): HTMLRewriterElement
  before(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterElement
  after(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterElement
  prepend(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterElement
  append(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterElement
  replace(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterElement
  setInnerContent(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterElement
  remove(): HTMLRewriterElement
  removeAndKeepContent(): HTMLRewriterElement
  onEndTag(handler: (tag: HTMLRewriterEndTag) => void | Promise<void>): void
}
interface HTMLRewriterEndTag {
  name: string
  before(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterEndTag
  after(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterEndTag
  remove(): HTMLRewriterEndTag
}
interface HTMLRewriterTextChunk {
  readonly text: string
  readonly lastInTextNode: boolean
  readonly removed: boolean
  replace(content: string, options?: HTMLRewriterContentOptions): HTMLRewriterTextChunk
  remove(): HTMLRewriterTextChunk
}
interface HTMLRewriterElementHandlers {
  element?(element: HTMLRewriterElement): void | Promise<void>
  text?(chunk: HTMLRewriterTextChunk): void | Promise<void>
}
declare class HTMLRewriter {
  constructor()
  on(selector: string, handlers: HTMLRewriterElementHandlers): HTMLRewriter
  transform(response: Response): Response
}
