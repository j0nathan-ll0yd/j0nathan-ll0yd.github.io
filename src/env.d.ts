/// <reference types="astro/client" />

// The Worker bindings and variables (atlas decision 0160, PR B). The server render reads only
// DATA_PLANE_BASE and SSR_FAULT_INJECTION (src/lib/data-plane/request.ts); the repo does not pull
// in @cloudflare/workers-types for one import.
declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>>
}

// workerd's streaming HTMLRewriter (lol-html), the edge injection's only HTML writer (atlas decision
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
