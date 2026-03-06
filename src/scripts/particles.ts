import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  Points,
  LineSegments,
  LineBasicMaterial,
  Clock,
} from 'three';

export function startParticles(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.getElementById('particle-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 60;

  const isMobile = window.innerWidth <= 900;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setClearColor(0x06060f, 1);

  const particleCount = isMobile ? 60 : 180;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const velocities: { x: number; y: number; z: number }[] = [];

  const neonColors = [
    [1.0, 0.0, 0.43],
    [0.23, 0.52, 1.0],
    [0.02, 0.84, 0.63],
    [0.9, 0.9, 0.95],
  ];

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 140;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;

    const c = neonColors[Math.floor(Math.random() * neonColors.length)];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];

    sizes[i] = Math.random() < 0.08 ? 2.5 + Math.random() * 1.5 : 0.6 + Math.random() * 0.5;

    velocities.push({
      x: (Math.random() - 0.5) * 0.008,
      y: (Math.random() - 0.5) * 0.008,
      z: (Math.random() - 0.5) * 0.004,
    });
  }

  const particleGeo = new BufferGeometry();
  particleGeo.setAttribute('position', new BufferAttribute(positions, 3));
  particleGeo.setAttribute('color', new BufferAttribute(colors, 3));
  particleGeo.setAttribute('size', new BufferAttribute(sizes, 1));

  const particleMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: [
      'attribute float size;',
      'attribute vec3 color;',
      'varying vec3 vColor;',
      'varying float vSize;',
      'void main() {',
      '  vColor = color;',
      '  vSize = size;',
      '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
      '  gl_PointSize = size * (200.0 / -mvPosition.z);',
      '  gl_Position = projectionMatrix * mvPosition;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vColor;',
      'varying float vSize;',
      'void main() {',
      '  float dist = length(gl_PointCoord - vec2(0.5));',
      '  if (dist > 0.5) discard;',
      '  float alpha = smoothstep(0.5, 0.1, dist);',
      '  if (vSize > 2.0) {',
      '    alpha *= 0.9;',
      '  } else {',
      '    alpha *= 0.7;',
      '  }',
      '  gl_FragColor = vec4(vColor, alpha);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
  });

  const particles = new Points(particleGeo, particleMat);
  scene.add(particles);

  const lineMaxDist = isMobile ? 22 : 18;
  const maxLines = isMobile ? 100 : 300;
  const linePositions = new Float32Array(maxLines * 6);
  const lineColors = new Float32Array(maxLines * 6);
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new BufferAttribute(linePositions, 3));
  lineGeo.setAttribute('color', new BufferAttribute(lineColors, 3));
  lineGeo.setDrawRange(0, 0);

  const lineMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });

  const lines = new LineSegments(lineGeo, lineMat);
  scene.add(lines);

  let mouseX = 0;
  let mouseY = 0;
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  const clock = new Clock();

  function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    particleMat.uniforms.uTime.value = elapsed;

    const pos = particleGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3] += velocities[i].x + Math.sin(elapsed * 0.2 + i * 0.3) * 0.003;
      pos[i * 3 + 1] += velocities[i].y + Math.cos(elapsed * 0.15 + i * 0.2) * 0.003;
      pos[i * 3 + 2] += velocities[i].z;

      if (pos[i * 3] > 70) pos[i * 3] = -70;
      if (pos[i * 3] < -70) pos[i * 3] = 70;
      if (pos[i * 3 + 1] > 50) pos[i * 3 + 1] = -50;
      if (pos[i * 3 + 1] < -50) pos[i * 3 + 1] = 50;
      if (pos[i * 3 + 2] > 40) pos[i * 3 + 2] = -40;
      if (pos[i * 3 + 2] < -40) pos[i * 3 + 2] = 40;
    }
    particleGeo.attributes.position.needsUpdate = true;

    const lp = lineGeo.attributes.position.array as Float32Array;
    const lc = lineGeo.attributes.color.array as Float32Array;
    let lineCount = 0;
    const pColors = particleGeo.attributes.color.array as Float32Array;

    for (let a = 0; a < particleCount && lineCount < maxLines; a++) {
      for (let b = a + 1; b < particleCount && lineCount < maxLines; b++) {
        const dx = pos[a * 3] - pos[b * 3];
        const dy = pos[a * 3 + 1] - pos[b * 3 + 1];
        const dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < lineMaxDist) {
          const idx = lineCount * 6;
          lp[idx] = pos[a * 3]; lp[idx + 1] = pos[a * 3 + 1]; lp[idx + 2] = pos[a * 3 + 2];
          lp[idx + 3] = pos[b * 3]; lp[idx + 4] = pos[b * 3 + 1]; lp[idx + 5] = pos[b * 3 + 2];

          const blend = 0.5;
          lc[idx] = pColors[a * 3] * blend + pColors[b * 3] * (1 - blend);
          lc[idx + 1] = pColors[a * 3 + 1] * blend + pColors[b * 3 + 1] * (1 - blend);
          lc[idx + 2] = pColors[a * 3 + 2] * blend + pColors[b * 3 + 2] * (1 - blend);
          lc[idx + 3] = lc[idx]; lc[idx + 4] = lc[idx + 1]; lc[idx + 5] = lc[idx + 2];

          lineCount++;
        }
      }
    }
    lineGeo.setDrawRange(0, lineCount * 2);
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;

    particles.rotation.y += (mouseX * 0.08 - particles.rotation.y) * 0.015;
    particles.rotation.x += (-mouseY * 0.04 - particles.rotation.x) * 0.015;
    lines.rotation.y = particles.rotation.y;
    lines.rotation.x = particles.rotation.x;

    renderer.render(scene, camera);
  }
  animate();

  let resizeTimeout: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth <= 900 ? 1.5 : 2));
    }, 150);
  });
}
