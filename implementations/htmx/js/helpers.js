/**
 * helpers.js — Handlebars helpers for Command Center HTMX implementation
 * Must load AFTER Handlebars and BEFORE any templates render.
 */
(function () {
  if (typeof Handlebars === 'undefined') return;

  // formatDuration(seconds) → "3h 34m"
  Handlebars.registerHelper('formatDuration', function (seconds) {
    if (seconds == null) return '';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  });

  // round(value) → Math.round
  Handlebars.registerHelper('round', function (value) {
    return Math.round(value);
  });

  // toLocaleString(value) → formatted number
  Handlebars.registerHelper('toLocaleString', function (value) {
    return Number(value).toLocaleString();
  });

  // eq(a, b) → boolean equality
  Handlebars.registerHelper('eq', function (a, b) {
    return a === b;
  });

  // times(n, block) → iterate n times
  Handlebars.registerHelper('times', function (n, block) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += block.fn(i);
    }
    return out;
  });

  // lte(a, b) → less than or equal
  Handlebars.registerHelper('lte', function (a, b) {
    return a <= b;
  });

  // gt(a, b) → greater than
  Handlebars.registerHelper('gt', function (a, b) {
    return a > b;
  });

  // lt(a, b) → less than
  Handlebars.registerHelper('lt', function (a, b) {
    return a < b;
  });

  // json(context) → JSON.stringify
  Handlebars.registerHelper('json', function (context) {
    return JSON.stringify(context);
  });

  // multiply(a, b) → a * b
  Handlebars.registerHelper('multiply', function (a, b) {
    return a * b;
  });

  // add(a, b) → a + b
  Handlebars.registerHelper('add', function (a, b) {
    return a + b;
  });

  // toFixed(value, digits) → number to fixed decimal
  Handlebars.registerHelper('toFixed', function (value, digits) {
    return Number(value).toFixed(digits);
  });

  // divide(a, b) → a / b
  Handlebars.registerHelper('divide', function (a, b) {
    return b !== 0 ? a / b : 0;
  });

  // min(a, b) → Math.min
  Handlebars.registerHelper('min', function (a, b) {
    return Math.min(a, b);
  });

  // abs(value) → Math.abs
  Handlebars.registerHelper('abs', function (value) {
    return Math.abs(value);
  });

  // splitCity(location) → first part before comma
  Handlebars.registerHelper('splitCity', function (location) {
    return location ? location.split(',')[0] : '';
  });

  // hrZone(hr) → returns zone label
  Handlebars.registerHelper('hrZone', function (hr) {
    if (hr < 45) return 'Bradycardia';
    if (hr < 60) return 'Resting Zone';
    if (hr <= 100) return 'Normal Zone';
    if (hr <= 140) return 'Fat Burn';
    return 'Peak Zone';
  });
})();
