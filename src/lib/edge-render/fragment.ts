// Fills value-free template markup through HTMLRewriter (atlas decision 0160, PR B; owner decision
// 2026-10-16, option B).
//
// The edge writes every export value through HTMLRewriter's text and attribute APIs, which escape it
// (text) or are given an encoded value (attributes, see setAttribute). No value is ever placed in an
// HTML string. A template is markup the design system's own component rendered at build time from
// value-free stand-in data (src/pages/ssr-templates.astro); a fill pass writes the real values into
// its slots and keeps everything else byte for byte, whitespace included.

/** Registers the handlers of one fill pass. */
export type FillHandlers = (rewriter: HTMLRewriter) => HTMLRewriter

/** The template with its values written. */
export function fillFragment(html: string, handlers: FillHandlers): Promise<string> {
  return handlers(new HTMLRewriter()).transform(new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}})).text()
}

/**
 * Sets an attribute to exactly `value`. lol-html escapes `"` in an attribute value but writes `&`
 * as is (measured in workerd), so a value holding `&amp;` or `&lt;` would reach the browser decoded,
 * as a different value. `&` is therefore encoded here, first; the rewriter then escapes the quotes.
 * Every attribute the edge writes goes through this function.
 */
export function setAttribute(element: HTMLRewriterElement, name: string, value: string): void {
  element.setAttribute(name, value.replaceAll('&', '&amp;'))
}

/** Sets an attribute (see setAttribute), or removes it for null. */
export function setOptionalAttribute(element: HTMLRewriterElement, name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) {
    element.removeAttribute(name)
  } else {
    setAttribute(element, name, value)
  }
}

/** Splits a template text node into its padding and its stand-in value. */
function padding(text: string): {lead: string; trail: string} {
  const lead = /^\s*/.exec(text)?.[0] ?? ''
  if (lead.length === text.length) {
    return {lead: text, trail: ''}
  }
  return {lead, trail: /\s*$/.exec(text)?.[0] ?? ''}
}

/**
 * Handlers that write `value` as the text of a slot element and keep the template's padding. Astro
 * compresses a template's whitespace when it compiles it, so a value written on its own source line
 * renders as ` value ` and an empty one as `  `; the template rendered a non-empty stand-in, so its
 * text node shows exactly that padding. The value is escaped (`replace` without `html`).
 *
 * `value` may be a function of the slot's index, for a selector that matches several elements.
 */
export function textSlot(value: string | ((index: number) => string)): HTMLRewriterElementHandlers {
  let index = -1
  let written = false
  return {
    element() {
      index++
      written = false
    },
    text(chunk) {
      if (written) {
        if (chunk.text !== '') {
          chunk.remove()
        }
        return
      }
      if (chunk.text === '') {
        return
      }
      const {lead, trail} = padding(chunk.text)
      chunk.replace(lead + (typeof value === 'function' ? value(index) : value) + trail)
      written = true
    }
  }
}

/** A text slot that also writes the element's attributes. */
export function slotWith(slot: HTMLRewriterElementHandlers, element: (el: HTMLRewriterElement) => void): HTMLRewriterElementHandlers {
  return {
    element(el) {
      element(el)
      return slot.element?.(el)
    },
    text: slot.text
  }
}
