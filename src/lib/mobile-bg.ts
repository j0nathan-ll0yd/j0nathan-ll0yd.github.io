// Mobile background — a real starfield.
//
// Why not a canvas: iOS 26 Safari's Advanced Fingerprinting Protection surfaces the
// "reduce protections" banner when 2+ canvases animate at once (the particle canvas
// + the live heart-rate canvas). Rendering the background as SVG keeps the animating-
// canvas count at 1, so the banner never appears — while keeping the moving-network
// look. Desktop keeps the full particle canvas (see index.astro).
//
// The starfield is grounded in real astrophysics:
//   - Colors: blackbody sRGB per spectral class — Mitchell Charity, "What color are
//     the stars?" (vendian.org) + Harre & Heller 2021 (arXiv:2101.06254). The Sun (G)
//     is a warm white #fff4ea, not yellow; M stars are orange, not red.
//   - Sizes/brightness: the Pogson magnitude scale (radius ∝ 10^(−0.2·m), glow flux
//     ∝ 10^(−0.4·m)) → a few brilliant stars, many faint ones.
//   - Drift: stellar proper motion — most stars barely move, a rare few streak
//     (à la Barnard's Star). Nearer/faster stars parallax past the slow field.
//   - Twinkle: subtle atmospheric scintillation on the glow.
// Connection lines draw dynamic "constellation" figures across the field.

type Mode = 'lite' | 'svg';

// Real stellar colors (sRGB blackbody chromaticity) + population weights. Weights
// blend the true galactic mix (K/M-dominant) with the hotter, bluer stars that catch
// the eye — physically grounded but vivid. Weights sum to 100.
const STAR_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['#9bb0ff', 3], // O  — blue (rare jewel)
  ['#aabfff', 10], // B  — blue-white
  ['#cad7ff', 16], // A  — white
  ['#f8f7ff', 14], // F  — yellow-white
  ['#fff4ea', 12], // G  — warm white (the Sun)
  ['#ffd2a1', 24], // K  — orange
  ['#ffcc6f', 13], // M dwarf — orange
  ['#ff9966', 8], // M giant — orange-red (Betelgeuse, Antares)
];

const FRAME_MS = 1000 / 30; // 30fps
const LINE_DIST = 78;
const MAX_LINES = 110;

function pickStarColor(): string {
  let r = Math.random() * 100;
  for (const [c, weight] of STAR_COLORS) {
    r -= weight;
    if (r <= 0) return c;
  }
  return STAR_COLORS[STAR_COLORS.length - 1][0];
}

function countFor(w: number, h: number): number {
  return Math.max(40, Math.min(64, Math.floor((w * h) / 6200)));
}

export function initMobileBg(mode: Mode): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.getElementById('particle-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (mode === 'lite') initLiteCanvas(canvas);
  else initSvg(canvas);
}

