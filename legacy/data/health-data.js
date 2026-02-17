/**
 * health-data.js — Real HealthKit daily-aggregate data model
 *
 * Structured for future API integration. All values are daily aggregates
 * matching the actual HealthKit export format.
 */

var HEALTH_DATA = {
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

// ===== REFERENCE RANGES =====
var HEALTH_RANGES = {
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

// ===== DERIVED VALUES =====
var HEALTH_DERIVED = (function() {
  var s = HEALTH_DATA.sleep;
  var q = HEALTH_DATA.quantities;

  var totalSleepSeconds = s.core.seconds + s.deep.seconds + s.rem.seconds;
  var timeInBedSeconds  = totalSleepSeconds + s.awake.seconds;
  var sleepEfficiency   = timeInBedSeconds > 0
    ? Math.round((totalSleepSeconds / timeInBedSeconds) * 1000) / 10
    : 0;
  var totalCalories     = q.activeEnergyBurned.value + q.basalEnergyBurned.value;
  var distanceKm        = Math.round(q.distanceWalkingRunning.value / 10) / 100;

  // Sleep phase percentages (of total sleep, not time in bed)
  var deepPct  = totalSleepSeconds > 0 ? (s.deep.seconds / totalSleepSeconds) * 100 : 0;
  var remPct   = totalSleepSeconds > 0 ? (s.rem.seconds / totalSleepSeconds) * 100 : 0;
  var corePct  = totalSleepSeconds > 0 ? (s.core.seconds / totalSleepSeconds) * 100 : 0;

  return {
    totalSleepSeconds: totalSleepSeconds,
    timeInBedSeconds:  timeInBedSeconds,
    sleepEfficiency:   sleepEfficiency,
    totalCalories:     Math.round(totalCalories * 100) / 100,
    distanceKm:        distanceKm,
    deepPct:           Math.round(deepPct * 10) / 10,
    remPct:            Math.round(remPct * 10) / 10,
    corePct:           Math.round(corePct * 10) / 10
  };
})();

// ===== UTILITY FUNCTIONS =====

/**
 * Format seconds into human-readable duration string
 * e.g. 12833 -> "3h 34m", 1047 -> "17m", 3600 -> "1h 0m"
 */
function formatDuration(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

/**
 * Animated count-up for a DOM element
 * @param {Element} el - Target element
 * @param {number} target - Final value
 * @param {number} duration - Animation duration in ms
 * @param {string} [suffix] - Optional suffix (e.g. '%', ' BPM')
 * @param {boolean} [isFloat] - Whether to show decimal
 */
function countUp(el, target, duration, suffix, isFloat) {
  if (!el) return;
  suffix = suffix || '';
  duration = duration || 1200;
  var startTime = null;
  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    var current = eased * target;
    if (isFloat) {
      el.textContent = current.toFixed(1) + suffix;
    } else {
      var rounded = Math.round(current);
      el.textContent = (rounded >= 1000 ? rounded.toLocaleString() : rounded) + suffix;
    }
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/**
 * Get status label and color for a value given range definitions
 * @param {number} value
 * @param {object} ranges - e.g. { poor: [0,20], fair: [20,40], good: [40,60], excellent: [60,200] }
 * @returns {{ label: string, color: string }}
 */
function getStatus(value, ranges) {
  var statusMap = {
    excellent: { label: 'Excellent', color: 'var(--neon-green)' },
    good:      { label: 'Good',      color: 'var(--neon-green)' },
    normal:    { label: 'Normal',    color: 'var(--neon-green)' },
    fair:      { label: 'Fair',      color: 'var(--neon-amber)' },
    poor:      { label: 'Poor',      color: 'var(--neon-pink)' },
    low:       { label: 'Low',       color: 'var(--neon-amber)' },
    high:      { label: 'High',      color: 'var(--neon-pink)' }
  };

  for (var key in ranges) {
    if (!ranges.hasOwnProperty(key)) continue;
    var range = ranges[key];
    if (Array.isArray(range) && value >= range[0] && value < range[1]) {
      return statusMap[key] || { label: key, color: 'var(--text-muted)' };
    }
  }
  return { label: 'N/A', color: 'var(--text-muted)' };
}

/**
 * Compute a 0-100 sleep score
 * Duration: 0-30 pts, Deep%: 0-25 pts, REM%: 0-25 pts, Efficiency: 0-20 pts
 */
function computeSleepScore() {
  var d = HEALTH_DERIVED;
  var totalHours = d.totalSleepSeconds / 3600;

  // Duration score (0-30): linear up to 7h = 30 pts, 8h+ = 30 pts
  var durationScore = Math.min(totalHours / 7, 1) * 30;

  // Deep % score (0-25): ideal 13-23%. Score based on how close to ideal range
  var deepIdeal = 18; // midpoint
  var deepDiff = Math.abs(d.deepPct - deepIdeal);
  var deepScore = Math.max(0, 1 - deepDiff / 18) * 25;

  // REM % score (0-25): ideal 20-25%
  var remIdeal = 22.5;
  var remDiff = Math.abs(d.remPct - remIdeal);
  var remScore = Math.max(0, 1 - remDiff / 22.5) * 25;

  // Efficiency score (0-20): 85%+ = full, linear below
  var effScore = Math.min(d.sleepEfficiency / 85, 1) * 20;

  return Math.round(durationScore + deepScore + remScore + effScore);
}

// Sample workout data for demo variations (workouts.html "with data" examples)
var SAMPLE_WORKOUTS = [
  {
    activity_type: "Running",
    duration: 1847,
    energy_burned: 312.5,
    distance: 4250,
    source: "Apple Watch"
  },
  {
    activity_type: "Strength Training",
    duration: 2700,
    energy_burned: 198.3,
    distance: 0,
    source: "Apple Watch"
  }
];
