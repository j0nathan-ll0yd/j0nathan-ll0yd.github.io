export function startParticles(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.getElementById('particle-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const COLORS = ['#ff006e', '#3a86ff', '#06d6a0', '#e5e5f0'];
  const isMobile = () => window.innerWidth <= 900;
  const COUNT = () => (isMobile() ? 60 : 180);
  const LINE_DIST = () => (isMobile() ? 22 : 18);
  const MAX_LINES = () => (isMobile() ? 100 : 300);
  const MAX_DPR = () => (isMobile() ? 1.5 : 2);

  let mobile = isMobile();
  let W = 0;
  let H = 0;
  let dpr = 1;

  function resize() {
    mobile = isMobile();
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR());
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    radius: number;
    phase: number;
  }

  let particles: Particle[] = [];

  function initParticles() {
    const count = COUNT();
    particles = [];
    for (let i = 0; i < count; i++) {
      const large = Math.random() < 0.08;
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        radius: large ? 2.5 + Math.random() * 1.5 : 0.6 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  let mouseX = 0;
  let mouseY = 0;
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5);
    mouseY = (e.clientY / window.innerHeight - 0.5);
  });

  let resizeTimeout: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const wasCount = particles.length;
      resize();
      const newCount = COUNT();
      if (Math.abs(wasCount - newCount) > 5) {
        initParticles();
      } else {
        for (const p of particles) {
          p.x = Math.min(p.x, W);
          p.y = Math.min(p.y, H);
        }
      }
    }, 150);
  });

  const glowCache = new Map<string, CanvasGradient>();

  function getGlow(color: string, radius: number): CanvasGradient {
    const key = color + radius.toFixed(2);
    let g = glowCache.get(key);
    if (!g) {
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 3);
      g.addColorStop(0, color + 'cc');
      g.addColorStop(0.4, color + '66');
      g.addColorStop(1, color + '00');
      glowCache.set(key, g);
    }
    return g;
  }

  let elapsed = 0;
  let lastTime = 0;

  function frame(ts: number) {
    requestAnimationFrame(frame);

    const dt = Math.min((ts - lastTime) / 16.67, 3);
    lastTime = ts;
    elapsed += dt * 0.016;

    ctx.fillStyle = '#06060f';
    ctx.fillRect(0, 0, W, H);

    const lineDist = LINE_DIST();
    const maxLines = MAX_LINES();
    const parallaxX = mouseX * 18;
    const parallaxY = mouseY * 10;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += (p.vx + Math.sin(elapsed * 0.2 + p.phase) * 0.12) * dt;
      p.y += (p.vy + Math.cos(elapsed * 0.15 + p.phase * 1.3) * 0.12) * dt;
      if (p.x < 0) p.x += W;
      if (p.x > W) p.x -= W;
      if (p.y < 0) p.y += H;
      if (p.y > H) p.y -= H;
    }

    const lineDist2 = lineDist * lineDist;
    let lineCount = 0;

    outer: for (let a = 0; a < particles.length; a++) {
      const pa = particles[a];
      const ax = pa.x + parallaxX;
      const ay = pa.y + parallaxY;
      for (let b = a + 1; b < particles.length; b++) {
        if (lineCount >= maxLines) break outer;
        const pb = particles[b];
        const bx = pb.x + parallaxX;
        const by = pb.y + parallaxY;
        const dx = ax - bx;
        const dy = ay - by;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < lineDist2) {
          const alpha = (1 - Math.sqrt(dist2) / lineDist) * 0.15;
          ctx.beginPath();
          ctx.strokeStyle = pa.color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 0.5;
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          lineCount++;
        }
      }
    }

    ctx.globalAlpha = 1;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = p.x + parallaxX;
      const py = p.y + parallaxY;
      const r = p.radius;

      ctx.save();
      ctx.translate(px, py);

      ctx.globalAlpha = r > 2 ? 0.9 : 0.7;
      ctx.fillStyle = getGlow(p.color, r);
      ctx.beginPath();
      ctx.arc(0, 0, r * 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  resize();
  initParticles();
  requestAnimationFrame((ts) => {
    lastTime = ts;
    requestAnimationFrame(frame);
  });
}
