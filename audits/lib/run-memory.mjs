// audits/lib/run-memory.mjs -- one bit of memory between two daily runs of a check.
//
// WHY. Plan Step 6.8 item 7 fails a `partial` page only on the SECOND consecutive run, so one
// upstream blip never pages the owner. A scheduled check has no state of its own, and the
// self-hosted runners keep no cache between jobs. The memory lives in the body of one open GitHub
// issue labelled `audit:state`, found by its exact title. It is NOT a finding: the managed-issue
// reconciler (file-check-issues.mjs) still owns every finding issue.
//
// The state issue is written through the REST API with the job's own GITHUB_TOKEN (`issues: write`).
// Without a token or repository (a workstation run) the memory is `unavailable`, and the caller
// must treat an unavailable memory as "no earlier sighting provable": fail loud, never stay quiet.

const API = 'https://api.github.com'
const STATE_LABEL = 'audit:state'
const MARKER = /<!-- audit-run-memory:v1 key=([A-Za-z0-9_-]+) value=([^ ]*) -->/

function markerFor(key, value) {
  return `<!-- audit-run-memory:v1 key=${key} value=${value} -->`
}

function headers(token) {
  return {accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28'}
}

/**
 * @param {{key: string, title: string, token?: string, repo?: string, fetchImpl?: typeof fetch}} options
 * `key` names the memory slot (letters, digits, `_`, `-`). `title` is the state issue's exact title.
 * @returns {{read(): Promise<{available: boolean, value: string|null}>, write(value: string): Promise<boolean>}}
 */
export function createRunMemory({key, title, token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY, fetchImpl = fetch}) {
  const usable = Boolean(token && repo)

  async function find() {
    const res = await fetchImpl(`${API}/repos/${repo}/issues?state=open&labels=${encodeURIComponent(STATE_LABEL)}&per_page=100`, {
      headers: headers(token),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) {
      throw new Error(`state issue list returned HTTP ${res.status}`)
    }
    const issues = await res.json()
    return issues.find((issue) => issue.title === title && !issue.pull_request) ?? null
  }

  return {
    async read() {
      if (!usable) {
        return {available: false, value: null}
      }
      try {
        const issue = await find()
        const match = issue ? MARKER.exec(issue.body ?? '') : null
        return {available: true, value: match && match[1] === key ? match[2] : null}
      } catch {
        return {available: false, value: null}
      }
    },
    async write(value) {
      if (!usable) {
        return false
      }
      const body = `${markerFor(key, value)}\n\nMemory slot for a scheduled audit check. Machine-owned: do not edit or close.`
      try {
        const issue = await find()
        const res = issue
          ? await fetchImpl(`${API}/repos/${repo}/issues/${issue.number}`, {
            method: 'PATCH',
            headers: headers(token),
            body: JSON.stringify({body}),
            signal: AbortSignal.timeout(10_000)
          })
          : await fetchImpl(`${API}/repos/${repo}/issues`, {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({title, body, labels: [STATE_LABEL]}),
            signal: AbortSignal.timeout(10_000)
          })
        return res.ok
      } catch {
        return false
      }
    }
  }
}
