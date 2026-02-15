/**
 * init.js — Post-render initialization for Command Center
 * Runs after app.js dispatches the 'dataReady' event.
 * Handles: ECG, map, hydration, terminal, card reveals, workout toggle, book modal, particles, clock.
 */
(function () {

  // ===== LIVE CLOCK =====
  function updateClock() {
    var el = document.getElementById('liveClock');
    if (!el) return;
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    el.textContent = h + ':' + m + ':' + s;
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ===== THREE.JS PARTICLES =====
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

  // ===== DATA READY LISTENER =====
  document.addEventListener('dataReady', function() {
    initCardReveal();
    setTimeout(initHeartRate, 50);
    setTimeout(initWorkouts, 50);
    setTimeout(initHydration, 100);
    setTimeout(initMap, 50);
    setTimeout(initTerminal, 50);
    setTimeout(initBookModal, 50);
  });

  // ===== STAGGERED CARD REVEAL =====
  function initCardReveal() {
    setTimeout(function () {
      var el = document.getElementById('identityCard');
      if (el) el.classList.add('visible');
    }, 100);
    setTimeout(function () {
      var el = document.getElementById('cardBio');
      if (el) el.classList.add('visible');
    }, 250);
    setTimeout(function () {
      var el = document.getElementById('cardSystem');
      if (el) el.classList.add('visible');
    }, 550);

    var columns = document.querySelectorAll('.triptych-column');
    columns.forEach(function (col, colIdx) {
      var colCards = col.querySelectorAll('.tri-card');
      colCards.forEach(function (card, rowIdx) {
        setTimeout(function () {
          card.classList.add('visible');
        }, 400 + colIdx * 150 + rowIdx * 100);
      });
    });
  }

  // ===== COUNT UP ANIMATION =====
  function countUp(element, target, duration, suffix, isFloat) {
    var startTime = null;
    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(eased * target);
      if (isFloat) {
        current = (eased * target).toFixed(1);
      }
      if (typeof target === 'number' && target >= 1000 && !isFloat) {
        element.textContent = Number(current).toLocaleString() + (suffix || '');
      } else {
        element.textContent = current + (suffix || '');
      }
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ===== HEART RATE / ECG =====
  function initHeartRate() {
    var bpmEl = document.getElementById('pulseBpm');
    var badge = document.getElementById('pulseStatusBadge');
    var hrvEl = document.getElementById('pulseHrvValue');
    var ecgPath = document.getElementById('ecgPath');
    var card = document.getElementById('cardHR');
    if (!bpmEl || !card) return;

    var hr = parseInt(bpmEl.getAttribute('data-hr') || bpmEl.textContent) || 0;
    var hrv = parseInt(hrvEl ? hrvEl.getAttribute('data-hrv') || hrvEl.textContent : '0') || 0;

    // Determine HR zone state
    var state;
    if (hr < 45) {
      state = {
        zone: 'Bradycardia', accentClass: 'tri-card-accent-pink', dotClass: 'live-dot-pink',
        bpmColor: '#3a86ff', bpmShadow: '0 0 16px rgba(58,134,255,0.6), 0 0 40px rgba(58,134,255,0.25)',
        ecgStroke: '#3a86ff', ecgSpeed: '8s', ecgOpacity: 0.35,
        badgeColor: 'var(--neon-blue)', badgeBg: 'rgba(58,134,255,0.12)', badgeBorder: 'rgba(58,134,255,0.25)'
      };
    } else if (hr < 60) {
      state = {
        zone: 'Resting Zone', accentClass: 'tri-card-accent-pink', dotClass: 'live-dot-pink',
        bpmColor: '#ff006e', bpmShadow: '0 0 16px rgba(255,0,110,0.6), 0 0 40px rgba(255,0,110,0.25)',
        ecgStroke: '#ff006e', ecgSpeed: '6s', ecgOpacity: 0.35,
        badgeColor: 'var(--neon-green)', badgeBg: 'rgba(6,214,160,0.12)', badgeBorder: 'rgba(6,214,160,0.25)'
      };
    } else if (hr <= 100) {
      state = {
        zone: 'Normal Zone', accentClass: 'tri-card-accent-pink', dotClass: 'live-dot-pink',
        bpmColor: '#ff006e', bpmShadow: '0 0 16px rgba(255,0,110,0.6), 0 0 40px rgba(255,0,110,0.25)',
        ecgStroke: '#ff006e', ecgSpeed: '4s', ecgOpacity: 0.35,
        badgeColor: 'var(--neon-green)', badgeBg: 'rgba(6,214,160,0.12)', badgeBorder: 'rgba(6,214,160,0.25)'
      };
    } else if (hr <= 140) {
      state = {
        zone: 'Fat Burn', accentClass: 'tri-card-accent-amber', dotClass: 'live-dot-amber',
        bpmColor: '#f59e0b', bpmShadow: '0 0 16px rgba(245,158,11,0.7), 0 0 40px rgba(245,158,11,0.3)',
        ecgStroke: '#f59e0b', ecgSpeed: '2.5s', ecgOpacity: 0.4,
        badgeColor: 'var(--neon-amber)', badgeBg: 'rgba(245,158,11,0.12)', badgeBorder: 'rgba(245,158,11,0.25)'
      };
    } else {
      state = {
        zone: 'Peak Zone', accentClass: 'tri-card-accent-red', dotClass: 'live-dot-red',
        bpmColor: '#ef4444', bpmShadow: '0 0 20px rgba(239,68,68,0.8), 0 0 50px rgba(239,68,68,0.35)',
        ecgStroke: '#ef4444', ecgSpeed: '1.5s', ecgOpacity: 0.5,
        badgeColor: '#ef4444', badgeBg: 'rgba(239,68,68,0.12)', badgeBorder: 'rgba(239,68,68,0.25)'
      };
    }

    // HRV color
    var hrvColor, hrvShadow;
    if (hrv >= 60) {
      hrvColor = '#06d6a0'; hrvShadow = '0 0 12px rgba(6,214,160,0.5), 0 0 30px rgba(6,214,160,0.2)';
    } else if (hrv >= 40) {
      hrvColor = '#06d6a0'; hrvShadow = '0 0 12px rgba(6,214,160,0.5), 0 0 30px rgba(6,214,160,0.2)';
    } else if (hrv >= 20) {
      hrvColor = '#f59e0b'; hrvShadow = '0 0 12px rgba(245,158,11,0.5), 0 0 30px rgba(245,158,11,0.2)';
    } else {
      hrvColor = '#ef4444'; hrvShadow = '0 0 12px rgba(239,68,68,0.5), 0 0 30px rgba(239,68,68,0.2)';
    }

    // Apply accent class
    card.className = card.className.replace(/tri-card-accent-\w+/g, '');
    card.classList.add(state.accentClass);

    var dot = card.querySelector('.live-dot');
    if (dot) {
      dot.className = dot.className.replace(/live-dot-\w+/g, '');
      dot.classList.add(state.dotClass);
    }

    // Style BPM
    bpmEl.style.color = state.bpmColor;
    bpmEl.style.textShadow = state.bpmShadow;
    setTimeout(function () { countUp(bpmEl, hr, 1200); }, 500);

    // Style badge
    if (badge) {
      badge.textContent = state.zone;
      badge.style.color = state.badgeColor;
      badge.style.background = state.badgeBg;
      badge.style.border = '1px solid ' + state.badgeBorder;
    }

    // Style HRV
    if (hrvEl) {
      hrvEl.textContent = hrv;
      hrvEl.style.color = hrvColor;
      hrvEl.style.textShadow = hrvShadow;
    }

    // Build ECG path
    if (ecgPath) {
      ecgPath.style.stroke = state.ecgStroke;
      var ecgSvg = card.querySelector('.ecg-svg');
      if (ecgSvg) ecgSvg.style.animationDuration = state.ecgSpeed;
      var ecgBg = card.querySelector('.hr-ecg-bg');
      if (ecgBg) ecgBg.style.opacity = state.ecgOpacity;

      var segmentWidth = 100;
      var baseline = 55;
      var segments = 8;
      var spikeScale = Math.min(hr / 80, 1.8);
      var spikeHeight = 30 + (spikeScale * 15);
      var path = 'M 0 ' + baseline;
      for (var i = 0; i < segments; i++) {
        var x = i * segmentWidth;
        path += ' L ' + (x + 10) + ' ' + baseline;
        path += ' Q ' + (x + 18) + ' ' + (baseline - 6 * spikeScale) + ' ' + (x + 26) + ' ' + baseline;
        path += ' L ' + (x + 34) + ' ' + baseline;
        path += ' L ' + (x + 38) + ' ' + (baseline + 4 * spikeScale);
        path += ' L ' + (x + 44) + ' ' + (baseline - spikeHeight);
        path += ' L ' + (x + 50) + ' ' + (baseline + 8 * spikeScale);
        path += ' L ' + (x + 56) + ' ' + baseline;
        path += ' Q ' + (x + 68) + ' ' + (baseline - 10 * spikeScale) + ' ' + (x + 80) + ' ' + baseline;
        path += ' L ' + (x + 100) + ' ' + baseline;
      }
      ecgPath.setAttribute('d', path);
    }
  }

  // ===== HYDRATION =====
  function initHydration() {
    var wLiq = document.getElementById('hydraWaterLiq');
    var cLiq = document.getElementById('hydraCoffeeLiq');
    var wVal = document.getElementById('hydraWaterVal');
    var cVal = document.getElementById('hydraCoffeeVal');
    if (!wLiq || !cLiq) return;

    // Try reading from data attributes first, fall back to window
    var store = document.getElementById('hydrationDataStore');
    var data = window.__hydrationData;
    if (store) {
      data = {
        waterOz: parseInt(store.getAttribute('data-water-oz')),
        coffeeOz: parseInt(store.getAttribute('data-coffee-oz')),
        waterMax: parseInt(store.getAttribute('data-water-max')),
        coffeeMax: parseInt(store.getAttribute('data-coffee-max')),
        waterRangeLo: parseInt(store.getAttribute('data-water-range-lo')),
        waterRangeHi: parseInt(store.getAttribute('data-water-range-hi')),
        coffeeRangeLo: parseInt(store.getAttribute('data-coffee-range-lo')),
        coffeeRangeHi: parseInt(store.getAttribute('data-coffee-range-hi')),
        coffeeCautionMax: parseInt(store.getAttribute('data-coffee-caution-max'))
      };
      window.__hydrationData = data;
    }
    if (!data) return;

    var waterOz = data.waterOz;
    var coffeeOz = data.coffeeOz;
    var waterMax = data.waterMax;
    var coffeeMax = data.coffeeMax;
    var waterRangeLo = data.waterRangeLo;
    var waterRangeHi = data.waterRangeHi;
    var coffeeRangeLo = data.coffeeRangeLo;
    var coffeeRangeHi = data.coffeeRangeHi;
    var coffeeCautionMax = data.coffeeCautionMax;

    var waterPct = Math.min(waterOz / waterMax, 1);
    var coffeePct = Math.min(coffeeOz / coffeeMax, 1);

    wLiq.style.height = '0%';
    cLiq.style.height = '0%';

    requestAnimationFrame(function () {
      wLiq.style.height = (waterPct * 100) + '%';
      cLiq.style.height = (coffeePct * 100) + '%';
    });

    // Add range markers
    function addRange(container, lo, hi, max, cssClass, labelClass, loLabel, hiLabel) {
      var loPct = (lo / max) * 100;
      var hiPct = (hi / max) * 100;
      var zone = document.createElement('div');
      zone.className = 'hydra-range ' + cssClass;
      zone.style.bottom = loPct + '%';
      zone.style.height = (hiPct - loPct) + '%';

      var topLbl = document.createElement('div');
      topLbl.className = 'hydra-range-label hydra-range-label-top ' + labelClass;
      topLbl.textContent = hiLabel;
      zone.appendChild(topLbl);

      var btmLbl = document.createElement('div');
      btmLbl.className = 'hydra-range-label hydra-range-label-bottom ' + labelClass;
      btmLbl.textContent = loLabel;
      zone.appendChild(btmLbl);

      container.appendChild(zone);
    }

    function addLine(container, val, max, cssClass, labelClass, label) {
      var pct = (val / max) * 100;
      var line = document.createElement('div');
      line.className = 'hydra-range ' + cssClass;
      line.style.bottom = pct + '%';
      line.style.height = '0px';
      line.style.borderBottom = 'none';

      var lbl = document.createElement('div');
      lbl.className = 'hydra-range-label hydra-range-label-top ' + labelClass;
      lbl.textContent = label;
      line.appendChild(lbl);

      container.appendChild(line);
    }

    var bottleBody = document.querySelector('.hydra-bottle-body');
    if (bottleBody) {
      addRange(bottleBody, waterRangeLo, waterRangeHi, waterMax,
        'hydra-range-water', 'hydra-range-label-water', String(waterRangeLo), String(waterRangeHi));
    }

    var mugBody = document.querySelector('.hydra-mug-body');
    if (mugBody) {
      addRange(mugBody, coffeeRangeLo, coffeeRangeHi, coffeeMax,
        'hydra-range-coffee', 'hydra-range-label-coffee', String(coffeeRangeLo), String(coffeeRangeHi));
      addLine(mugBody, coffeeCautionMax, coffeeMax,
        'hydra-range-caution', 'hydra-range-label-caution', '20 limit');
    }

    // Count up
    function countUpHydra(el, target) {
      if (!el) return;
      var startTime = null;
      function step(ts) {
        if (!startTime) startTime = ts;
        var p = Math.min((ts - startTime) / 1200, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + ' oz';
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    countUpHydra(wVal, waterOz);
    countUpHydra(cVal, coffeeOz);
  }

  // ===== LEAFLET MAP =====
  function initMap() {
    var mapEl = document.getElementById('leafletMap');
    if (!mapEl || typeof L === 'undefined') return;

    var data = window.__profileData;
    if (!data || !data.coordinates) return;

    var lat = data.coordinates[0];
    var lng = data.coordinates[1];

    var map = L.map('leafletMap', {
      center: [lat, lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

    var pulseIcon = L.divIcon({
      className: '',
      html: '<div class="map-marker-pulse"><div class="map-marker-ring"></div><div class="map-marker-dot"></div></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    L.marker([lat, lng], { icon: pulseIcon }).addTo(map);
    setTimeout(function () { map.invalidateSize(); }, 300);
  }

  // ===== TERMINAL TYPING =====
  function initTerminal() {
    var termBody = document.getElementById('terminalBody');
    if (!termBody) return;

    var lineEls = termBody.querySelectorAll('.terminal-line');
    if (!lineEls.length) return;

    var items = [];
    lineEls.forEach(function (el) {
      var type = el.getAttribute('data-type') || 'output';
      items.push({ el: el, type: type });
    });

    function typeText(spanEl, text, callback) {
      var i = 0;
      function next() {
        if (i < text.length) {
          spanEl.textContent += text[i];
          i++;
          setTimeout(next, 30);
        } else if (callback) {
          callback();
        }
      }
      next();
    }

    function revealLine(idx) {
      if (idx >= items.length) return;
      var item = items[idx];
      item.el.classList.add('visible');

      if (item.type === 'prompt') {
        var cmdSpan = item.el.querySelector('.terminal-command');
        var cmdText = item.el.getAttribute('data-cmd') || '';
        typeText(cmdSpan, cmdText, function () {
          setTimeout(function () { revealLine(idx + 1); }, 200);
        });
      } else if (item.type === 'output') {
        var outSpan = item.el.querySelector('.terminal-output');
        var outText = item.el.getAttribute('data-output') || '';
        typeText(outSpan, outText, function () {
          setTimeout(function () { revealLine(idx + 1); }, 80);
        });
      } else if (item.type === 'blank') {
        setTimeout(function () { revealLine(idx + 1); }, 400);
      } else if (item.type === 'cursor') {
        // cursor line just stays visible
      }
    }

    var termCard = termBody.closest('.tri-card');
    if ('IntersectionObserver' in window && termCard) {
      var termObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            setTimeout(function () { revealLine(0); }, 500);
            termObs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });
      termObs.observe(termCard);
    } else {
      setTimeout(function () { revealLine(0); }, 800);
    }
  }

  // ===== WORKOUT TOGGLE =====
  function initWorkouts() {
    var toggle = document.getElementById('workoutToggle');
    var track = document.getElementById('workoutToggleTrack');
    var wBody = document.getElementById('workoutsBody');
    var timestamp = document.getElementById('workoutTimestamp');
    if (!toggle || !wBody) return;

    var healthData = window.__healthData;
    if (!healthData) return;

    var sampleWorkouts = healthData.sampleWorkouts || [];
    var mockWorkouts = healthData.workouts || [];
    var isLive = false;

    function fmtWDuration(seconds) {
      var h = Math.floor(seconds / 3600);
      var m = Math.floor((seconds % 3600) / 60);
      var s = Math.round(seconds % 60);
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm' + (s > 0 ? ' ' + s + 's' : '');
    }

    function getWorkoutIcon(type) {
      if (type === 'Outdoor Walk') {
        return '<svg class="workout-sub-icon" viewBox="0 0 28 28" fill="none">' +
          '<circle cx="14" cy="5" r="3" fill="var(--neon-pink)" opacity="0.8"/>' +
          '<path d="M14 8 L14 17 M14 12 L9 15 M14 12 L19 15 M12 27 L14 17 L16 27" stroke="var(--neon-pink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>' +
          '</svg>';
      }
      if (type === "Barry's Bootcamp") {
        return '<svg class="workout-sub-icon" viewBox="0 0 28 28" fill="none">' +
          '<rect x="3" y="12" width="22" height="4" rx="2" stroke="var(--neon-pink)" stroke-width="1.8" opacity="0.8"/>' +
          '<rect x="1" y="10" width="4" height="8" rx="1.5" stroke="var(--neon-pink)" stroke-width="1.5" opacity="0.6"/>' +
          '<rect x="23" y="10" width="4" height="8" rx="1.5" stroke="var(--neon-pink)" stroke-width="1.5" opacity="0.6"/>' +
          '<circle cx="8" cy="14" r="3" stroke="var(--neon-pink)" stroke-width="1.2" opacity="0.5"/>' +
          '<circle cx="20" cy="14" r="3" stroke="var(--neon-pink)" stroke-width="1.2" opacity="0.5"/>' +
          '</svg>';
      }
      return '<svg class="workout-sub-icon" viewBox="0 0 28 28" fill="none">' +
        '<circle cx="14" cy="14" r="10" stroke="var(--neon-pink)" stroke-width="1.8" opacity="0.6"/>' +
        '<path d="M14 8 L14 14 L19 14" stroke="var(--neon-pink)" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>' +
        '</svg>';
    }

    function renderRestDay() {
      wBody.innerHTML =
        '<div class="workout-rest-center">' +
          '<svg class="workout-rest-icon" viewBox="0 0 56 56" fill="none">' +
            '<circle cx="28" cy="20" r="10" stroke="var(--neon-pink)" stroke-width="1.5" opacity="0.7"/>' +
            '<path d="M16 38 Q20 32 28 30 Q36 32 40 38" stroke="var(--neon-pink)" stroke-width="1.5" opacity="0.5" fill="none"/>' +
            '<path d="M12 44 Q18 38 28 36 Q38 38 44 44" stroke="var(--neon-blue)" stroke-width="1" opacity="0.3" fill="none"/>' +
            '<circle cx="28" cy="20" r="3" fill="var(--neon-pink)" opacity="0.6"/>' +
            '<path d="M24 18 Q28 14 32 18" stroke="rgba(255,255,255,0.3)" stroke-width="0.8" fill="none"/>' +
          '</svg>' +
          '<div class="workout-rest-heading">Recovery Day</div>' +
          '<div class="workout-rest-sub">No workouts recorded</div>' +
          '<div class="workout-rest-insight">Your body recovers while you rest</div>' +
        '</div>';
    }

    function renderWorkouts(workouts) {
      wBody.innerHTML = '';
      workouts.forEach(function (w) {
        var distHtml = w.distance > 0
          ? '<div class="workout-stat"><div class="workout-stat-label">Distance</div><div class="workout-stat-value">' + (w.distance / 1000).toFixed(2) + ' km</div></div>'
          : '';

        var card = document.createElement('div');
        card.className = 'workout-sub-card';
        card.innerHTML =
          '<div class="workout-sub-top">' + getWorkoutIcon(w.activity_type) +
          '<div class="workout-sub-type">' + w.activity_type + '</div></div>' +
          '<div class="workout-sub-stats">' +
          '<div class="workout-stat"><div class="workout-stat-label">Duration</div><div class="workout-stat-value">' + fmtWDuration(w.duration) + '</div></div>' +
          '<div class="workout-stat"><div class="workout-stat-label">Calories</div><div class="workout-stat-value">' + Math.round(w.energy_burned) + ' kcal</div></div>' +
          distHtml +
          '</div>';
        wBody.appendChild(card);
      });
    }

    function render() {
      if (isLive) {
        if (track) track.classList.add('active');
        if (timestamp) timestamp.textContent = 'feb 11';
        renderWorkouts(sampleWorkouts);
      } else {
        if (track) track.classList.remove('active');
        if (timestamp) timestamp.textContent = 'today';
        if (mockWorkouts && mockWorkouts.length > 0) {
          renderWorkouts(mockWorkouts);
        } else {
          renderRestDay();
        }
      }
    }

    toggle.addEventListener('click', function () {
      isLive = !isLive;
      render();
    });

    render();
  }

  // ===== BOOK MODAL =====
  function initBookModal() {
    var bookOverlay = document.getElementById('bookOverlay');
    var bookModal = document.getElementById('bookModal');
    if (!bookOverlay || !bookModal) return;

    var booksData = window.__booksData;
    if (!booksData) return;

    var bookMeta = booksData.bookMeta || {};
    var statusLabels = booksData.statusLabels || {};

    function openBookModal(b) {
      var asin = b.asin || b.isbn;
      var m = bookMeta[asin] || {};
      var cover = 'https://m.media-amazon.com/images/P/' + asin + '.01._SCLZZZZZZZ_SX200_.jpg';

      var html = '<div class="book-modal-header">';
      html += '<img class="book-modal-cover" src="' + cover + '" width="80" height="120">';
      html += '<div class="book-modal-info">';
      if (m.series) html += '<div class="book-modal-series">' + m.series + '</div>';
      html += '<div class="book-modal-title">' + b.title + '</div>';
      html += '<div class="book-modal-author">' + b.author + '</div>';
      if (b.rating) {
        html += '<div class="book-modal-stars">';
        for (var s = 1; s <= 5; s++) html += '<span class="' + (s <= b.rating ? 'star-on' : 'star-off') + '">' + (s <= b.rating ? '\u2605' : '\u2606') + '</span>';
        html += '</div>';
      }
      html += '</div>';
      html += '<div class="book-modal-close" id="bookModalClose">&times;</div>';
      html += '</div>';

      html += '<div class="book-modal-body">';
      html += '<div class="book-modal-stats">';
      html += '<div class="book-modal-stat"><div class="book-modal-stat-val">' + (m.pages || '\u2014') + '</div><div class="book-modal-stat-label">Pages</div></div>';
      html += '<div class="book-modal-stat"><div class="book-modal-stat-val">' + (m.year || '\u2014') + '</div><div class="book-modal-stat-label">Published</div></div>';
      html += '<div class="book-modal-stat"><div class="book-modal-stat-val shelf-book-status shelf-status-' + b.status + '" style="font-size:0.7rem;margin:0">' + (statusLabels[b.status] || b.status) + '</div><div class="book-modal-stat-label">Status</div></div>';
      html += '</div>';

      if (b.status === 'in_progress') {
        html += '<div><div class="book-modal-progress"><div class="book-modal-progress-fill" style="width:' + b.progress + '%"></div></div>';
        html += '<div class="book-modal-progress-label">' + b.progress + '% complete</div></div>';
      }

      if (m.desc) html += '<div class="book-modal-desc">' + m.desc + '</div>';

      if (m.genres) {
        html += '<div class="book-modal-tags">';
        m.genres.forEach(function (g) { html += '<span class="book-modal-tag">' + g + '</span>'; });
        html += '</div>';
      }

      html += '<div><a href="' + b.link + '" target="_blank" rel="noopener" class="book-modal-amazon">View on Amazon &rarr;</a></div>';
      html += '</div>';

      bookModal.innerHTML = html;
      bookOverlay.classList.add('visible');

      document.getElementById('bookModalClose').addEventListener('click', function () {
        bookOverlay.classList.remove('visible');
      });
    }

    bookOverlay.addEventListener('click', function (e) {
      if (e.target === bookOverlay) bookOverlay.classList.remove('visible');
    });

    // Attach click handlers to shelf books
    var shelfBooks = document.querySelectorAll('.shelf-book[data-book]');
    shelfBooks.forEach(function (el) {
      el.addEventListener('click', function () {
        try {
          var bookData = JSON.parse(el.getAttribute('data-book'));
          openBookModal(bookData);
        } catch (e) {
          // ignore parse errors
        }
      });
    });
  }


})();
