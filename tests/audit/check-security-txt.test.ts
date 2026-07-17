import { describe, it, expect } from 'vitest';
import { validateSecurityTxt } from '../../scripts/audit/check-security-txt.mjs';

const NOW = new Date('2026-07-16T00:00:00.000Z');

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

describe('validateSecurityTxt', () => {
  it('known-answer: Expires 20 days out fails the 30-day threshold', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(20)}\n`;
    const findings = validateSecurityTxt(body, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('security-txt-expiring-soon');
  });

  it('Expires comfortably in the future (matching the live 2027-06-18 value) passes clean', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(400)}\n`;
    expect(validateSecurityTxt(body, NOW)).toEqual([]);
  });

  it('Expires in the past fails as expired, not merely "expiring soon"', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(-5)}\n`;
    const findings = validateSecurityTxt(body, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('security-txt-expired');
  });

  it('a missing Expires field fails distinctly from an expiring one', () => {
    const findings = validateSecurityTxt('Contact: mailto:security@example.com\n', NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('security-txt-expires-missing');
  });

  it('an unparseable Expires value fails distinctly', () => {
    const findings = validateSecurityTxt('Expires: not-a-date\n', NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('security-txt-expires-unparseable');
  });

  it('a missing Contact field is a warn, not a fail', () => {
    const findings = validateSecurityTxt(`Expires: ${daysFromNow(400)}\n`, NOW);
    expect(findings).toEqual([
      expect.objectContaining({ severity: 'warn', id: 'security-txt-contact-missing' }),
    ]);
  });

  it('exactly at the 30-day boundary still fails (threshold is inclusive of "below")', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(29)}\n`;
    const findings = validateSecurityTxt(body, NOW);
    expect(findings.map((f) => f.id)).toContain('security-txt-expiring-soon');
  });
});
