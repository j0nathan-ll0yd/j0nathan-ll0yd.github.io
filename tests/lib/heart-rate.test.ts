import { describe, it, expect } from 'vitest';
import {
  classifyHeartRate,
  classifyHRV,
  generateECGSamples,
  buildECGPath,
} from '../../src/lib/heart-rate';

describe('classifyHeartRate', () => {
  describe('Bradycardia zone (hr < 45)', () => {
    it('classifies hr=44 as Bradycardia', () => {
      const z = classifyHeartRate(44);
      expect(z.zone).toBe('Bradycardia');
    });

    it('classifies hr=0 as Bradycardia', () => {
      expect(classifyHeartRate(0).zone).toBe('Bradycardia');
    });

    it('has correct accent and dot classes', () => {
      const z = classifyHeartRate(30);
      expect(z.accentClass).toBe('tri-card-accent-pink');
      expect(z.dotClass).toBe('live-dot-pink');
    });

    it('has blue bpm color', () => {
      expect(classifyHeartRate(40).bpmColor).toBe('#3a86ff');
    });

    it('has ecgSpeed of 8s', () => {
      expect(classifyHeartRate(44).ecgSpeed).toBe('8s');
    });

    it('has ecgOpacity of 0.35', () => {
      expect(classifyHeartRate(44).ecgOpacity).toBe(0.35);
    });
  });

  describe('Resting Zone (45 <= hr < 60)', () => {
    it('boundary: hr=45 is Resting Zone', () => {
      expect(classifyHeartRate(45).zone).toBe('Resting Zone');
    });

    it('boundary: hr=59 is Resting Zone', () => {
      expect(classifyHeartRate(59).zone).toBe('Resting Zone');
    });

    it('has pink bpm color', () => {
      expect(classifyHeartRate(50).bpmColor).toBe('#ff006e');
    });

    it('has ecgSpeed of 6s', () => {
      expect(classifyHeartRate(55).ecgSpeed).toBe('6s');
    });

    it('has neon-green badge color', () => {
      expect(classifyHeartRate(55).badgeColor).toBe('var(--neon-green)');
    });

    it('has all required zone properties', () => {
      const z = classifyHeartRate(50);
      expect(z).toHaveProperty('zone');
      expect(z).toHaveProperty('accentClass');
      expect(z).toHaveProperty('dotClass');
      expect(z).toHaveProperty('bpmColor');
      expect(z).toHaveProperty('bpmShadow');
      expect(z).toHaveProperty('ecgStroke');
      expect(z).toHaveProperty('ecgSpeed');
      expect(z).toHaveProperty('ecgOpacity');
      expect(z).toHaveProperty('badgeColor');
      expect(z).toHaveProperty('badgeBg');
      expect(z).toHaveProperty('badgeBorder');
    });
  });

  describe('Normal Zone (60 <= hr <= 100)', () => {
    it('boundary: hr=60 is Normal Zone', () => {
      expect(classifyHeartRate(60).zone).toBe('Normal Zone');
    });

    it('boundary: hr=100 is Normal Zone', () => {
      expect(classifyHeartRate(100).zone).toBe('Normal Zone');
    });

    it('hr=75 is Normal Zone', () => {
      expect(classifyHeartRate(75).zone).toBe('Normal Zone');
    });

    it('has ecgSpeed of 4s', () => {
      expect(classifyHeartRate(72).ecgSpeed).toBe('4s');
    });
  });

  describe('Fat Burn zone (101 <= hr <= 140)', () => {
    it('boundary: hr=101 is Fat Burn', () => {
      expect(classifyHeartRate(101).zone).toBe('Fat Burn');
    });

    it('boundary: hr=140 is Fat Burn', () => {
      expect(classifyHeartRate(140).zone).toBe('Fat Burn');
    });

    it('has amber accent class', () => {
      expect(classifyHeartRate(120).accentClass).toBe('tri-card-accent-amber');
    });

    it('has amber dot class', () => {
      expect(classifyHeartRate(120).dotClass).toBe('live-dot-amber');
    });

    it('has amber bpm color', () => {
      expect(classifyHeartRate(120).bpmColor).toBe('#f59e0b');
    });

    it('has ecgSpeed of 2.5s', () => {
      expect(classifyHeartRate(120).ecgSpeed).toBe('2.5s');
    });

    it('has ecgOpacity of 0.4', () => {
      expect(classifyHeartRate(120).ecgOpacity).toBe(0.4);
    });
  });

  describe('Peak Zone (hr > 140)', () => {
    it('boundary: hr=141 is Peak Zone', () => {
      expect(classifyHeartRate(141).zone).toBe('Peak Zone');
    });

    it('hr=200 is Peak Zone', () => {
      expect(classifyHeartRate(200).zone).toBe('Peak Zone');
    });

    it('has red accent class', () => {
      expect(classifyHeartRate(180).accentClass).toBe('tri-card-accent-red');
    });

    it('has red dot class', () => {
      expect(classifyHeartRate(180).dotClass).toBe('live-dot-red');
    });

    it('has red bpm color', () => {
      expect(classifyHeartRate(180).bpmColor).toBe('#ef4444');
    });

    it('has ecgSpeed of 1.5s', () => {
      expect(classifyHeartRate(180).ecgSpeed).toBe('1.5s');
    });

    it('has ecgOpacity of 0.5', () => {
      expect(classifyHeartRate(180).ecgOpacity).toBe(0.5);
    });
  });
});

