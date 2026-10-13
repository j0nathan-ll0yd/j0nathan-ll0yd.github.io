import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  assertCompletedRun,
  classifyLycheeReport,
  CONNECTION_REFUSED_DETAIL,
  findingsFor,
  isConnectionRefused,
  issueNote,
  issueOutcome,
  writeIssueOutputs
} from '../checks/b5-lychee.mjs'

type LycheeEntry = {url: string; status: {text: string; code?: number; details?: string}}
type LycheeReport = {
  total: number
  successful: number
  errors: number
  timeouts: number
  excludes: number
  unknown: number
  unsupported: number
  error_map: Record<string, LycheeEntry[]>
  timeout_map: Record<string, LycheeEntry[]>
  excluded_map: Record<string, LycheeEntry[]>
}

function fixture(name: string): LycheeReport {
  return JSON.parse(readFileSync(resolve(`audits/__tests__/fixtures/lychee/${name}.json`), 'utf8'))
}

/** The weekly run that motivated the classifier, rebuilt from its job log. */
const WEEKLY_RUN = fixture('weekly-run-38428346533')
/** Real lychee 0.24.2 output over one refused, one DNS-failed, one 404, one green and one excluded link. */
const KNOWN_ANSWER = fixture('lychee-0.24.2-known-answer')

const refused = (url: string): LycheeEntry => ({
  url,
  status: {text: `Network error: ${CONNECTION_REFUSED_DETAIL} (error sending request for url (${url}))`, details: CONNECTION_REFUSED_DETAIL}
})

function synthetic(errors: LycheeEntry[], successful = 3, timeouts: LycheeEntry[] = []): LycheeReport {
  return {
    total: successful + errors.length + timeouts.length,
    successful,
    errors: errors.length,
    timeouts: timeouts.length,
    excludes: 0,
    unknown: 0,
    unsupported: 0,
    error_map: errors.length ? {'https://jonathanlloyd.me/': errors} : {},
    timeout_map: timeouts.length ? {'https://jonathanlloyd.me/': timeouts} : {},
    excluded_map: {}
  }
}

describe('classifyLycheeReport: weekly run 38428346533', () => {
  const result = classifyLycheeReport(WEEKLY_RUN)

  it('reads all 15 refusals as unmeasured and fails nothing', () => {
    expect(result.refused).toHaveLength(15)
    expect(new Set(result.refused.map((entry: LycheeEntry) => entry.url)).size).toBe(14)
    expect(result.failing).toEqual([])
    expect(issueOutcome(result)).toBe('indeterminate')
  })

  it('measures the 95 links that answered, and counts the 4 exclusions apart', () => {
    expect(result.measured).toBe(95)
    expect(result.passed).toBe(95)
    expect(result.excluded).toBe(4)
    expect(result.total).toBe(114)
  })

  it('names every refused host, the reason and the counts in the issue note', () => {
    const note = issueNote(result)
    for (const host of ['acaia.co', 'feedly.com', 'lifehacker.com', 'www.apple.com', 'www.livelarq.com', 'www.squarespace.com']) {
      expect(note).toContain(host)
    }
    expect(note).toContain('15 unmeasured (15 connection-refused')
    expect(note).toContain('egress-isolation.sh')
    expect(note).toContain('neither passes nor site failures')
    expect(note).toContain('**Excluded (4):**')
    expect(note).toContain('`https://www.linkedin.com/in/lifegames/`')
  })

  it('reports the refusals as a warning, never as a failing finding', () => {
    const findings = findingsFor(result)
    expect(findings.filter((f: {severity: string}) => f.severity === 'fail')).toEqual([])
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['links-unmeasured-connection-refused', 'links-excluded'])
  })
})

describe('classifyLycheeReport: real lychee 0.24.2 known answer', () => {
  const result = classifyLycheeReport(KNOWN_ANSWER)

  it('keeps a 404 and a DNS failure failing while a refusal is unmeasured', () => {
    expect(result.failing.map((entry: LycheeEntry) => entry.url).sort()).toEqual([
      'https://b5-no-such-host-zz9q.com/',
      'https://jonathanlloyd.me/b5-known-answer-404'
    ])
    expect(result.refused.map((entry: LycheeEntry) => entry.url)).toEqual(['http://127.0.0.1:1/'])
    expect(result.measured).toBe(3)
    expect(issueOutcome(result)).toBe('failure')
  })

  it('emits one failing finding per broken link', () => {
    const fails = findingsFor(result).filter((f: {severity: string}) => f.severity === 'fail')
    expect(fails).toHaveLength(2)
    expect(fails.map((f: {message: string}) => f.message).join('\n')).toContain('404 Not Found')
  })
})

