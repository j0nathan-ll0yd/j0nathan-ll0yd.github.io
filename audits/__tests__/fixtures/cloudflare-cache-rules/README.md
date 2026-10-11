# Cloudflare cache-rule fixtures: provenance

These files are RECONSTRUCTED. They are not raw recordings of Cloudflare responses.

Source: the orchestrator's measurements of 2026-10-11 against the live zone, made with an
account-owned read-all token. The status codes and the error messages come from those
measurements. The audit token gets HTTP 403 on every read, so nobody can capture raw answers
from CI.

Omitted or invented fields:

- Error objects carry only `message`, except Page Rules, which also carries `code: 1011`
  (cloudflare/cloudflare-docs issue 23256). Cloudflare documents no code for "not allowed at
  account level" or "could not find entrypoint ruleset". No code is invented for them.
- `messages` is `[]` and `result` is `null` in every error body. The real bodies may hold more.
- No response headers, `result_info`, or request IDs are recorded.
- `zone-request-entrypoint.200.json`: the ruleset envelope (`id: ruleset-id`, `version: 14`,
  timestamps, rule `id`, `ref`, `version`) is placeholder data. The rules at index 3 (4th rule) and index 6 (7th rule) are rebuilt from
  the measured facts (catch-all `true` with edge and browser TTL overrides, later a bypass of the
  five gated paths). The other five rules are plausible disjoint neighbours, not verbatim.
- `page-rules-empty.200.json`: a plausible empty success body, not a measured one.
- `auth.403.json`: the message `Authentication error` is the measured text.