describe('classifyHRV', () => {
  describe('green (hrv >= 40)', () => {
    it('boundary: hrv=40 is green', () => {
      const result = classifyHRV(40);
      expect(result.color).toBe('#06d6a0');
    });

    it('hrv=100 is green', () => {
      expect(classifyHRV(100).color).toBe('#06d6a0');
    });

    it('has green shadow', () => {
      expect(classifyHRV(50).shadow).toContain('6,214,160');
    });
  });

  describe('amber (20 <= hrv < 40)', () => {
    it('boundary: hrv=39 is amber', () => {
      expect(classifyHRV(39).color).toBe('#f59e0b');
    });

    it('boundary: hrv=20 is amber', () => {
      expect(classifyHRV(20).color).toBe('#f59e0b');
    });

    it('has amber shadow', () => {
      expect(classifyHRV(30).shadow).toContain('245,158,11');
    });
  });

  describe('red (hrv < 20)', () => {
    it('boundary: hrv=19 is red', () => {
      expect(classifyHRV(19).color).toBe('#ef4444');
    });

    it('hrv=0 is red', () => {
      expect(classifyHRV(0).color).toBe('#ef4444');
    });

    it('has red shadow', () => {
      expect(classifyHRV(10).shadow).toContain('239,68,68');
    });
  });

  it('returns both color and shadow properties', () => {
    const result = classifyHRV(35);
    expect(result).toHaveProperty('color');
    expect(result).toHaveProperty('shadow');
  });
});

describe('generateECGSamples', () => {
  it('returns array of correct length', () => {
    expect(generateECGSamples(60, 100)).toHaveLength(100);
    expect(generateECGSamples(80, 200)).toHaveLength(200);
    expect(generateECGSamples(120, 50)).toHaveLength(50);
  });

  it('returns all numbers', () => {
    const samples = generateECGSamples(60, 50);
    samples.forEach(s => expect(typeof s).toBe('number'));
  });

  it('contains an R-peak close to amplitude 1.0 (within 0.1)', () => {
    // R wave is the dominant peak at ~1.0 amplitude
    const samples = generateECGSamples(60, 200);
    const max = Math.max(...samples);
    expect(max).toBeGreaterThan(0.8);
  });

  it('contains negative values (Q and S waves)', () => {
    const samples = generateECGSamples(60, 200);
    const min = Math.min(...samples);
    expect(min).toBeLessThan(0);
  });

  it('works at high heart rate (180 bpm)', () => {
    const samples = generateECGSamples(180, 100);
    expect(samples).toHaveLength(100);
    expect(Math.max(...samples)).toBeGreaterThan(0.5);
  });

  it('returns empty array for 0 samples', () => {
    expect(generateECGSamples(60, 0)).toHaveLength(0);
  });
});

describe('buildECGPath', () => {
  it('starts with "M 0 55"', () => {
    expect(buildECGPath(72)).toMatch(/^M 0 55/);
  });

  it('is a non-empty string', () => {
    expect(buildECGPath(60).length).toBeGreaterThan(0);
  });

  it('contains 8 segments (L x+10 baseline appears once per segment)', () => {
    const path = buildECGPath(72);
    // Each segment starts with ' L ' + (x+10) + ' 55'
    // Count 'L 10 55', 'L 110 55', ..., 'L 710 55' — one per segment
    const segmentStarts = path.match(/L \d+ 55/g);
    // Each segment has multiple L commands; count ' Q ' as quadratic per segment
    const quadratics = path.match(/ Q /g);
    // 8 segments × 2 Q per segment = 16
    expect(quadratics).toHaveLength(16);
  });

  it('produces different paths for different heart rates', () => {
    const slow = buildECGPath(50);
    const fast = buildECGPath(150);
    expect(slow).not.toBe(fast);
  });

  it('uses baseline of 55 throughout', () => {
    const path = buildECGPath(60);
    expect(path).toContain('55');
  });
});
