// The fragment allowlist's seeded mutation corpus and its parse5 tree check (atlas decision 0160,
// PR B; review 2026-10-16, N2), shared by tests/unit/composed-fragment.property.test.ts (the Worker's
// allowlist on the composed artifact) and tests/build/value-free-module.test.ts (the build's gate on
// the value-free pages it compiles into the Worker, atlas decision 0164 row 1). A token corpus that
// breaks out of, swallows, reparents or scripts a fragment; a mutator that inserts tokens at tag
// boundaries or anywhere; and `treeProblems`, which splices a fragment into a slot of a whole page and
// reads it with parse5 (the WHATWG tree builder).
import fc from 'fast-check'
import {type DefaultTreeAdapterMap, parse} from 'parse5'
import {COMPOSED_FRAGMENT_IDS} from '../../src/lib/composed/artifact'
import {ARIA_ATTRIBUTES, DATA_ATTRIBUTES, HTML_ELEMENTS, SVG_ELEMENTS} from '../../src/lib/composed/fragment-policy'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'
/** The attributes any allowed HTML element may carry (fragment-policy.ts GLOBAL_ATTRIBUTES). */
const GLOBAL = new Set(['class', 'id', 'hidden', 'role', 'tabindex', 'style'])
export const CARRIER: Readonly<Record<string, string>> = {cardHydration: 'cardHydrationData'}

/** Tokens that break out of, swallow, reparent or script a fragment, and a few benign ones. */
export const TOKENS = [
  '<plaintext>',
  '<!--',
  '-->',
  '<!-- x -->',
  '<textarea>',
  '</textarea>',
  '<script>alert(1)</script>',
  '<style>*{}</style>',
  '<title>',
  '<xmp>',
  '<noscript>',
  '<template>',
  '<iframe srcdoc="&lt;script&gt;x&lt;/script&gt;">',
  '<form action="https://evil.example/">',
  '<math>',
  '<table>',
  '<tr>',
  '<select>',
  '<option>',
  '<frameset>',
  '<body>',
  '<html>',
  '<head>',
  '<![CDATA[x]]>',
  '<?x?>',
  '<!DOCTYPE html>',
  '</div>',
  '<div>',
  '</p>',
  '<p>',
  '</span>',
  '<span>',
  '</a>',
  '<a href="https://github.com/x">',
  '<a href="/x">',
  '<button>',
  '</button>',
  '<h2>',
  '</h2>',
  '<li>',
  '</li>',
  '<ul>',
  '</ul>',
  '<svg>',
  '</svg>',
  '<foreignObject>',
  '<svg viewBox="0 0 1 1"><path d="M0 0"></path></svg>',
  '<picture>',
  '<source srcset="/images/a.webp">',
  '<img src="/images/no-cover.svg" alt="">',
  '<br>',
  '<br/>',
  '<div/>',
  '<time>',
  ' onclick="alert(1)"',
  ' style="position:fixed;inset:0"',
  ' style="width: 10px"',
  ' popover',
  ' id="cardSystem"',
  ' id="x1"',
  ' class="glitch-page"',
  ' class="tri-card"',
  ' data-astro-cid-zzzzzzzz',
  ' hidden',
  ' aria-label="x"',
  '"',
  "'",
  '>',
  '<',
  '/>',
  '&',
  '&#60;',
  '&lt;',
  '\u0000',
  '\r',
  '\f',
  ' ',
  'Known Answer Kappa-7731',
  '<span></span>',
  '<p></p>',
  '<div></div>',
  '<span class="dot"></span>',
  // Closed pairs: what the tokenizer reads as well-formed but a browser may not.
  '<plaintext></plaintext>',
  '<textarea></textarea>',
  '<title></title>',
  '<xmp></xmp>',
  '<noscript></noscript>',
  '<template></template>',
  '<iframe></iframe>',
  '<math></math>',
  '<table></table>',
  '<table><div></div></table>',
  '<select></select>',
  '<option></option>',
  '<form></form>',
  '<li></li>',
  '<ul><li></li></ul>',
  '<a href="/x"></a>',
  '<a href="/x"><a href="/y"></a></a>',
  '<button></button>',
  '<button><button></button></button>',
  '<li><li></li></li>',
  '<ul><li><li></li></li></ul>',
  '<a href="/x"><div></div></a>',
  '<h2></h2>',
  '<h2><h3></h3></h2>',
  '<p><div></div></p>',
  '<p><p></p></p>',
  '<p><a href="/x"><div></div></a></p>',
  '<p><a href="/x"><ul></ul></a></p>',
  '<p><ul></ul></p>',
  '<span><div></div></span>',
  '<svg></svg>',
  '<svg><div></div></svg>',
  '<svg><p></p></svg>',
  '<svg><circle></circle></svg>',
  '<svg><foreignObject><div></div></foreignObject></svg>',
  '<picture><source srcset="/images/a.webp"><img src="/images/a.webp" alt=""></picture>',
  '<source srcset="/images/a.webp">',
  '<time datetime="2026-01-01"></time>'
]