describe('isConnectionRefused', () => {
  it('matches the exact lychee detail and nothing near it', () => {
    expect(isConnectionRefused(refused('https://feedly.com/'))).toBe(true)
    expect(isConnectionRefused({url: 'x', status: {text: CONNECTION_REFUSED_DETAIL}})).toBe(false)
    expect(isConnectionRefused({url: 'x', status: {text: 'e', details: 'Connection failed. Check network connectivity and firewall settings'}})).toBe(false)
    expect(isConnectionRefused({url: 'x', status: {text: 'e', details: `${CONNECTION_REFUSED_DETAIL} (cached)`}})).toBe(false)
    expect(isConnectionRefused(undefined)).toBe(false)
  })
})

describe('issueOutcome', () => {
  it('is success only for a wholly measured green run, and then says nothing', () => {
    const result = classifyLycheeReport(synthetic([]))
    expect(issueOutcome(result)).toBe('success')
    expect(issueNote(result)).toBe('')
  })

  it('lets one failing link dominate any number of refusals', () => {
    const result = classifyLycheeReport(
      synthetic([refused('https://a.example/'), {url: 'https://b.example/', status: {text: 'Rejected status code: 410 Gone', code: 410}}])
    )
    expect(issueOutcome(result)).toBe('failure')
  })

  it('fails a timeout, as lychee did before', () => {
    const result = classifyLycheeReport(synthetic([], 2, [{url: 'https://slow.example/', status: {text: 'Timeout'}}]))
    expect(result.failing).toHaveLength(1)
    expect(issueOutcome(result)).toBe('failure')
  })

  it('publishes 0 measured when the floor refused every link, so the tier wedges', () => {
    const result = classifyLycheeReport(synthetic([refused('https://a.example/'), refused('https://b.example/')], 0))
    expect(result.measured).toBe(0)
    expect(issueOutcome(result)).toBe('indeterminate')
  })

  it('reads an empty run as indeterminate with 0 measured', () => {
    const result = classifyLycheeReport(synthetic([], 0))
    expect(result.measured).toBe(0)
    expect(issueOutcome(result)).toBe('indeterminate')
  })

  it('reads a link lychee could not judge as unmeasured, not green', () => {
    const report = {...synthetic([]), unknown: 1, total: 4}
    const result = classifyLycheeReport(report)
    expect(result.otherUnmeasured).toBe(1)
    expect(issueOutcome(result)).toBe('indeterminate')
  })
})

describe('report integrity', () => {
  it('throws when a map disagrees with its total', () => {
    expect(() => classifyLycheeReport({...synthetic([refused('https://a.example/')]), errors: 2, total: 5})).toThrow(/disagree/)
  })

  it('throws when the classes do not sum to the total', () => {
    expect(() => classifyLycheeReport({...synthetic([]), total: 9})).toThrow(/account for every link/)
  })

  it('throws on a report that is not lychee JSON', () => {
    expect(() => classifyLycheeReport({})).toThrow(TypeError)
  })
})

describe('assertCompletedRun', () => {
  it('accepts 0 and 2, and an absent code outside Actions', () => {
    for (const code of ['0', '2', '', undefined]) {
      expect(() => assertCompletedRun(code)).not.toThrow()
    }
  })

  it('rejects a configuration error and a panic', () => {
    expect(() => assertCompletedRun('1')).toThrow(/lychee exited 1/)
    expect(() => assertCompletedRun('101')).toThrow(/lychee exited 101/)
  })
})

describe('writeIssueOutputs', () => {
  it('writes the tri-state and a delimited multi-line note to GITHUB_OUTPUT', () => {
    const written: string[] = []
    writeIssueOutputs(classifyLycheeReport(WEEKLY_RUN), {outputPath: '/dev/null', append: (_path: string, text: string) => written.push(text)})
    const [text] = written
    expect(text.startsWith('issue_outcome=indeterminate\nissue_note<<')).toBe(true)
    const delimiter = /issue_note<<(\S+)\n/.exec(text)?.[1]
    expect(delimiter).toBeTruthy()
    expect(text.endsWith(`\n${delimiter}\n`)).toBe(true)
    expect(text).toContain('15 connection-refused')
  })

  it('is a no-op outside Actions', () => {
    const written: string[] = []
    writeIssueOutputs(classifyLycheeReport(WEEKLY_RUN), {outputPath: undefined, append: (_path: string, text: string) => written.push(text)})
    expect(written).toEqual([])
  })
})
