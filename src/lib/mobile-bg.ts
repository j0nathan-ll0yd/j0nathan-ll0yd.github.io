// Mobile background — a real starfield with the constellation CANCER (the Crab).
//
// Why not a canvas: iOS 26 Safari's Advanced Fingerprinting Protection surfaces the
// "reduce protections" banner when 2+ canvases animate at once (the particle canvas
// + the live heart-rate canvas). Rendering the background as SVG keeps the animating-
// canvas count at 1, so the banner never appears. Desktop keeps the full canvas.
//
// Astrophysics, all real:
//   - Colors: blackbody sRGB per spectral class — Mitchell Charity (vendian.org) +
//     Harre & Heller 2021 (arXiv:2101.06254). The Sun (G) is warm-white, not yellow;
//     M stars are orange, not red.
//   - Sizes/brightness: the Pogson magnitude scale (few brilliant stars, many faint).
//   - Drift: stellar proper motion (most stars barely move, a rare few streak).
//   - Twinkle: subtle atmospheric scintillation on the glow.
//   - CANCER is drawn at true relative star positions (J2000), real spectral colors,
//     and magnitude-scaled brightness, with the Beehive Cluster (M44) at its heart —
//     anchored (fixed) within the drifting field. Data: Wikipedia / Stellarium.

type Mode = 'lite' | 'svg'

// Real stellar colors (sRGB blackbody chromaticity) + population weights (sum 100).
const STAR_COLORS: ReadonlyArray<readonly [string, number]> = [
  ['#9bb0ff', 3], // O  — blue
  ['#aabfff', 10], // B  — blue-white
  ['#cad7ff', 16], // A  — white
  ['#f8f7ff', 14], // F  — yellow-white
  ['#fff4ea', 12], // G  — warm white (the Sun)
  ['#ffd2a1', 24], // K  — orange
  ['#ffcc6f', 13], // M dwarf — orange
  ['#ff9966', 8] // M giant — orange-red (Betelgeuse, Antares)
]

// Cancer, the Crab — real stars normalized to a 0..1 box (north up). J2000 positions
// from Wikipedia/Stellarium; colors from spectral type; mag = apparent V.
const CANCER_STARS: ReadonlyArray<{x: number; y: number; mag: number; c: string}> = [
  {x: 0.00, y: 1.00, mag: 3.53, c: '#ffd2a1'}, // 0 Tarf (β, K4III, orange)
  {x: 0.67, y: 0.54, mag: 3.94, c: '#ffd2a1'}, // 1 Asellus Australis (δ, K0III, orange)
  {x: 0.72, y: 0.00, mag: 4.03, c: '#fff4ea'}, // 2 Iota Cancri (ι, G8III, yellow)
  {x: 1.00, y: 0.86, mag: 4.25, c: '#cad7ff'}, // 3 Acubens (α, A7, white)
  {x: 0.64, y: 0.37, mag: 4.67, c: '#cad7ff'}, // 4 Asellus Borealis (γ, A1IV, white)
  {x: 0.085, y: 0.08, mag: 5.14, c: '#f8f7ff'} // 5 Chi Cancri (χ, F6V, yellow-white)
]
// Stellarium stick figure: ι–γ, γ–χ, γ–δ, δ–β, δ–α.
const CANCER_LINES: ReadonlyArray<readonly [number, number]> = [[2, 4], [4, 5], [4, 1], [1, 0], [1, 3]]
const BEEHIVE = {x: 0.57, y: 0.45} // M44 / Praesepe, at the crab's heart

const FRAME_MS = 1000 / 30 // 30fps
const LINE_DIST = 78
const MAX_LINES = 90
const NS = 'http://www.w3.org/2000/svg'

function pickStarColor(): string {
  let r = Math.random() * 100
  for (const [c, weight] of STAR_COLORS) {
    r -= weight
    if (r <= 0) {
      return c
    }
  }
  const last = STAR_COLORS[STAR_COLORS.length - 1]
  return last ? last[0] : '#fff4ea'
}