// --- svg starfield: no canvas — real star colors, magnitude sizing, proper-motion
//     drift, twinkle, and dynamic constellation lines ---
function initSvg(canvas: HTMLCanvasElement): void {
  const NS = 'http://www.w3.org/2000/svg';
  let w = window.innerWidth;
  let h = window.innerHeight;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const cs = getComputedStyle(canvas);
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:'
    + (cs.zIndex && cs.zIndex !== 'auto' ? cs.zIndex : '0') + ';';
  canvas.style.display = 'none';
  canvas.parentNode!.insertBefore(svg, canvas.nextSibling);

  interface Star {
    x: number;
    y: number;
    vx: number;
    vy: number;
    c: string;
    glow: SVGCircleElement;
    core: SVGCircleElement;
    baseOp: number;
    twPhase: number;
    twAmp: number;
    twSpeed: number;
  }

  const count = countFor(w, h);

  // Constellation-line pool, drawn beneath the stars.
  const lines: SVGLineElement[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('stroke-width', '0.7');
    l.style.visibility = 'hidden';
    svg.appendChild(l);
    lines.push(l);
  }

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const c = pickStarColor();
    const b = Math.pow(Math.random(), 2.6); // brightness 0..1 — cubed → few brilliant
    const rCore = 0.9 + b * 3.4;
    const rGlow = rCore * (2.3 + b * 1.6);
    const baseOp = 0.16 + b * 0.5; // brighter glow than v1
    const pm = Math.pow(Math.random(), 3); // proper motion 0..1 — most slow, few fast
    const speed = 0.28 + pm * 1.05; // faster + varied drift
    const ang = Math.random() * Math.PI * 2;

    const glow = document.createElementNS(NS, 'circle');
    glow.setAttribute('r', rGlow.toFixed(1));
    glow.setAttribute('fill', c);
    glow.setAttribute('fill-opacity', baseOp.toFixed(2));
    svg.appendChild(glow);

    const core = document.createElementNS(NS, 'circle');
    core.setAttribute('r', rCore.toFixed(1));
    core.setAttribute('fill', c);
    svg.appendChild(core);

    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      c,
      glow,
      core,
      baseOp,
      twPhase: Math.random() * Math.PI * 2,
      twAmp: 0.12 + Math.random() * 0.22,
      twSpeed: 1.8 + Math.random() * 4,
    });
  }

  let last = 0;
  let rafId = 0;
  let elapsed = 0;
  function frame(ts: number): void {
    rafId = requestAnimationFrame(frame);
    if (ts - last < FRAME_MS) return;
    elapsed += last ? (ts - last) / 1000 : 0.033;
    last = ts;

    for (const s of stars) {
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < -6) s.x = w + 6;
      else if (s.x > w + 6) s.x = -6;
      if (s.y < -6) s.y = h + 6;
      else if (s.y > h + 6) s.y = -6;
      const x = s.x.toFixed(1);
      const y = s.y.toFixed(1);
      s.glow.setAttribute('cx', x);
      s.glow.setAttribute('cy', y);
      s.core.setAttribute('cx', x);
      s.core.setAttribute('cy', y);
      const op = s.baseOp * (1 + s.twAmp * Math.sin(elapsed * s.twSpeed + s.twPhase));
      s.glow.setAttribute('fill-opacity', op.toFixed(2));
    }

    let li = 0;
    const d2 = LINE_DIST * LINE_DIST;
    for (let i = 0; i < stars.length - 1 && li < MAX_LINES; i++) {
      const a = stars[i];
      for (let j = i + 1; j < stars.length && li < MAX_LINES; j++) {
        const s2 = stars[j];
        const dx = a.x - s2.x;
        const dy = a.y - s2.y;
        if (Math.abs(dx) > LINE_DIST || Math.abs(dy) > LINE_DIST) continue;
        const dd = dx * dx + dy * dy;
        if (dd > d2) continue;
        const l = lines[li++];
        l.setAttribute('x1', a.x.toFixed(1));
        l.setAttribute('y1', a.y.toFixed(1));
        l.setAttribute('x2', s2.x.toFixed(1));
        l.setAttribute('y2', s2.y.toFixed(1));
        l.setAttribute('stroke', a.c);
        l.setAttribute('stroke-opacity', ((1 - Math.sqrt(dd) / LINE_DIST) * 0.28).toFixed(2));
        l.style.visibility = 'visible';
      }
    }
    for (; li < MAX_LINES; li++) lines[li].style.visibility = 'hidden';
  }

  window.addEventListener('resize', () => {
    w = window.innerWidth;
    h = window.innerHeight;
  });
  // Pause when the tab is hidden (battery).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    } else if (!rafId) {
      last = 0;
      rafId = requestAnimationFrame(frame);
    }
  });
  rafId = requestAnimationFrame(frame);
}

// --- lite: a lighter CANVAS variant of the same starfield (debug via ?bg=lite;
//     NOT the default — a 2nd animating canvas can re-trip the iOS 26 banner) ---
interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  c: string;
}

function initLiteCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let w = 0;
  let h = 0;
  let ps: P[] = [];
  let last = 0;

  function resize(): void {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w; // DPR 1 — fewer backing-store pixels
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ps = [];
    const count = countFor(w, h);
    for (let i = 0; i < count; i++) {
      const b = Math.pow(Math.random(), 2.6);
      const pm = Math.pow(Math.random(), 3);
      const speed = 0.28 + pm * 1.05;
      const ang = Math.random() * Math.PI * 2;
      ps.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r: 0.9 + b * 3.4,
        c: pickStarColor(),
      });
    }
  }

  function frame(ts: number): void {
    requestAnimationFrame(frame);
    if (ts - last < FRAME_MS) return;
    last = ts;
    ctx!.clearRect(0, 0, w, h);
    for (const p of ps) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -6) p.x = w + 6;
      else if (p.x > w + 6) p.x = -6;
      if (p.y < -6) p.y = h + 6;
      else if (p.y > h + 6) p.y = -6;
    }
    const d2 = LINE_DIST * LINE_DIST;
    for (let i = 0; i < ps.length - 1; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (Math.abs(dx) > LINE_DIST || Math.abs(dy) > LINE_DIST) continue;
        const dd = dx * dx + dy * dy;
        if (dd > d2) continue;
        ctx!.globalAlpha = (1 - Math.sqrt(dd) / LINE_DIST) * 0.2;
        ctx!.strokeStyle = a.c;
        ctx!.lineWidth = 0.7;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }
    }
    ctx!.globalAlpha = 1;
    for (const p of ps) {
      ctx!.beginPath();
      ctx!.fillStyle = p.c;
      ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx!.fill();
    }
  }

  let t: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(resize, 150);
  });
  resize();
  requestAnimationFrame(frame);
}
