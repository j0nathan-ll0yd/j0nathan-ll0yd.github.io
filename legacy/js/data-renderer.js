/**
 * data-renderer.js — Populates all widgets from MOCK_DATA and HEALTH_DATA
 */
(function() {

  // ===== COUNT UP ANIMATION =====
  function countUp(element, target, duration, suffix, isFloat) {
    var start = 0;
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
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  }

  // ===== STAGGERED CARD FADE-IN =====
  setTimeout(function() {
    document.getElementById('identityCard').classList.add('visible');
  }, 100);
  setTimeout(function() {
    document.getElementById('cardBio').classList.add('visible');
  }, 250);
  setTimeout(function() {
    document.getElementById('cardSystem').classList.add('visible');
  }, 550);

  var columns = document.querySelectorAll('.triptych-column');
  columns.forEach(function(col, colIdx) {
    var colCards = col.querySelectorAll('.tri-card');
    colCards.forEach(function(card, rowIdx) {
      setTimeout(function() {
        card.classList.add('visible');
      }, 400 + colIdx * 150 + rowIdx * 100);
    });
  });

  // ===== POPULATE DATA =====
  var d = window.MOCK_DATA;
  if (!d) return;

  // Identity Panel
  document.getElementById('idAvatar').src = d.profile.avatar;
  document.getElementById('idName').textContent = d.profile.name;
  document.getElementById('idTitle').textContent = d.profile.title;
  document.getElementById('idBio').textContent = d.profile.bio;
  document.getElementById('idLinks').innerHTML =
    '<a href="' + d.profile.github + '" class="neon-pill" target="_blank" rel="noopener noreferrer">GitHub</a>' +
    '<a href="' + d.profile.linkedin + '" class="neon-pill" target="_blank" rel="noopener noreferrer">LinkedIn</a>';

  // === Heart Rate — Pulse Monitor ===
  (function() {
    var hr = HEALTH_DATA.quantities.heartRate.value;
    var hrv = Math.round(HEALTH_DATA.quantities.hrvSDNN.value);

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

    var card = document.getElementById('cardHR');
    card.className = card.className.replace(/tri-card-accent-\w+/g, '');
    card.classList.add(state.accentClass);

    var dot = card.querySelector('.live-dot');
    dot.className = dot.className.replace(/live-dot-\w+/g, '');
    dot.classList.add(state.dotClass);

    var bpmEl = document.getElementById('pulseBpm');
    bpmEl.style.color = state.bpmColor;
    bpmEl.style.textShadow = state.bpmShadow;

    setTimeout(function() {
      countUp(bpmEl, hr, 1200);
    }, 500);

    var badge = document.getElementById('pulseStatusBadge');
    badge.textContent = state.zone;
    badge.style.color = state.badgeColor;
    badge.style.background = state.badgeBg;
    badge.style.border = '1px solid ' + state.badgeBorder;

    var hrvEl = document.getElementById('pulseHrvValue');
    hrvEl.textContent = hrv;
    hrvEl.style.color = hrvColor;
    hrvEl.style.textShadow = hrvShadow;

    var ecgLine = document.getElementById('ecgPath');
    ecgLine.style.stroke = state.ecgStroke;
    var ecgSvg = card.querySelector('.ecg-svg');
    ecgSvg.style.animationDuration = state.ecgSpeed;
    card.querySelector('.hr-ecg-bg').style.opacity = state.ecgOpacity;

    function buildECGPath(heartRate) {
      var segmentWidth = 100;
      var baseline = 55;
      var segments = 8;
      var spikeScale = Math.min(heartRate / 80, 1.8);
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
      return path;
    }
    ecgLine.setAttribute('d', buildECGPath(hr));
  })();

  // === Activity — Split View ===
  (function() {
    var q = HEALTH_DATA.quantities;
    var left = document.getElementById('splitColLeft');
    var right = document.getElementById('splitColRight');

    left.innerHTML =
      '<div class="split-col-title">Movement</div>' +
      '<div class="split-metric">' +
        '<div class="split-metric-label">Steps</div>' +
        '<div class="split-metric-value">' + Math.round(q.stepCount.value).toLocaleString() + '</div>' +
      '</div>' +
      '<div class="split-metric">' +
        '<div class="split-metric-label">Distance</div>' +
        '<div class="split-metric-value">' + Math.round(q.distanceWalkingRunning.value) + '<span class="split-metric-unit">m</span></div>' +
      '</div>' +
      '<div class="split-metric">' +
        '<div class="split-metric-label">Exercise</div>' +
        '<div class="split-metric-value">' + q.exerciseTime.value + '<span class="split-metric-unit">min</span></div>' +
      '</div>';

    right.innerHTML =
      '<div class="split-col-title">Energy</div>' +
      '<div class="split-metric">' +
        '<div class="split-metric-label">Active</div>' +
        '<div class="split-metric-value">' + Math.round(q.activeEnergyBurned.value) + '<span class="split-metric-unit">kcal</span></div>' +
      '</div>' +
      '<div class="split-metric">' +
        '<div class="split-metric-label">Basal</div>' +
        '<div class="split-metric-value">' + Math.round(q.basalEnergyBurned.value) + '<span class="split-metric-unit">kcal</span></div>' +
      '</div>' +
      '<div class="split-metric">' +
        '<div class="split-metric-label">Total</div>' +
        '<div class="split-metric-value">' + Math.round(HEALTH_DERIVED.totalCalories) + '<span class="split-metric-unit">kcal</span></div>' +
      '</div>';
  })();

  // === Workouts / Rest Day Widget ===
  (function() {
    var wBody = document.getElementById('workoutsBody');
    var toggle = document.getElementById('workoutToggle');
    var track = document.getElementById('workoutToggleTrack');
    var timestamp = document.getElementById('workoutTimestamp');

    var realWorkouts = [
      { activity_type: 'Outdoor Walk', duration: 646, energy_burned: 65, distance: 1134 },
      { activity_type: "Barry's Bootcamp", duration: 2929, energy_burned: 454, distance: 0 },
      { activity_type: 'Outdoor Walk', duration: 671, energy_burned: 104, distance: 1126 }
    ];

    var mockWorkouts = HEALTH_DATA.workouts;
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
      workouts.forEach(function(w) {
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
        track.classList.add('active');
        timestamp.textContent = 'feb 11';
        renderWorkouts(realWorkouts);
      } else {
        track.classList.remove('active');
        timestamp.textContent = 'today';
        var hasWorkouts = mockWorkouts && mockWorkouts.length > 0;
        if (hasWorkouts) {
          renderWorkouts(mockWorkouts);
        } else {
          renderRestDay();
        }
      }
    }

    toggle.addEventListener('click', function() {
      isLive = !isLive;
      render();
    });

    render();
  })();

  // === Sleep Widget — Moon Summary ===
  (function() {
    var sleepEl = document.getElementById('sleepMoonWidget');
    var sl = HEALTH_DATA.sleep;
    var sd = HEALTH_DERIVED;
    var score = computeSleepScore();

    var moonSvg = '<svg width="70" height="70" viewBox="0 0 80 80">' +
      '<defs><filter id="moonGlow"><feGaussianBlur stdDeviation="3" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      '<circle cx="40" cy="40" r="28" fill="#a855f7" opacity="0.15" filter="url(#moonGlow)"/>' +
      '<circle cx="40" cy="40" r="28" fill="none" stroke="#a855f7" stroke-width="1.5" opacity="0.4"/>' +
      '<path d="M40,12 A28,28 0 1,1 40,68 A20,20 0 1,0 40,12" fill="#a855f7" opacity="0.3" filter="url(#moonGlow)"/>' +
      '<circle cx="34" cy="30" r="3" fill="rgba(168,85,247,0.2)"/>' +
      '<circle cx="48" cy="45" r="2" fill="rgba(168,85,247,0.15)"/>' +
      '</svg>';

    var html = '<div class="sleep-moon-top">' +
      '<div class="sleep-moon-wrap">' + moonSvg + '</div>' +
      '<div class="sleep-moon-info">' +
        '<div class="sleep-moon-hero">' + formatDuration(sd.totalSleepSeconds) + '</div>' +
        '<div class="sleep-moon-score-row">' +
          '<span class="sleep-moon-score-label">Score</span>' +
          '<div class="sleep-moon-score-track"><div class="sleep-moon-score-fill" style="width:' + score + '%"></div></div>' +
          '<span class="sleep-moon-score-val">' + score + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    var pills = [
      { label: 'Deep',  sec: sl.deep.seconds,  color: '#1e40af' },
      { label: 'REM',   sec: sl.rem.seconds,   color: '#a855f7' },
      { label: 'Core',  sec: sl.core.seconds,  color: '#3a86ff' },
      { label: 'Awake', sec: sl.awake.seconds, color: '#f59e0b' }
    ];

    html += '<div class="sleep-moon-pills">';
    pills.forEach(function(p, i) {
      html += '<div class="sleep-moon-pill" style="background:' + p.color + '15;animation-delay:' + (i * 0.1 + 0.3) + 's">' +
        '<div class="sleep-moon-pill-label">' + p.label + '</div>' +
        '<div class="sleep-moon-pill-val" style="color:' + p.color + '">' + formatDuration(p.sec) + '</div>' +
      '</div>';
    });
    html += '</div>';

    html += '<div class="sleep-moon-insight"><span>' + sd.deepPct + '% deep</span> &mdash; <span>' +
      sd.remPct + '% REM</span> &mdash; restorative sleep</div>';

    sleepEl.innerHTML = html;
  })();

  // === GitHub Heatmap Widget ===
  var gridEl = document.getElementById('contribGrid');
  var weeks = d.github.contributions;
  weeks.forEach(function(week) {
    var col = document.createElement('div');
    col.className = 'contrib-week';
    week.forEach(function(level) {
      var cell = document.createElement('div');
      cell.className = 'contrib-cell';
      cell.setAttribute('data-level', level);
      col.appendChild(cell);
    });
    gridEl.appendChild(col);
  });

  var statsHTML = '';
  var statsData = [
    { value: d.github.stats.repos, label: 'Repos' },
    { value: d.github.stats.stars, label: 'Stars' },
    { value: d.github.stats.contributions.toLocaleString(), label: 'Contributions' }
  ];
  statsData.forEach(function(s) {
    statsHTML +=
      '<div><div class="gh-stat-value">' + s.value + '</div>' +
      '<div class="gh-stat-label">' + s.label + '</div></div>';
  });
  document.getElementById('ghStats').innerHTML = statsHTML;

  // === Recent Commits Widget ===
  var commitsHTML = '';
  d.github.recentCommits.forEach(function(c) {
    commitsHTML +=
      '<div class="commit-line">' +
        '<span class="cm-hash">' + c.hash + '</span> ' +
        '<span class="cm-msg">' + c.message + '</span> ' +
        '<span class="cm-repo">' + c.repo + '</span>' +
        '<span class="cm-date">' + c.date + '</span>' +
      '</div>';
  });
  document.getElementById('commitsList').innerHTML = commitsHTML;

  // === Reading Feed Widget ===
  var listEl = document.getElementById('articleList');
  d.reading.forEach(function(a, i) {
    var li = document.createElement('li');
    li.className = 'article-list-item';
    li.style.animationDelay = (i * 0.07) + 's';

    var starSpan = document.createElement('span');
    starSpan.className = 'article-list-star' + (a.starred ? ' visible' : '');
    starSpan.innerHTML = '&#9733;';

    var contentDiv = document.createElement('div');
    contentDiv.className = 'article-list-content';

    var titleDiv = document.createElement('div');
    titleDiv.className = 'article-list-title';
    titleDiv.textContent = a.title;

    var metaDiv = document.createElement('div');
    metaDiv.className = 'article-list-meta';

    var sourceSpan = document.createElement('span');
    sourceSpan.className = 'article-list-source';
    sourceSpan.textContent = a.source;

    var sep = document.createElement('span');
    sep.style.color = 'rgba(255,255,255,0.15)';
    sep.textContent = '\u00b7';

    var dateSpan = document.createElement('span');
    dateSpan.className = 'article-list-date';
    dateSpan.textContent = a.date;

    metaDiv.appendChild(sourceSpan);
    metaDiv.appendChild(sep);
    metaDiv.appendChild(dateSpan);
    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(metaDiv);
    li.appendChild(starSpan);
    li.appendChild(contentDiv);
    listEl.appendChild(li);
  });

  // === Bookshelf Widget ===
  if (d.books) {
    var statusOrder = { next: 0, in_progress: 1, completed: 2 };
    var statusLabels = { next: 'Up Next', in_progress: 'Reading', completed: 'Recently Finished' };
    var sortedBooks = d.books.slice().sort(function(a, b) {
      return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
    });

    var bookMeta = {
      '0525573844': { series: 'The Founders Trilogy #1', pages: 505, genres: ['Fantasy', 'Sci-Fi'], year: 2018, desc: 'In a city that runs on industrialized magic, a talented thief joins a secret war against the magical slave lords who run the city with their decadent hijacked sorcery.' },
      '1984820710': { series: 'Shadow of the Leviathan #1', pages: 432, genres: ['Fantasy', 'Mystery'], year: 2024, desc: 'In an empire threatened by titanic creatures, an eccentric investigator and her assistant must solve a mysterious murder in a classic whodunit set in a fantastical world. Hugo Award Winner.' },
      '0593723848': { series: 'Shadow of the Leviathan #2', pages: 461, genres: ['Fantasy', 'Mystery'], year: 2025, desc: 'Ana and Din return to investigate a new series of impossible crimes in the outer rings, where the boundary between human civilization and leviathan territory grows thin.' },
      '0593128508': { series: 'The Scholomance #1', pages: 336, genres: ['Fantasy', 'Dark Academia'], year: 2020, desc: 'A school for the magically gifted where failure means death. El Higgins is determined to survive, but dark forces have other plans for her extraordinary powers.' },
      'B0FBRJY116': { series: null, pages: 310, genres: ['Tech', 'Leadership'], year: 2025, desc: 'A practical guide to making thoughtful engineering decisions that solve complex organizational problems, from the author of Staff Engineer and An Elegant Puzzle.' }
    };

    var bookOverlay = document.getElementById('bookOverlay');
    var bookModal = document.getElementById('bookModal');

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
      html += '<div class="book-modal-stat"><div class="book-modal-stat-val shelf-book-status shelf-status-' + b.status + '" style="font-size:0.7rem;margin:0">' + statusLabels[b.status] + '</div><div class="book-modal-stat-label">Status</div></div>';
      html += '</div>';

      if (b.status === 'in_progress') {
        html += '<div><div class="book-modal-progress"><div class="book-modal-progress-fill" style="width:' + b.progress + '%"></div></div>';
        html += '<div class="book-modal-progress-label">' + b.progress + '% complete</div></div>';
      }

      if (m.desc) html += '<div class="book-modal-desc">' + m.desc + '</div>';

      if (m.genres) {
        html += '<div class="book-modal-tags">';
        m.genres.forEach(function(g) { html += '<span class="book-modal-tag">' + g + '</span>'; });
        html += '</div>';
      }

      html += '<div><a href="' + b.link + '" target="_blank" rel="noopener" class="book-modal-amazon">View on Amazon &rarr;</a></div>';
      html += '</div>';

      bookModal.innerHTML = html;
      bookOverlay.classList.add('visible');

      document.getElementById('bookModalClose').addEventListener('click', function() {
        bookOverlay.classList.remove('visible');
      });
    }

    bookOverlay.addEventListener('click', function(e) {
      if (e.target === bookOverlay) bookOverlay.classList.remove('visible');
    });

    var shelfEl = document.getElementById('dashShelfRow');
    sortedBooks.slice(0, 5).forEach(function(b, i) {
      var div = document.createElement('div');
      div.className = 'shelf-book';
      div.style.animationDelay = (i * 0.08) + 's';

      var coverSrc = 'https://m.media-amazon.com/images/P/' + (b.asin || b.isbn) + '.01._SCLZZZZZZZ_SX200_.jpg';
      var html = '<div class="shelf-cover-wrapper">';
      html += '<img src="' + coverSrc + '" width="80" height="120" alt="" loading="lazy" onerror="this.style.background=\'linear-gradient(135deg, rgba(6,214,160,0.2), rgba(58,134,255,0.15))\';this.style.border=\'1px solid rgba(6,214,160,0.2)\';this.src=\'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7\'">';
      html += '</div>';
      html += '<div class="shelf-book-title"><span>' + b.title + '</span></div>';
      html += '<div class="shelf-book-author">' + b.author + '</div>';
      html += '<div class="shelf-book-status shelf-status-' + b.status + '">' + statusLabels[b.status] + '</div>';

      div.innerHTML = html;
      div.addEventListener('click', function() { openBookModal(b); });
      shelfEl.appendChild(div);
    });
  }

  // === Hydration Widget ===
  (function() {
    var waterOz = 72;
    var coffeeOz = 24;
    var waterMax = 140;
    var coffeeMax = 48;
    var waterRangeLo = 74, waterRangeHi = 125;
    var coffeeRangeLo = 24, coffeeRangeHi = 40;
    var coffeeCautionMax = 20;

    var waterPct = Math.min(waterOz / waterMax, 1);
    var coffeePct = Math.min(coffeeOz / coffeeMax, 1);

    var wLiq = document.getElementById('hydraWaterLiq');
    var cLiq = document.getElementById('hydraCoffeeLiq');
    wLiq.style.height = '0%';
    cLiq.style.height = '0%';

    requestAnimationFrame(function() {
      wLiq.style.height = (waterPct * 100) + '%';
      cLiq.style.height = (coffeePct * 100) + '%';
    });

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
    addRange(bottleBody, waterRangeLo, waterRangeHi, waterMax,
      'hydra-range-water', 'hydra-range-label-water', '74', '125');

    var mugBody = document.querySelector('.hydra-mug-body');
    addRange(mugBody, coffeeRangeLo, coffeeRangeHi, coffeeMax,
      'hydra-range-coffee', 'hydra-range-label-coffee', '24', '40');
    addLine(mugBody, coffeeCautionMax, coffeeMax,
      'hydra-range-caution', 'hydra-range-label-caution', '20 limit');

    function countUpHydra(el, target) {
      var start = 0, startTime = null;
      function step(ts) {
        if (!startTime) startTime = ts;
        var p = Math.min((ts - startTime) / 1200, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(start + (target - start) * eased) + ' oz';
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    countUpHydra(document.getElementById('hydraWaterVal'), waterOz);
    countUpHydra(document.getElementById('hydraCoffeeVal'), coffeeOz);
  })();

  // === Location Widget ===
  document.getElementById('locCity').textContent = d.profile.location.split(',')[0];
  document.getElementById('locCoords').textContent =
    d.profile.coordinates[0].toFixed(4) + '\u00b0N, ' +
    Math.abs(d.profile.coordinates[1]).toFixed(4) + '\u00b0W';

  var lat = d.profile.coordinates[0];
  var lng = d.profile.coordinates[1];

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

  setTimeout(function() { map.invalidateSize(); }, 300);

  // === Bio — Terminal ===
  var termBody = document.getElementById('terminalBody');
  var profile = d.profile;

  var termLines = [
    { type: 'prompt', text: '$ cat about.txt' },
    { type: 'output', text: '\u2192 ' + profile.name },
    { type: 'output', text: '\u2192 ' + profile.title },
    { type: 'output', text: '\u2192 "' + profile.bio.split('.')[0] + '."' },
    { type: 'blank', text: '' },
    { type: 'prompt', text: '$ ls skills/' },
    { type: 'output', text: '\u2192 javascript  typescript  python  swift  go' },
    { type: 'blank', text: '' },
    { type: 'prompt', text: '$ uptime' },
    { type: 'output', text: '\u2192 15+ years and counting' },
    { type: 'blank', text: '' },
    { type: 'prompt', text: '$ cat philosophy.txt' },
    { type: 'output', text: '\u2192 "Ship fast, learn faster"' },
    { type: 'blank', text: '' },
    { type: 'prompt', text: '$ wc -l interests/' },
    { type: 'output', text: '\u2192 distributed systems, developer tools, ML/AI, open source' },
    { type: 'cursor', text: '' }
  ];

  var termLineEls = [];
  termLines.forEach(function(line) {
    var div = document.createElement('div');
    div.className = 'terminal-line';

    if (line.type === 'cursor') {
      div.innerHTML = '<span class="terminal-prompt">$ </span><span class="terminal-cursor"></span>';
    } else if (line.type === 'blank') {
      div.innerHTML = '&nbsp;';
    } else if (line.type === 'prompt') {
      var parts = line.text.split(' ');
      div.innerHTML = '<span class="terminal-prompt">' + parts[0] + ' </span><span class="terminal-command"></span>';
      div.setAttribute('data-cmd', parts.slice(1).join(' '));
    } else {
      var arrowIdx = line.text.indexOf('\u2192');
      if (arrowIdx === 0) {
        div.innerHTML = '<span class="terminal-arrow">\u2192 </span><span class="terminal-output"></span>';
        div.setAttribute('data-output', line.text.substring(2));
      } else {
        div.innerHTML = '<span class="terminal-output"></span>';
        div.setAttribute('data-output', line.text);
      }
    }

    termBody.appendChild(div);
    termLineEls.push({ el: div, data: line });
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

  function revealTermLine(idx) {
    if (idx >= termLineEls.length) return;
    var item = termLineEls[idx];
    item.el.classList.add('visible');

    if (item.data.type === 'prompt') {
      var cmdSpan = item.el.querySelector('.terminal-command');
      typeText(cmdSpan, item.el.getAttribute('data-cmd') || '', function() {
        setTimeout(function() { revealTermLine(idx + 1); }, 200);
      });
    } else if (item.data.type === 'output') {
      var outSpan = item.el.querySelector('.terminal-output');
      typeText(outSpan, item.el.getAttribute('data-output') || '', function() {
        setTimeout(function() { revealTermLine(idx + 1); }, 80);
      });
    } else if (item.data.type === 'blank') {
      setTimeout(function() { revealTermLine(idx + 1); }, 400);
    }
  }

  var termCard = termBody.closest('.tri-card');
  if ('IntersectionObserver' in window && termCard) {
    var termObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          setTimeout(function() { revealTermLine(0); }, 500);
          termObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    termObs.observe(termCard);
  } else {
    setTimeout(function() { revealTermLine(0); }, 800);
  }

  // === System Status Widget ===
  var sysLines = [
    { key: 'System', value: 'ONLINE', dotClass: 'sys-dot-green', valClass: 'sys-val-green' },
    { key: 'Uptime', value: '13,547 days', dotClass: 'sys-dot-green', valClass: 'sys-val' },
    { key: 'Coffee Level', value: 'HIGH', dotClass: 'sys-dot-amber', valClass: 'sys-val-amber' },
    { key: 'Focus Mode', value: 'ACTIVE', dotClass: 'sys-dot-green', valClass: 'sys-val-green' },
    { key: 'Current Streak', value: '12 days', dotClass: 'sys-dot-green', valClass: 'sys-val-green' },
    { key: 'Bug Count', value: '0', dotClass: 'sys-dot-green', valClass: 'sys-val-green' }
  ];
  var sysHTML = '';
  sysLines.forEach(function(line, idx) {
    sysHTML +=
      '<div class="sys-line" style="animation-delay: ' + (idx * 0.1) + 's">' +
        '<div class="sys-dot ' + line.dotClass + '" style="animation-delay: ' + (idx * 0.3) + 's"></div>' +
        '<span class="sys-key">' + line.key + ':</span>' +
        '<span class="' + line.valClass + '">' + line.value + '</span>' +
      '</div>';
  });
  document.getElementById('systemStatus').innerHTML = sysHTML;

})();
