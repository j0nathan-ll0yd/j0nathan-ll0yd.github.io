/**
 * particles.js — Three.js particle background animation
 * Shared across implementations (HTMX, WebAwesome, etc.)
 */
(function () {
  var canvas = document.getElementById('particle-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 60;

  var isMobile = window.innerWidth <= 900;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setClearColor(0x06060f, 1);

  var particleCount = isMobile ? 60 : 180;
  var positions = new Float32Array(particleCount * 3);
  var colors = new Float32Array(particleCount * 3);
  var sizes = new Float32Array(particleCount);
  var velocities = [];

  var neonColors = [
    [1.0, 0.0, 0.43],
    [0.23, 0.52, 1.0],
    [0.02, 0.84, 0.63],
    [0.9, 0.9, 0.95]
  ];

  for (var i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 140;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;

    var c = neonColors[Math.floor(Math.random() * neonColors.length)];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];

    sizes[i] = (Math.random() < 0.08) ? 2.5 + Math.random() * 1.5 : 0.6 + Math.random() * 0.5;

    velocities.push({
      x: (Math.random() - 0.5) * 0.008,
      y: (Math.random() - 0.5) * 0.008,
      z: (Math.random() - 0.5) * 0.004
    });
  }

  var particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particleGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  var particleMat = new THREE.ShaderMaterial({
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
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vColor;',
      'varying float vSize;',
      'void main() {',
      '  float dist = length(gl_PointCoord - vec2(0.5));',
      '  if (dist > 0.5) discard;',
      '  float alpha = smoothstep(0.5, 0.1, dist);',
      '  if (vSize > 2.0) { alpha *= 0.9; } else { alpha *= 0.7; }',
      '  gl_FragColor = vec4(vColor, alpha);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false
  });

  var particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  var lineMaxDist = isMobile ? 22 : 18;
  var maxLines = isMobile ? 100 : 300;
  var linePositions = new Float32Array(maxLines * 6);
  var lineColors = new Float32Array(maxLines * 6);
  var lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
  lineGeo.setDrawRange(0, 0);

  var lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.15,
    depthWrite: false
  });

  var lines = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lines);

  var mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', function (e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  var clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    var elapsed = clock.getElapsedTime();
    particleMat.uniforms.uTime.value = elapsed;
    var pos = particleGeo.attributes.position.array;

    for (var i = 0; i < particleCount; i++) {
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

    var lp = lineGeo.attributes.position.array;
    var lc = lineGeo.attributes.color.array;
    var lineCount = 0;
    var pColors = particleGeo.attributes.color.array;

    for (var a = 0; a < particleCount && lineCount < maxLines; a++) {
      for (var b = a + 1; b < particleCount && lineCount < maxLines; b++) {
        var dx = pos[a * 3] - pos[b * 3];
        var dy = pos[a * 3 + 1] - pos[b * 3 + 1];
        var dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < lineMaxDist) {
          var idx = lineCount * 6;
          lp[idx] = pos[a * 3]; lp[idx + 1] = pos[a * 3 + 1]; lp[idx + 2] = pos[a * 3 + 2];
          lp[idx + 3] = pos[b * 3]; lp[idx + 4] = pos[b * 3 + 1]; lp[idx + 5] = pos[b * 3 + 2];
          var blend = 0.5;
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

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();
