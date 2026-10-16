// The `ssrKnownAnswer` inputs of the server-render suites (atlas decision 0160, PR B, plan Step 6.2).
//
// @j0nathan-ll0yd/fixtures ships one `ssrKnownAnswer` variation per export. tests/behavioral/
// ssr-no-js.test.ts serves them through the fixture data plane and asserts the exact projection into
// each card. That proof only means something when (1) each file is a valid export, so the Worker's
// decoder admits it, and (2) its distinctive values occur in no other variation, so a match cannot
// come from some other fixture. The package ships no test for either property, so the site holds
// them here.
import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {ENDPOINTS, type ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'
import {decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import {BASELINE_BY_PATH, KNOWN_ANSWER_BY_PATH} from '../data-plane/baseline'

const TOKEN = /Kappa-77\d\d|ka-topic-kappa/i

function at(root: unknown, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((node, key) => (node == null ? undefined : (node as Record<string, unknown>)[key]), root)
}

function stringLeaves(node: unknown, into: string[] = []): string[] {
  if (typeof node === 'string') {
    into.push(node)
  } else if (Array.isArray(node)) {
    node.forEach((child) => stringLeaves(child, into))
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((child) => stringLeaves(child, into))
  }
  return into
}

/** The numeric fields the suite projects into cards, by export. Each must differ from every other variation. */
const NUMERIC_PROBES: Record<string, string[]> = {
  health: ['quantities.stepCount.value', 'quantities.activeEnergyBurned.value', 'quantities.dietaryWater.value', 'goals.moveKcal', 'goals.exerciseMin'],
  sleep: ['core.seconds', 'deep.seconds', 'rem.seconds'],
  'github-starred-repos': ['repos.0.stargazersCount', 'repos.1.stargazersCount'],
  workouts: ['workouts.0.duration', 'workouts.0.energyBurned', 'workouts.1.duration']
}

const keyOfPath = new Map(Object.entries(ENDPOINTS).map(([key, endpoint]) => [endpoint, key as ResourceKey]))

describe('ssrKnownAnswer inputs', () => {
  const entries = Object.entries(KNOWN_ANSWER_BY_PATH).map(([endpoint, file]) => ({
    key: keyOfPath.get(endpoint)!,
    file,
    directory: path.basename(path.dirname(file)),
    json: JSON.parse(readFileSync(file, 'utf8')) as unknown
  }))

  it('covers every export path', () => {
    expect(entries.map((entry) => entry.key).sort()).toEqual(Object.keys(ENDPOINTS).sort())
  })

  for (const {key, json} of entries) {
    it(`${key}: decodes against the published contract`, () => {
      expect(() => decodeArtifact(key, json)).not.toThrow()
    })
  }

  it('every token-bearing value occurs in no other variation of any domain', () => {
    const allFiles = entries.flatMap(({file}) => {
      const domainDir = path.dirname(path.dirname(file))
      return readdirSync(domainDir).flatMap((directory) => readdirSync(path.join(domainDir, directory)).map((name) => path.join(domainDir, directory, name)))
    })
    const known = new Set(entries.map((entry) => entry.file))
    const others = allFiles.filter((file) => file.endsWith('.json') && !known.has(file)).map((file) => readFileSync(file, 'utf8'))
    expect(others.length, 'other variation files').toBeGreaterThan(50)

    const distinctive = entries.flatMap(({json}) => stringLeaves(json).filter((value) => TOKEN.test(value)))
    expect(distinctive.length, 'token-bearing values').toBeGreaterThan(20)
    for (const value of distinctive) {
      for (const other of others) {
        expect(other, `"${value}" in another variation`).not.toContain(value)
      }
    }
  })

  for (const [directory, probes] of Object.entries(NUMERIC_PROBES)) {
    it(`${directory}: the projected numbers differ from every other variation at the same path`, () => {
      const entry = entries.find((candidate) => candidate.directory === directory)!
      const domainDir = path.dirname(entry.file)
      const siblings = readdirSync(domainDir).filter((name) => name.endsWith('.json') && path.join(domainDir, name) !== entry.file)
      expect(siblings.length).toBeGreaterThan(1)
      for (const probe of probes) {
        const value = at(entry.json, probe)
        expect(typeof value, `${directory}.${probe} in the known answer`).toBe('number')
        for (const name of siblings) {
          const sibling = JSON.parse(readFileSync(path.join(domainDir, name), 'utf8')) as unknown
          expect(at(sibling, probe), `${directory}.${probe} in ${name}`).not.toBe(value)
        }
      }
    })
  }

  it('the default answers are not the known answers', () => {
    for (const [endpoint, file] of Object.entries(BASELINE_BY_PATH)) {
      expect(file).not.toBe(KNOWN_ANSWER_BY_PATH[endpoint])
    }
  })
})
