// Fills a value-free markup fragment through HTMLRewriter (atlas decision 0160, PR B).
//
// The edge injection writes every export value through HTMLRewriter's text and attribute APIs
// (`setInnerContent` without `html`, `setAttribute`), which escape it. No value is ever placed in an
// HTML string. A fragment that needs values (a list item, a stale "as of" time) starts as markup
// the design system produced with no data in it, and this pass writes the values into it.

/** Registers the handlers of one fill pass. */
export type FillHandlers = (rewriter: HTMLRewriter) => HTMLRewriter

/** The fragment with its values written. */
export function fillFragment(html: string, handlers: FillHandlers): Promise<string> {
  return handlers(new HTMLRewriter()).transform(new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}})).text()
}

/** Writes `text` as an element's only content, escaped. */
export function setText(element: HTMLRewriterElement, text: string): void {
  element.setInnerContent(text)
}

/** Sets an attribute, or removes it for null. */
export function setOptionalAttribute(element: HTMLRewriterElement, name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) {
    element.removeAttribute(name)
  } else {
    element.setAttribute(name, value)
  }
}
