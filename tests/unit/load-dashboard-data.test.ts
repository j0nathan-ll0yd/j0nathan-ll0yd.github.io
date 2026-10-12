// @vitest-environment node
//
// The build-time loader of the data-free `/` (atlas decision 0160, PR 0a) and its identity helper.
// The built page is asserted in tests/build/data-free-index.test.ts; these pin the helpers' own
// contracts so a design-system or copy release that changes a shape fails here, by name.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {identity, profile} from '@j0nathan-ll0yd/copy'
import {identityProfile, profileLink, terminalLinesFromBlocks} from '../../src/lib/identity-profile'
import {loadDashboardData, loadingSystemLines, mirroredBookCovers} from '../../src/lib/load-dashboard-data'

describe('identityProfile', () => {
  it('reads every identity string from the copy package', () => {
    const {card} = identityProfile()
    expect(card).toEqual({
      name: identity.person.name,
      title: identity.person.jobTitle,
      bio: identity.person.flavorBio,
      tagline: profile.tagline,
      github: 'https://github.com/j0nathan-ll0yd',
      linkedin: 'https://www.linkedin.com/in/lifegames/'
    })
    // D14: no location field reaches the page.
    expect(Object.keys(card)).not.toContain('location')
  })

  it('builds the terminal from the copy blocks: prompt, outputs, a blank between blocks, then the cursor', () => {
    const lines = identityProfile().terminal.terminalLines
    // The display order is the copy's key order (copy 3.3.0 profile.terminal).
    const t = profile.terminal
    const blocks: readonly (readonly string[])[] = [t.gpg, t.stack, t.uptime, t.philosophy, t.interests]
    expect(lines.filter((l) => l.type === 'prompt').map((l) => l.text)).toEqual(blocks.map((b) => b[0]))
    expect(lines.filter((l) => l.type === 'blank')).toHaveLength(blocks.length - 1)
    expect(lines.at(-1)).toEqual({type: 'cursor', text: ''})
    expect(lines[0]).toEqual({type: 'prompt', text: '$ gpg -k'})
  })

  it('fails loudly on a terminal block with no prompt line', () => {
    expect(() => terminalLinesFromBlocks({empty: []})).toThrow(/terminal block "empty" has no prompt line/)
  })

  it('matches a profile link by host, never by substring', () => {
    expect(profileLink(['https://www.github.com/x'], 'github.com')).toBe('https://www.github.com/x')
    expect(() => profileLink(['https://notgithub.com/x'], 'github.com')).toThrow(/no github.com link/)
  })
})

describe('loadingSystemLines', () => {
  it('renders one row per source with the no-reading mark and nothing that claims a status', () => {
    const rows = loadingSystemLines()
    expect(rows.map((r) => r.source)).toEqual(['health', 'sleep', 'books', 'articles', 'githubEvents', 'starredRepos', 'theatreReviews'])
    for (const row of rows) {
      // The exact key set: a field the design system adds to its non-data row must be looked at
      // before it reaches the data-free page.
      expect(Object.keys(row).sort()).toEqual(['dotClass', 'key', 'keyClass', 'source', 'valClass', 'value'])
      expect(row.value).toBe('—')
      expect(row.dotClass).toBe('')
    }
  })
})

describe('mirroredBookCovers', () => {
  it('lists the committed mirror as sorted root-relative paths, skipping dot files', () => {
    const root = mkdtempSync(join(tmpdir(), 'covers-'))
    try {
      mkdirSync(join(root, 'images', 'books'), {recursive: true})
      for (const name of ['b-card.webp', 'a.webp', '.DS_Store']) {
        writeFileSync(join(root, 'images', 'books', name), '')
      }
      expect(mirroredBookCovers(root)).toEqual(['/images/books/a.webp', '/images/books/b-card.webp'])
    } finally {
      rmSync(root, {recursive: true, force: true})
    }
  })
})

describe('loadDashboardData', () => {
  it('returns identity, value-free rows and the cover mirror, and no data domain', () => {
    const data = loadDashboardData()
    expect(Object.keys(data).sort()).toEqual(['localCovers', 'profile', 'system'])
    expect(data.localCovers.length).toBeGreaterThan(0)
    expect(data.localCovers.every((path) => path.startsWith('/images/books/'))).toBe(true)
  })
})
