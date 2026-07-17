import { describe, it, expect } from 'vitest';
import { validateHeaders } from '../../scripts/audit/check-headers.mjs';

const GOLDEN_CSP = "default-src 'self'; script-src 'self';";
const TRUSTED_TYPES = "require-trusted-types-for 'script'; report-uri /api/csp-report; report-to csp-endpoint";

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    'content-security-policy': GOLDEN_CSP,
    'content-security-policy-report-only': TRUSTED_TYPES,
    ...overrides,
  });
}

describe('validateHeaders', () => {
  it('a live CSP matching the golden, with Trusted Types present, produces zero findings', () => {
    expect(validateHeaders(headers(), GOLDEN_CSP)).toEqual([]);
  });

  it('a missing CSP header fails', () => {
    const h = new Headers({ 'content-security-policy-report-only': TRUSTED_TYPES });
    const findings = validateHeaders(h, GOLDEN_CSP);
    expect(findings.map((f) => f.id)).toContain('headers-csp-missing');
  });

  it('known-answer: a CSP that drifted from the golden fails, quoting both values', () => {
    const findings = validateHeaders(headers({ 'content-security-policy': "default-src 'none';" }), GOLDEN_CSP);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('headers-csp-drift');
    expect(findings[0].message).toContain("default-src 'none'");
    expect(findings[0].message).toContain(GOLDEN_CSP);
  });

  it('a missing Trusted Types report-only directive fails', () => {
    const findings = validateHeaders(headers({ 'content-security-policy-report-only': '' }), GOLDEN_CSP);
    expect(findings.map((f) => f.id)).toContain('headers-trusted-types-missing');
  });
});