function countFor(w: number, h: number): number {
  return Math.max(40, Math.min(64, Math.floor((w * h) / 6200)))
}

// Pogson: brighter (lower) magnitude → larger flux. Returns 0..1.
function magBrightness(mag: number, ref: number): number {
  return Math.min(Math.pow(10, -0.4 * (mag - ref)), 1)
}

export function initMobileBg(mode: Mode): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }
  const canvas = document.getElementById('particle-canvas') as HTMLCanvasElement | null
  if (!canvas) {
    return
  }
  if (mode === 'lite') {
    initLiteCanvas(canvas)
  } else {
    initSvg(canvas)
  }
}

function circle(fill: string, r: number, op?: number): SVGCircleElement {
  const c = document.createElementNS(NS, 'circle')
  c.setAttribute('r', r.toFixed(1))
  c.setAttribute('fill', fill)
  if (op !== undefined) {
    c.setAttribute('fill-opacity', op.toFixed(2))
  }
  return c
}

// --- svg: drifting real starfield + the fixed Cancer constellation (no canvas) ---
function initSvg(canvas: HTMLCanvasElement): void {
  let w = window.innerWidth
  let h = window.innerHeight

  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  const cs = getComputedStyle(canvas)
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:' +
    (cs.zIndex && cs.zIndex !== 'auto' ? cs.zIndex : '0') + ';'
  canvas.style.display = 'none'
  canvas.parentNode!.insertBefore(svg, canvas.nextSibling)

  interface Field {
    x: number
    y: number
    vx: number
    vy: number
    c: string
    glow: SVGCircleElement
    core: SVGCircleElement
    baseOp: number
    twPhase: number
    twAmp: number
    twSpeed: number
  }

  // ---- ambient drifting field (a bit sparser so Cancer reads as the figure) ----
  const fieldCount = Math.round(countFor(w, h) * 0.7)
  const fieldLines: SVGLineElement[] = []
  for (let i = 0; i < MAX_LINES; i++) {
    const l = document.createElementNS(NS, 'line')
    l.setAttribute('stroke-width', '0.6')
    l.style.visibility = 'hidden'
    svg.appendChild(l)
    fieldLines.push(l)
  }
  const field: Field[] = []
  for (let i = 0; i < fieldCount; i++) {
    const c = pickStarColor()
    const b = Math.pow(Math.random(), 2.6)
    const rCore = 0.8 + b * 2.9
    const baseOp = 0.12 + b * 0.4
    const pm = Math.pow(Math.random(), 3)
    const speed = 0.26 + pm * 1.0
    const ang = Math.random() * Math.PI * 2
    const glow = circle(c, rCore * (2.2 + b * 1.5), baseOp)
    const core = circle(c, rCore)
    svg.appendChild(glow)
    svg.appendChild(core)
    field.push({
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
      twSpeed: 1.8 + Math.random() * 4
    })
  }

  // ---- Cancer: fixed figure at true relative positions ----
  const figH = h * 0.58
  const figW = figH * 0.52 // sky aspect (RA span ~9.9° : Dec span ~19.6°)
  const figX = (w - figW) / 2
  const figY = h * 0.15
  const place = (nx: number, ny: number): [number, number] => [figX + nx * figW, figY + ny * figH]

  // constellation lines (brighter + steadier than the field web)
  for (const [a, b] of CANCER_LINES) {
    const sa = CANCER_STARS[a]
    const sb = CANCER_STARS[b]
    if (!sa || !sb) {
      continue
    }
    const [x1, y1] = place(sa.x, sa.y)
    const [x2, y2] = place(sb.x, sb.y)
    const l = document.createElementNS(NS, 'line')
    l.setAttribute('x1', x1.toFixed(1))
    l.setAttribute('y1', y1.toFixed(1))
    l.setAttribute('x2', x2.toFixed(1))
    l.setAttribute('y2', y2.toFixed(1))
    l.setAttribute('stroke', '#bcd4ff')
    l.setAttribute('stroke-opacity', '0.42')
    l.setAttribute('stroke-width', '1')
    svg.appendChild(l)
  }

  // Beehive Cluster (M44) — a faint swarm of blue-white dots at the crab's heart
  const [bhx, bhy] = place(BEEHIVE.x, BEEHIVE.y)
  svg.appendChild(circle('#cad7ff', figH * 0.05, 0.08)) // soft collective haze
  ;(svg.lastChild as SVGCircleElement).setAttribute('cx', bhx.toFixed(1))
  ;(svg.lastChild as SVGCircleElement).setAttribute('cy', bhy.toFixed(1))
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2
    const rad = Math.pow(Math.random(), 0.6) * figH * 0.045
    const d = circle(i % 3 === 0 ? '#aabfff' : '#cad7ff', 0.9 + Math.random() * 0.6, 0.55 + Math.random() * 0.3)
    d.setAttribute('cx', (bhx + Math.cos(a) * rad).toFixed(1))
    d.setAttribute('cy', (bhy + Math.sin(a) * rad * 1.3).toFixed(1))
    svg.appendChild(d)
  }

  // constellation stars (bright glow + core, magnitude-scaled, gentle twinkle)
  interface Named {
    glow: SVGCircleElement
    baseOp: number
    twPhase: number
    twSpeed: number
  }
  const named: Named[] = []
  for (const s of CANCER_STARS) {
    const [x, y] = place(s.x, s.y)
    const b = magBrightness(s.mag, 3.5)
    const rCore = 2.4 + b * 4.8
    const baseOp = 0.34 + b * 0.42
    const glow = circle(s.c, rCore * 2.5, baseOp)
    const core = circle(s.c, rCore)
    for (const el of [glow, core]) {
      el.setAttribute('cx', x.toFixed(1))
      el.setAttribute('cy', y.toFixed(1))
      svg.appendChild(el)
    }
    named.push({glow, baseOp, twPhase: Math.random() * Math.PI * 2, twSpeed: 1.4 + Math.random() * 2.6})
  }

  let last = 0
  let rafId = 0
  let elapsed = 0
  function frame(ts: number): void {
    rafId = requestAnimationFrame(frame)
    if (ts - last < FRAME_MS) {
      return
    }
    elapsed += last ? (ts - last) / 1000 : 0.033
    last = ts

    for (const s of field) {
      s.x += s.vx
      s.y += s.vy
      if (s.x < -6) {
        s.x = w + 6
      } else if (s.x > w + 6) {
        s.x = -6
      }
      if (s.y < -6) {
        s.y = h + 6
      } else if (s.y > h + 6) {
        s.y = -6
      }
      const x = s.x.toFixed(1)
      const y = s.y.toFixed(1)
      s.glow.setAttribute('cx', x)
      s.glow.setAttribute('cy', y)
      s.core.setAttribute('cx', x)
      s.core.setAttribute('cy', y)
      s.glow.setAttribute('fill-opacity', (s.baseOp * (1 + s.twAmp * Math.sin(elapsed * s.twSpeed + s.twPhase))).toFixed(2))
    }

    // twinkle the named stars (fixed positions)
    for (const n of named) {
      n.glow.setAttribute('fill-opacity', (n.baseOp * (1 + 0.18 * Math.sin(elapsed * n.twSpeed + n.twPhase))).toFixed(2))
    }

    // subtle ambient web among field stars
    let li = 0
    const d2 = LINE_DIST * LINE_DIST
    for (let i = 0; i < field.length - 1 && li < MAX_LINES; i++) {
      const a = field[i]
      if (!a) {
        continue
      }
      for (let j = i + 1; j < field.length && li < MAX_LINES; j++) {
        const s2 = field[j]
        if (!s2) {
          continue
        }
        const dx = a.x - s2.x
        const dy = a.y - s2.y
        if (Math.abs(dx) > LINE_DIST || Math.abs(dy) > LINE_DIST) {
          continue
        }
        const dd = dx * dx + dy * dy
        if (dd > d2) {
          continue
        }
        const l = fieldLines[li++]
        if (!l) {
          continue
        }
        l.setAttribute('x1', a.x.toFixed(1))
        l.setAttribute('y1', a.y.toFixed(1))
        l.setAttribute('x2', s2.x.toFixed(1))
        l.setAttribute('y2', s2.y.toFixed(1))
        l.setAttribute('stroke', a.c)
        l.setAttribute('stroke-opacity', ((1 - Math.sqrt(dd) / LINE_DIST) * 0.18).toFixed(2))
        l.style.visibility = 'visible'
      }
    }
    for (; li < MAX_LINES; li++) {
      const l = fieldLines[li]
      if (l) {
        l.style.visibility = 'hidden'
      }
    }
  }

  window.addEventListener('resize', () => {
    w = window.innerWidth
    h = window.innerHeight
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
    } else if (!rafId) {
      last = 0
      rafId = requestAnimationFrame(frame)
    }
  })
  rafId = requestAnimationFrame(frame)
}

