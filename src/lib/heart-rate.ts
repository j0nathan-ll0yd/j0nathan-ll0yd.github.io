export interface HeartRateZone {
  zone: string;
  accentClass: string;
  dotClass: string;
  bpmColor: string;
  bpmShadow: string;
  ecgStroke: string;
  ecgSpeed: string;
  ecgOpacity: number;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
}

export function classifyHeartRate(hr: number): HeartRateZone {
  if (hr < 45) {
    return {
      zone: 'Bradycardia',
      accentClass: 'tri-card-accent-pink',
      dotClass: 'live-dot-pink',
      bpmColor: '#3a86ff',
      bpmShadow: '0 0 16px rgba(58,134,255,0.6), 0 0 40px rgba(58,134,255,0.25)',
      ecgStroke: '#3a86ff',
      ecgSpeed: '8s',
      ecgOpacity: 0.35,
      badgeColor: 'var(--neon-blue)',
      badgeBg: 'rgba(58,134,255,0.12)',
      badgeBorder: 'rgba(58,134,255,0.25)',
    };
  } else if (hr < 60) {
    return {
      zone: 'Resting Zone',
      accentClass: 'tri-card-accent-pink',
      dotClass: 'live-dot-pink',
      bpmColor: '#ff006e',
      bpmShadow: '0 0 16px rgba(255,0,110,0.6), 0 0 40px rgba(255,0,110,0.25)',
      ecgStroke: '#ff006e',
      ecgSpeed: '6s',
      ecgOpacity: 0.35,
      badgeColor: 'var(--neon-green)',
      badgeBg: 'rgba(6,214,160,0.12)',
      badgeBorder: 'rgba(6,214,160,0.25)',
    };
  } else if (hr <= 100) {
    return {
      zone: 'Normal Zone',
      accentClass: 'tri-card-accent-pink',
      dotClass: 'live-dot-pink',
      bpmColor: '#ff006e',
      bpmShadow: '0 0 16px rgba(255,0,110,0.6), 0 0 40px rgba(255,0,110,0.25)',
      ecgStroke: '#ff006e',
      ecgSpeed: '4s',
      ecgOpacity: 0.35,
      badgeColor: 'var(--neon-green)',
      badgeBg: 'rgba(6,214,160,0.12)',
      badgeBorder: 'rgba(6,214,160,0.25)',
    };
  } else if (hr <= 140) {
    return {
      zone: 'Fat Burn',
      accentClass: 'tri-card-accent-amber',
      dotClass: 'live-dot-amber',
      bpmColor: '#f59e0b',
      bpmShadow: '0 0 16px rgba(245,158,11,0.7), 0 0 40px rgba(245,158,11,0.3)',
      ecgStroke: '#f59e0b',
      ecgSpeed: '2.5s',
      ecgOpacity: 0.4,
      badgeColor: 'var(--neon-amber)',
      badgeBg: 'rgba(245,158,11,0.12)',
      badgeBorder: 'rgba(245,158,11,0.25)',
    };
  } else {
    return {
      zone: 'Peak Zone',
      accentClass: 'tri-card-accent-red',
      dotClass: 'live-dot-red',
      bpmColor: '#ef4444',
      bpmShadow: '0 0 20px rgba(239,68,68,0.8), 0 0 50px rgba(239,68,68,0.35)',
      ecgStroke: '#ef4444',
      ecgSpeed: '1.5s',
      ecgOpacity: 0.5,
      badgeColor: '#ef4444',
      badgeBg: 'rgba(239,68,68,0.12)',
      badgeBorder: 'rgba(239,68,68,0.25)',
    };
  }
}

export function buildECGPath(heartRate: number): string {
  const segmentWidth = 100;
  const baseline = 55;
  const segments = 8;
  const spikeScale = Math.min(heartRate / 80, 1.8);
  const spikeHeight = 30 + (spikeScale * 15);
  let p = 'M 0 ' + baseline;
  for (let i = 0; i < segments; i++) {
    const x = i * segmentWidth;
    p += ' L ' + (x + 10) + ' ' + baseline;
    p += ' Q ' + (x + 18) + ' ' + (baseline - 6 * spikeScale) + ' ' + (x + 26) + ' ' + baseline;
    p += ' L ' + (x + 34) + ' ' + baseline;
    p += ' L ' + (x + 38) + ' ' + (baseline + 4 * spikeScale);
    p += ' L ' + (x + 44) + ' ' + (baseline - spikeHeight);
    p += ' L ' + (x + 50) + ' ' + (baseline + 8 * spikeScale);
    p += ' L ' + (x + 56) + ' ' + baseline;
    p += ' Q ' + (x + 68) + ' ' + (baseline - 10 * spikeScale) + ' ' + (x + 80) + ' ' + baseline;
    p += ' L ' + (x + 100) + ' ' + baseline;
  }
  return p;
}

/**
 * Generate physiologically accurate ECG samples for one cardiac cycle.
 * Uses the ECGSYN Gaussian sum model (PQRST waves).
 * @param bpm - Heart rate in beats per minute
 * @param samplesPerBeat - Number of sample points to generate
 * @returns Array of normalized amplitude values (approx -0.3 to 1.0)
 */
export function generateECGSamples(bpm: number, samplesPerBeat: number): number[] {
  const hrFact = Math.sqrt(bpm / 60);
  // [amplitude, center, baseWidth, isQRS]
  const waves: [number, number, number, boolean][] = [
    [0.15,  0.12, 0.040, false],  // P
    [-0.10, 0.28, 0.015, true],   // Q
    [1.00,  0.32, 0.018, true],   // R
    [-0.25, 0.38, 0.020, true],   // S
    [0.30,  0.58, 0.070, false],  // T
  ];

  const samples: number[] = new Array(samplesPerBeat);
  for (let i = 0; i < samplesPerBeat; i++) {
    const t = i / samplesPerBeat;
    let val = 0;
    for (let j = 0; j < waves.length; j++) {
      const [amp, baseCenter, baseWidth, isQRS] = waves[j];
      const width = isQRS ? baseWidth : baseWidth / hrFact;
      // T-wave center shifts earlier at high HR (QT shortening)
      const center = j === 4 ? 0.58 - (hrFact - 1) * 0.08 : baseCenter;
      const exponent = (t - center) / width;
      val += amp * Math.exp(-0.5 * exponent * exponent);
    }
    samples[i] = val;
  }
  return samples;
}

export interface HRVColor {
  color: string;
  shadow: string;
}

export function classifyHRV(hrv: number): HRVColor {
  if (hrv >= 40) {
    return {
      color: '#06d6a0',
      shadow: '0 0 12px rgba(6,214,160,0.5), 0 0 30px rgba(6,214,160,0.2)',
    };
  } else if (hrv >= 20) {
    return {
      color: '#f59e0b',
      shadow: '0 0 12px rgba(245,158,11,0.5), 0 0 30px rgba(245,158,11,0.2)',
    };
  } else {
    return {
      color: '#ef4444',
      shadow: '0 0 12px rgba(239,68,68,0.5), 0 0 30px rgba(239,68,68,0.2)',
    };
  }
}
