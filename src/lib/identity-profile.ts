import {identity, profile as profileCopy} from '@j0nathan-ll0yd/copy'

/**
 * The authored identity content of `/`: the identity card and the bio terminal.
 *
 * Every string comes from `@j0nathan-ll0yd/copy` (atlas decision 0160 Step 1.7):
 * name, title, bio and the two profile links from `identity.person`, the tagline
 * and the terminal blocks from `profile`. This is the only real content the
 * data-free page carries; it is authored, not measured, so it renders with
 * JavaScript off. No location field is read here (decision 0160 D14).
 */
export interface IdentityProfile {
  /** IdentityCard's `profile` prop. */
  card: {name: string; title: string; bio: string; tagline: string; github: string; linkedin: string}
  /** BioTerminal's `profile` prop. */
  terminal: {terminalLines: TerminalLine[]}
}

/** One BioTerminal line. The design system exports no Props types, so the shape is restated; `astro check` holds it to the component. */
export interface TerminalLine {
  type: 'cursor' | 'blank' | 'prompt' | 'output'
  text: string
}

/**
 * The bio terminal from the copy's command blocks. Each block is its prompt line
 * then its output lines; a blank line separates blocks, in the copy's key order,
 * and the blinking cursor ends the sequence.
 */
export function terminalLinesFromBlocks<T extends { readonly [K in keyof T]: readonly string[] }>(terminal: T): TerminalLine[] {
  // A mapped copy of the block map is an object type literal, so Object.entries can read it.
  const blocks: { readonly [K in keyof T]: readonly string[] } = terminal
  const lines: TerminalLine[] = []
  Object.entries<readonly string[]>(blocks).forEach(([name, block], i) => {
    const [prompt, ...output] = block
    if (prompt === undefined) {
      throw new Error(`profile copy: terminal block "${name}" has no prompt line`)
    }
    if (i > 0) {
      lines.push({type: 'blank', text: ''})
    }
    lines.push({type: 'prompt', text: prompt})
    output.forEach((text) => lines.push({type: 'output', text}))
  })
  lines.push({type: 'cursor', text: ''})
  return lines
}

/** The `identity.person.sameAs` link on `host`; a missing link fails the build. */
export function profileLink(sameAs: readonly string[], host: string): string {
  const url = sameAs.find((u) => {
    const hostname = new URL(u).hostname
    return hostname === host || hostname.endsWith('.' + host)
  })
  if (!url) {
    throw new Error(`identity copy: no ${host} link in person.sameAs`)
  }
  return url
}

export function identityProfile(): IdentityProfile {
  const person = identity.person
  return {
    card: {
      name: person.name,
      title: person.jobTitle,
      bio: person.flavorBio,
      tagline: profileCopy.tagline,
      github: profileLink(person.sameAs, 'github.com'),
      linkedin: profileLink(person.sameAs, 'linkedin.com')
    },
    terminal: {terminalLines: terminalLinesFromBlocks(profileCopy.terminal)}
  }
}