// --- lite: lighter CANVAS field (debug via ?bg=lite; NOT default) ---
interface P {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  c: string
}

function initLiteCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  let w = 0
  let h = 0
  let ps: P[] = []
  let last = 0

  function resize(): void {
    w = window.innerWidth
    h = window.innerHeight
    canvas.width = w
    canvas.height = h
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ps = []
    const count = countFor(w, h)
    for (let i = 0; i < count; i++) {
      const b = Math.pow(Math.random(), 2.6)
      const pm = Math.pow(Math.random(), 3)
      const speed = 0.28 + pm * 1.05
      const ang = Math.random() * Math.PI * 2
      ps.push({x: Math.random() * w, y: Math.random() * h, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 0.9 + b * 3.4, c: pickStarColor()})
    }
  }

  function frame(ts: number): void {
    requestAnimationFrame(frame)
    if (ts - last < FRAME_MS) {
      return
    }
    last = ts
    ctx!.clearRect(0, 0, w, h)
    for (const p of ps) {
      p.x += p.vx
      p.y += p.vy
      if (p.x < -6) {
        p.x = w + 6
      } else if (p.x > w + 6) {
        p.x = -6
      }
      if (p.y < -6) {
        p.y = h + 6
      } else if (p.y > h + 6) {
        p.y = -6
      }
    }
    const d2 = LINE_DIST * LINE_DIST
    for (let i = 0; i < ps.length - 1; i++) {
      const a = ps[i]
      if (!a) {
        continue
      }
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]
        if (!b) {
          continue
        }
        const dx = a.x - b.x
        const dy = a.y - b.y
        if (Math.abs(dx) > LINE_DIST || Math.abs(dy) > LINE_DIST) {
          continue
        }
        const dd = dx * dx + dy * dy
        if (dd > d2) {
          continue
        }
        ctx!.globalAlpha = (1 - Math.sqrt(dd) / LINE_DIST) * 0.2
        ctx!.strokeStyle = a.c
        ctx!.lineWidth = 0.7
        ctx!.beginPath()
        ctx!.moveTo(a.x, a.y)
        ctx!.lineTo(b.x, b.y)
        ctx!.stroke()
      }
    }
    ctx!.globalAlpha = 1
    for (const p of ps) {
      ctx!.beginPath()
      ctx!.fillStyle = p.c
      ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx!.fill()
    }
  }

  let t: ReturnType<typeof setTimeout>
  window.addEventListener('resize', () => {
    clearTimeout(t)
    t = setTimeout(resize, 150)
  })
  resize()
  requestAnimationFrame(frame)
}
