// Mobile background modes — investigation of the iOS 26 Safari "reduce protections"
// fingerprinting banner.
//
// Empirically, the full-screen animated *canvas* particle background trips iOS 26
// Safari's Advanced Fingerprinting Protection banner (prefers-reduced-motion clears
// it; on-device WebKit lists confirm the page loads zero classified trackers). WebKit
// source shows a draw-only canvas doesn't hit the noise-injection path, and there is
// no documented "safe" canvas threshold — the trigger appears to be a classification
// heuristic reacting to a continuously-animated canvas. The techniques with the
// strongest evidence of avoiding it are non-canvas (SVG / CSS).
//
// So these modes let us test the real candidates on-device via ?bg=lite|svg:
//   - lite: the same particle-network look on a canvas, but DPR 1 + 30fps + few
//           particles (tests whether a lighter canvas is enough).
//   - svg:  the same drifting-dots + proximity-line "network" look rendered as SVG
//           (no canvas at all) — keeps the aesthetic, expected to clear the banner.
// Desktop keeps the full canvas (see index.astro); this module only runs on touch.

type Mode = 'lite' | 'svg';

const COLORS = ['#ff006e', '#3a86ff', '#06d6a0', '#e5e5f0'];
const LINE_DIST = 90;
const FRAME_MS = 1000 / 30; // throttle to 30fps
const MAX_LINES = 60;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  c: string;
}

function countFor(w: number, h: number): number {
  return Math.max(10, Math.min(26, Math.floor((w * h) / 16000)));
}

function makeParticles(w: number, h: number, count: number): P[] {
  const ps: P[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.12 + Math.random() * 0.18;
    ps.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 0.8 + Math.random() * 1.4,
      c: COLORS[(Math.random() * COLORS.length) | 0],
    });
  }
  return ps;
}

function step(ps: P[], w: number, h: number): void {
  for (const p of ps) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < -5) p.x = w + 5;
    else if (p.x > w + 5) p.x = -5;
    if (p.y < -5) p.y = h + 5;
    else if (p.y > h + 5) p.y = -5;
  }
}

export function initMobileBg(mode: Mode): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.getElementById('particle-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (mode === 'svg') initSvg(canvas);
  else initLiteCanvas(canvas);
}

// --- lite: canvas at DPR 1, 30fps, low particle count ---
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
    canvas.width = w; // DPR 1 on purpose — fewer backing-store pixels
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ps = makeParticles(w, h, countFor(w, h));
  }

  function frame(ts: number): void {
    requestAnimationFrame(frame);
    if (ts - last < FRAME_MS) return;
    last = ts;
    ctx!.clearRect(0, 0, w, h);
    step(ps, w, h);

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
        ctx!.globalAlpha = (1 - Math.sqrt(dd) / LINE_DIST) * 0.15;
        ctx!.strokeStyle = a.c;
        ctx!.lineWidth = 0.6;
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

// --- svg: no canvas — drifting <circle>s + proximity <line>s updated in rAF ---
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

  const ps = makeParticles(w, h, countFor(w, h));

  // Line pool first (drawn under the dots), then dots.
  const lines: SVGLineElement[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('stroke-width', '0.6');
    l.style.visibility = 'hidden';
    svg.appendChild(l);
    lines.push(l);
  }
  const dots: SVGCircleElement[] = [];
  for (const p of ps) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(p.r + 0.4));
    c.setAttribute('fill', p.c);
    svg.appendChild(c);
    dots.push(c);
  }

  let last = 0;
  function frame(ts: number): void {
    requestAnimationFrame(frame);
    if (ts - last < FRAME_MS) return;
    last = ts;
    step(ps, w, h);
    for (let i = 0; i < ps.length; i++) {
      dots[i].setAttribute('cx', ps[i].x.toFixed(1));
      dots[i].setAttribute('cy', ps[i].y.toFixed(1));
    }
    let li = 0;
    const d2 = LINE_DIST * LINE_DIST;
    for (let i = 0; i < ps.length - 1 && li < MAX_LINES; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length && li < MAX_LINES; j++) {
        const b = ps[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (Math.abs(dx) > LINE_DIST || Math.abs(dy) > LINE_DIST) continue;
        const dd = dx * dx + dy * dy;
        if (dd > d2) continue;
        const l = lines[li++];
        l.setAttribute('x1', a.x.toFixed(1));
        l.setAttribute('y1', a.y.toFixed(1));
        l.setAttribute('x2', b.x.toFixed(1));
        l.setAttribute('y2', b.y.toFixed(1));
        l.setAttribute('stroke', a.c);
        l.setAttribute('stroke-opacity', ((1 - Math.sqrt(dd) / LINE_DIST) * 0.2).toFixed(2));
        l.style.visibility = 'visible';
      }
    }
    for (; li < MAX_LINES; li++) lines[li].style.visibility = 'hidden';
  }

  window.addEventListener('resize', () => {
    w = window.innerWidth;
    h = window.innerHeight;
  });
  requestAnimationFrame(frame);
}