const ALLOWED_ELEMENTS = {[HTML_NS]: new Set(Object.keys(HTML_ELEMENTS)), [SVG_NS]: new Set(Object.keys(SVG_ELEMENTS))}

function isElement(node: Node): node is Element {
  return 'tagName' in node
}

function attributeAllowed(element: Element, name: string): boolean {
  if (/^data-astro-cid-[a-z0-9]+$/.test(name) || ARIA_ATTRIBUTES.has(name)) {
    return true
  }
  if (element.namespaceURI === SVG_NS) {
    return name === 'id' || name === 'role' || SVG_ELEMENTS[element.tagName]?.has(name) === true
  }
  return GLOBAL.has(name) || DATA_ATTRIBUTES.has(name) || HTML_ELEMENTS[element.tagName]?.has(name) === true
}

/** Every reason the parsed slot is not an allowlisted tree with the right root; empty when it is. */
export function treeProblems(html: string, id: string): string[] {
  const doc = parse(`<!DOCTYPE html><html><head></head><body><div id="slot">${html}</div><p id="after"></p></body></html>`)
  const htmlElement = doc.childNodes.find(isElement)
  const body = htmlElement?.childNodes.filter(isElement).find((node) => node.tagName === 'body')
  const bodyElements = body?.childNodes.filter(isElement) ?? []
  const slot = bodyElements[0]
  const after = bodyElements[1]
  const problems: string[] = []
  if (slot?.tagName !== 'div' || slot.attrs.find((a) => a.name === 'id')?.value !== 'slot') {
    return ['the slot is gone']
  }
  if (bodyElements.length !== 2 || after?.tagName !== 'p' || after.attrs.find((a) => a.name === 'id')?.value !== 'after') {
    problems.push('the page after the slot changed')
  }
  const top = slot.childNodes.filter((node) => !(node.nodeName === '#text' && 'value' in node && /^[ \t\n\r\f]*$/.test(node.value)))
  const [root, carrier, ...rest] = top
  if (root === undefined || !isElement(root) || root.attrs.find((a) => a.name === 'id')?.value !== id) {
    problems.push('the first node is not the root with the fragment id')
  }
  const carrierId = CARRIER[id]
  if (carrier !== undefined && (carrierId === undefined || !isElement(carrier) || carrier.attrs.find((a) => a.name === 'id')?.value !== carrierId)) {
    problems.push('a second top-level node that is not the carrier')
  }
  if (rest.length > 0) {
    problems.push('more than two top-level nodes')
  }
  const walk = (node: Node): void => {
    if (node.nodeName === '#comment') {
      problems.push('a comment')
    }
    if (isElement(node)) {
      if (!ALLOWED_ELEMENTS[node.namespaceURI as keyof typeof ALLOWED_ELEMENTS]?.has(node.tagName)) {
        problems.push(`element ${node.namespaceURI} ${node.tagName}`)
      }
      for (const attr of node.attrs) {
        // A prefixed attribute (`xlink:href`) is foreign-content syntax no component emits.
        if ((attr.prefix ?? '') !== '' || !attributeAllowed(node, attr.name)) {
          problems.push(`attribute ${node.tagName} ${attr.name}`)
        }
      }
    }
    for (const child of 'childNodes' in node ? node.childNodes : []) {
      walk(child)
    }
  }
  for (const node of top) {
    walk(node)
  }
  // The browser built the tree the tokenizer read: nothing reparented, closed early or swallowed.
  const parsed = parsedShape(slot.childNodes)
  const expected = sourceShape(html)
  if (parsed !== expected) {
    problems.push(`tree differs: parse5 ${parsed.slice(0, 160)} vs source ${expected.slice(0, 160)}`)
  }
  return problems
}

