#!/usr/bin/env node
/**
 * generate-json.js — Converts JS data modules into static JSON files
 * Run once: node data/generate-json.js
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname);

// ===== Random generators (run once, freeze output) =====

function generateContributionGrid() {
  const grid = [];
  for (let week = 0; week < 52; week++) {
    const weekData = [];
    for (let day = 0; day < 7; day++) {
      const rand = Math.random();
      let value;
      if (rand < 0.3) value = 0;
      else if (rand < 0.6) value = 1;
      else if (rand < 0.8) value = 2;
      else if (rand < 0.95) value = 3;
      else value = 4;
      if (day === 0 || day === 6) value = Math.max(0, value - 1);
      weekData.push(value);
    }
    grid.push(weekData);
  }
  return grid;
}

function generateHourlySteps() {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    let base = 0;
    if (h >= 7 && h <= 9) base = 600 + Math.random() * 400;
    else if (h >= 12 && h <= 13) base = 800 + Math.random() * 600;
    else if (h >= 17 && h <= 19) base = 500 + Math.random() * 800;
    else if (h >= 10 && h <= 16) base = 100 + Math.random() * 300;
    else base = Math.random() * 50;
    hours.push(Math.round(base));
  }
  return hours;
}

function generateHourlyHR() {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    let base;
    if (h >= 0 && h <= 6) base = 55 + Math.random() * 8;
    else if (h >= 7 && h <= 9) base = 68 + Math.random() * 15;
    else if (h >= 12 && h <= 13) base = 75 + Math.random() * 20;
    else if (h >= 17 && h <= 19) base = 80 + Math.random() * 25;
    else base = 62 + Math.random() * 12;
    hours.push({
      avg: Math.round(base),
      min: Math.round(base - 5 - Math.random() * 5),
      max: Math.round(base + 5 + Math.random() * 10)
    });
  }
  return hours;
}

function generateHypnogram() {
  const timeline = [];
  let time = 22.5;
  const patterns = [
    { stage: 'awake', dur: 0.25 },
    { stage: 'light', dur: 0.5 }, { stage: 'deep', dur: 1.0 },
    { stage: 'light', dur: 0.5 }, { stage: 'rem', dur: 0.4 },
    { stage: 'light', dur: 0.3 }, { stage: 'deep', dur: 0.8 },
    { stage: 'light', dur: 0.5 }, { stage: 'rem', dur: 0.6 },
    { stage: 'awake', dur: 0.1 },
    { stage: 'light', dur: 0.4 }, { stage: 'deep', dur: 0.5 },
    { stage: 'light', dur: 0.3 }, { stage: 'rem', dur: 0.7 },
    { stage: 'light', dur: 0.4 }, { stage: 'rem', dur: 0.5 },
    { stage: 'awake', dur: 0.15 }
  ];
  patterns.forEach(function(p) {
    const start = time;
    time += p.dur;
    timeline.push({ stage: p.stage, start: start, end: time });
  });
  return timeline;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

// ===== Generate data =====

// HEALTH_DATA (from health-data.js)
const HEALTH_DATA = {
  date: "2026-02-10",
  quantities: {
    activeEnergyBurned:     { value: 72.71,  unit: "kcal" },
    exerciseTime:           { value: 1,      unit: "min" },
    standTime:              { value: 4,      unit: "min" },
    basalEnergyBurned:      { value: 821.20, unit: "kcal" },
    distanceWalkingRunning: { value: 295.68, unit: "m" },
    heartRate:              { value: 58,     unit: "count/min" },
    hrvSDNN:                { value: 30.24,  unit: "ms" },
    respiratoryRate:        { value: 12.5,   unit: "count/min" },
    restingHeartRate:       { value: 52,     unit: "count/min" },
    stepCount:              { value: 364,    unit: "count" }
  },
  sleep: {
    awake: { seconds: 1143 },
    core:  { seconds: 12833 },
    deep:  { seconds: 1047 },
    rem:   { seconds: 6611 }
  },
  workouts: []
};

const HEALTH_RANGES = {
  heartRate:       { low: 50, normal: [60, 100], high: 120, unit: "bpm" },
  restingHeartRate:{ excellent: [0, 60], good: [60, 70], fair: [70, 80], poor: [80, 200] },
  hrvSDNN:         { poor: [0, 20], fair: [20, 40], good: [40, 60], excellent: [60, 200] },
  respiratoryRate: { low: [0, 12], normal: [12, 20], high: [20, 40] },
  stepCount:       { goal: 10000 },
  activeEnergy:    { goal: 300 },
  exerciseTime:    { goal: 30 },
  standTime:       { goal: 60 },
  sleep: {
    targetHours:   7,
    deepPctIdeal:  [13, 23],
    remPctIdeal:   [20, 25],
    efficiencyGood: 85
  }
};

// Derived values
const s = HEALTH_DATA.sleep;
const q = HEALTH_DATA.quantities;
const totalSleepSeconds = s.core.seconds + s.deep.seconds + s.rem.seconds;
const timeInBedSeconds  = totalSleepSeconds + s.awake.seconds;
const sleepEfficiency   = timeInBedSeconds > 0
  ? Math.round((totalSleepSeconds / timeInBedSeconds) * 1000) / 10
  : 0;
const totalCalories     = q.activeEnergyBurned.value + q.basalEnergyBurned.value;
const distanceKm        = Math.round(q.distanceWalkingRunning.value / 10) / 100;
const deepPct  = totalSleepSeconds > 0 ? (s.deep.seconds / totalSleepSeconds) * 100 : 0;
const remPct   = totalSleepSeconds > 0 ? (s.rem.seconds / totalSleepSeconds) * 100 : 0;
const corePct  = totalSleepSeconds > 0 ? (s.core.seconds / totalSleepSeconds) * 100 : 0;

const HEALTH_DERIVED = {
  totalSleepSeconds,
  timeInBedSeconds,
  sleepEfficiency,
  totalCalories: Math.round(totalCalories * 100) / 100,
  distanceKm,
  deepPct: Math.round(deepPct * 10) / 10,
  remPct: Math.round(remPct * 10) / 10,
  corePct: Math.round(corePct * 10) / 10
};

// Sleep score
function computeSleepScore() {
  const totalHours = HEALTH_DERIVED.totalSleepSeconds / 3600;
  const durationScore = Math.min(totalHours / 7, 1) * 30;
  const deepIdeal = 18;
  const deepDiff = Math.abs(HEALTH_DERIVED.deepPct - deepIdeal);
  const deepScore = Math.max(0, 1 - deepDiff / 18) * 25;
  const remIdeal = 22.5;
  const remDiff = Math.abs(HEALTH_DERIVED.remPct - remIdeal);
  const remScore = Math.max(0, 1 - remDiff / 22.5) * 25;
  const effScore = Math.min(HEALTH_DERIVED.sleepEfficiency / 85, 1) * 20;
  return Math.round(durationScore + deepScore + remScore + effScore);
}

// Sample workouts for the "live" toggle
const sampleWorkouts = [
  { activity_type: 'Outdoor Walk', duration: 646, energy_burned: 65, distance: 1134 },
  { activity_type: "Barry's Bootcamp", duration: 2929, energy_burned: 454, distance: 0 },
  { activity_type: 'Outdoor Walk', duration: 671, energy_burned: 104, distance: 1126 }
];

// MOCK_DATA profile
const profile = {
  name: "Jonathan Lloyd",
  title: "Senior Software Engineer",
  location: "San Francisco, CA",
  coordinates: [37.7749, -122.4194],
  linkedin: "https://www.linkedin.com/in/lifegames/",
  github: "https://github.com/j0nathan-ll0yd",
  bio: "Building things that matter. Passionate about elegant code, distributed systems, and the intersection of technology and human experience.",
  avatar: "assets/avatar.svg"
};

// Terminal bio lines (derived from profile, matching data-renderer.js lines 676-693)
const terminalLines = [
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

// ===== Write JSON files =====

// 1. profile.json
const profileData = { ...profile, terminalLines };
fs.writeFileSync(path.join(dataDir, 'profile.json'), JSON.stringify(profileData, null, 2));
console.log('Wrote profile.json');

// 2. health.json
const sleepScore = computeSleepScore();
const healthData = {
  date: HEALTH_DATA.date,
  quantities: HEALTH_DATA.quantities,
  sleep: HEALTH_DATA.sleep,
  workouts: HEALTH_DATA.workouts,
  ranges: HEALTH_RANGES,
  derived: HEALTH_DERIVED,
  sleepScore,
  sleepDurationFormatted: formatDuration(HEALTH_DERIVED.totalSleepSeconds),
  sleepPhaseFormatted: {
    deep: formatDuration(s.deep.seconds),
    rem: formatDuration(s.rem.seconds),
    core: formatDuration(s.core.seconds),
    awake: formatDuration(s.awake.seconds)
  },
  sampleWorkouts,
  hydration: {
    waterOz: 72,
    coffeeOz: 24,
    waterMax: 140,
    coffeeMax: 48,
    waterRangeLo: 74,
    waterRangeHi: 125,
    coffeeRangeLo: 24,
    coffeeRangeHi: 40,
    coffeeCautionMax: 20
  }
};
fs.writeFileSync(path.join(dataDir, 'health.json'), JSON.stringify(healthData, null, 2));
console.log('Wrote health.json');

// 3. github.json
const githubData = {
  contributions: generateContributionGrid(),
  totalContributions: 1847,
  contributionTypes: {
    commits: 1203,
    pullRequests: 289,
    issues: 142,
    reviews: 198,
    repositories: 15
  },
  streak: { current: 12, longest: 47 },
  languages: {
    JavaScript: 432500,
    TypeScript: 298620,
    Python: 145300,
    Swift: 87432,
    Go: 54200,
    CSS: 38100,
    HTML: 22400,
    Shell: 8900
  },
  recentCommits: [
    { hash: "a1b2c3d", message: "Fix auth token refresh", repo: "myapp", date: "2h ago", additions: 24, deletions: 8 },
    { hash: "e4f5g6h", message: "Add rate limiting middleware", repo: "api-gateway", date: "1d ago", additions: 156, deletions: 12 },
    { hash: "i7j8k9l", message: "Update dependencies", repo: "myapp", date: "2d ago", additions: 48, deletions: 52 },
    { hash: "m0n1o2p", message: "Implement WebSocket handlers", repo: "realtime-service", date: "3d ago", additions: 312, deletions: 45 },
    { hash: "q3r4s5t", message: "Refactor database queries", repo: "api-gateway", date: "5d ago", additions: 89, deletions: 134 }
  ],
  commitHours: [2, 0, 0, 0, 0, 1, 3, 5, 12, 18, 22, 15, 8, 14, 20, 19, 16, 10, 6, 4, 5, 8, 6, 3],
  weeklyCommits: [15, 22, 18, 31, 12, 25, 19, 28, 14, 23, 17, 20],
  stats: { repos: 42, stars: 128, contributions: 1847 },
  topRepos: [
    { name: "myapp", stars: 45, language: "TypeScript", description: "Personal app" },
    { name: "api-gateway", stars: 32, language: "Go", description: "API gateway service" },
    { name: "realtime-service", stars: 28, language: "JavaScript", description: "WebSocket service" },
    { name: "ml-pipeline", stars: 15, language: "Python", description: "ML data pipeline" },
    { name: "ios-app", stars: 8, language: "Swift", description: "iOS companion app" }
  ]
};
fs.writeFileSync(path.join(dataDir, 'github.json'), JSON.stringify(githubData, null, 2));
console.log('Wrote github.json');

// 4. reading.json
const readingData = {
  articles: [
    { title: "Why SQLite Is So Great for the Edge", source: "fly.io/blog", date: "Today", category: "Tech", starred: true },
    { title: "The End of Localhost", source: "dx.tips", date: "Yesterday", category: "Tech", starred: false },
    { title: "Building AI Agents That Actually Work", source: "anthropic.com", date: "2 days ago", category: "AI", starred: true },
    { title: "CSS Container Queries Are Here", source: "web.dev", date: "3 days ago", category: "Web", starred: false },
    { title: "Rust for JavaScript Developers", source: "rustforjs.dev", date: "4 days ago", category: "Languages", starred: false },
    { title: "The Architecture of a Modern Startup", source: "danluu.com", date: "5 days ago", category: "Tech", starred: true },
    { title: "Why We Chose Turso Over PlanetScale", source: "chiselstrike.com", date: "6 days ago", category: "Databases", starred: false },
    { title: "Understanding V8 Internals", source: "mrale.ph", date: "1 week ago", category: "Web", starred: false }
  ],
  stats: {
    totalSubscriptions: 47,
    unreadCount: 128,
    articlesThisWeek: 23,
    articlesLastWeek: 19,
    starredCount: 34
  }
};
fs.writeFileSync(path.join(dataDir, 'reading.json'), JSON.stringify(readingData, null, 2));
console.log('Wrote reading.json');

// 5. books.json
const booksData = {
  books: [
    { title: "Foundryside", author: "Robert Jackson Bennett",
      isbn: "9780525573844", asin: "0525573844", link: "https://amzn.to/3Mr9KEO",
      status: "in_progress", rating: null, progress: 42 },
    { title: "The Tainted Cup", author: "Robert Jackson Bennett",
      isbn: "9781984820710", asin: "1984820710", link: "https://amzn.to/3ZR4VrD",
      status: "completed", rating: 5, progress: 100 },
    { title: "A Drop of Corruption", author: "Robert Jackson Bennett",
      isbn: "9780593723848", asin: "0593723848", link: "https://amzn.to/4ae9LoP",
      status: "completed", rating: 4, progress: 100 },
    { title: "A Deadly Education", author: "Naomi Novik",
      isbn: "9780593128508", asin: "0593128508", link: "https://amzn.to/461xW7g",
      status: "completed", rating: 4, progress: 100 },
    { title: "Crafting Engineering Strategy", author: "Will Larson",
      isbn: "B0FBRJY116", asin: "B0FBRJY116", link: "https://amzn.to/3ZR52n3",
      status: "next", rating: null, progress: 0 }
  ],
  bookMeta: {
    '0525573844': { series: 'The Founders Trilogy #1', pages: 505, genres: ['Fantasy', 'Sci-Fi'], year: 2018, desc: 'In a city that runs on industrialized magic, a talented thief joins a secret war against the magical slave lords who run the city with their decadent hijacked sorcery.' },
    '1984820710': { series: 'Shadow of the Leviathan #1', pages: 432, genres: ['Fantasy', 'Mystery'], year: 2024, desc: 'In an empire threatened by titanic creatures, an eccentric investigator and her assistant must solve a mysterious murder in a classic whodunit set in a fantastical world. Hugo Award Winner.' },
    '0593723848': { series: 'Shadow of the Leviathan #2', pages: 461, genres: ['Fantasy', 'Mystery'], year: 2025, desc: 'Ana and Din return to investigate a new series of impossible crimes in the outer rings, where the boundary between human civilization and leviathan territory grows thin.' },
    '0593128508': { series: 'The Scholomance #1', pages: 336, genres: ['Fantasy', 'Dark Academia'], year: 2020, desc: 'A school for the magically gifted where failure means death. El Higgins is determined to survive, but dark forces have other plans for her extraordinary powers.' },
    'B0FBRJY116': { series: null, pages: 310, genres: ['Tech', 'Leadership'], year: 2025, desc: 'A practical guide to making thoughtful engineering decisions that solve complex organizational problems, from the author of Staff Engineer and An Elegant Puzzle.' }
  },
  statusLabels: { next: 'Up Next', in_progress: 'Reading', completed: 'Recently Finished' },
  stats: { totalRead: 3, currentlyReading: 1, upNext: 1, avgRating: 4.3, booksThisYear: 4 }
};
fs.writeFileSync(path.join(dataDir, 'books.json'), JSON.stringify(booksData, null, 2));
console.log('Wrote books.json');

// 6. system.json
const systemData = {
  lines: [
    { key: 'System', value: 'ONLINE', dotClass: 'sys-dot-green', valClass: 'sys-val-green' },
    { key: 'Uptime', value: '13,547 days', dotClass: 'sys-dot-green', valClass: 'sys-val' },
    { key: 'Coffee Level', value: 'HIGH', dotClass: 'sys-dot-amber', valClass: 'sys-val-amber' },
    { key: 'Focus Mode', value: 'ACTIVE', dotClass: 'sys-dot-green', valClass: 'sys-val-green' },
    { key: 'Current Streak', value: '12 days', dotClass: 'sys-dot-green', valClass: 'sys-val-green' },
    { key: 'Bug Count', value: '0', dotClass: 'sys-dot-green', valClass: 'sys-val-green' }
  ]
};
fs.writeFileSync(path.join(dataDir, 'system.json'), JSON.stringify(systemData, null, 2));
console.log('Wrote system.json');

console.log('\nAll JSON files generated successfully.');