const VOID = new Set(['img', 'source', 'br'])
const TAG = /<\/([A-Za-z][A-Za-z0-9]*)>|<([A-Za-z][A-Za-z0-9]*)((?:[ \t\n]+[^\s"'<>\/=]+(?:="[^"]*")?)*)[ \t\n]*(\/?)>/g

/**
 * The element tree as the source spells it: each start tag opens a child of the open element, each
 * end tag closes it. Only for admitted fragments, which are well-formed by construction. Shape only:
 * tag names and attribute names, no text.
 */
export function sourceShape(html: string): string {
  let out = ''
  const stack: {name: string; svg: boolean}[] = []
  for (const match of html.matchAll(TAG)) {
    if (match[1] !== undefined) {
      stack.pop()
      out += ')'
      continue
    }
    const name = match[2] ?? ''
    const svg = name === 'svg' || stack.at(-1)?.svg === true
    const attrs = [...(match[3] ?? '').matchAll(/([^\s"'<>\/=]+)(?:="[^"]*")?/g)].map((a) => (a[1] ?? '').toLowerCase()).sort()
    out += `(${name}[${attrs.join(',')}]`
    if ((!svg && VOID.has(name)) || (svg && match[4] === '/')) {
      out += ')'
    } else {
      stack.push({name, svg})
    }
  }
  return out
}

/** The same shape of what parse5 built. */
export function parsedShape(nodes: Node[]): string {
  return nodes.filter(isElement).map((node) =>
    `(${node.tagName}[${node.attrs.map((a) => a.name.toLowerCase()).sort().join(',')}]${parsedShape(node.childNodes)})`
  ).join('')
}

/** Indices where a token lands on a tag boundary (before `<`, after `>`) or anywhere. */
export function boundaries(fragment: string): number[] {
  const at: number[] = [0, fragment.length]
  for (let i = 0; i < fragment.length; i++) {
    if (fragment[i] === '<') {
      at.push(i)
    } else if (fragment[i] === '>') {
      at.push(i + 1)
    }
  }
  return at
}

export const mutation = fc.record({
  id: fc.constantFrom(...COMPOSED_FRAGMENT_IDS),
  edits: fc.array(fc.record({token: fc.constantFrom(...TOKENS), where: fc.nat(), onBoundary: fc.boolean()}), {minLength: 1, maxLength: 4})
})

/** The fragment with each edit's token inserted: at a tag boundary, or at any index. */
export function mutateFragment(source: string, edits: {token: string; where: number; onBoundary: boolean}[]): string {
  let fragment = source
  for (const {token, where, onBoundary} of edits) {
    const points = onBoundary ? boundaries(fragment) : null
    const at = points === null ? where % (fragment.length + 1) : (points[where % points.length] ?? 0)
    fragment = fragment.slice(0, at) + token + fragment.slice(at)
  }
  return fragment
}
