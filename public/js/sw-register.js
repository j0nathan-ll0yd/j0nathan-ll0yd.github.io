/* Service worker registration + graceful, no-interaction update controller.
 *
 * ES5 only: this file ships verbatim from public/js (no bundler, no transpile),
 * so it must parse in old engines -- var / function / IIFE only (W9).
 *
 * A new deploy installs a new service worker (Workbox skipWaiting + clientsClaim,
 * astro.config.mjs), which fires 'controllerchange'. Rather than reload abruptly,
 * defer to a non-disruptive moment (tab hidden, or 60s of no user input) and
 * preserve scroll position across the reload. The SW lifecycle is the single
 * reload trigger; the hourly registration.update() and window.__checkForSwUpdate
 * (called by the live-data WS runtime on a deploy push, Phase 2) are only nudges
 * that make the SW check sooner. The site is read-only, so a reload loses no
 * user input -- "graceful" only means non-disruptive timing + restored scroll.
 *
 * Plan: .omc/plans/graceful-deploy-auto-update-plan.md (Phase 1). */
(function () {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost') {
    return;
  }

  var IDLE_MS = 60000;            // no-user-input window before a safe reload
  var REFOCUS_STALE_MS = 60000;   // hidden duration that warrants a check on return
  var UPDATE_POLL_MS = 3600000;   // hourly registration.update() backstop
  var RELOAD_COOLDOWN_MS = 60000; // minimum gap between reloads (loop guard)
  var STATE_KEY = 'sw-update-state';
  var COOLDOWN_KEY = 'sw-update-last-reload';
  var DISABLED_KEY = 'sw-update-disabled';

  var registration = null;
  var hasPreviousController = !!navigator.serviceWorker.controller;
  var updatePending = false;
  var refreshing = false;
  var idleTimer = null;
  var hiddenAt = 0;

  function getSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function setSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) {}
  }
  function clearSession(key) {
    try { sessionStorage.removeItem(key); } catch (e) {}
  }

  function isDisabled() {
    return getSession(DISABLED_KEY) === '1';
  }

  function withinCooldown() {
    var last = getSession(COOLDOWN_KEY);
    if (!last) { return false; }
    var when = parseInt(last, 10);
    if (isNaN(when)) { return false; }
    return (Date.now() - when) < RELOAD_COOLDOWN_MS;
  }

  function capturePageState() {
    var x = window.scrollX;
    if (typeof x !== 'number') { x = window.pageXOffset || 0; }
    var y = window.scrollY;
    if (typeof y !== 'number') { y = window.pageYOffset || 0; }
    setSession(STATE_KEY, JSON.stringify({ x: x, y: y }));
  }

  function restorePageState() {
    var raw = getSession(STATE_KEY);
    if (!raw) { return; }
    clearSession(STATE_KEY);
    var state = null;
    try { state = JSON.parse(raw); } catch (e) { return; }
    if (!state) { return; }
    requestAnimationFrame(function () {
      window.scrollTo(state.x || 0, state.y || 0);
    });
  }

  function reloadNow() {
    if (refreshing) { return; }
    refreshing = true;
    if ('scrollRestoration' in history) {
      try { history.scrollRestoration = 'manual'; } catch (e) {}
    }
    capturePageState();
    setSession(COOLDOWN_KEY, String(Date.now()));
    location.reload();
  }

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function armIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (!updatePending || refreshing || document.hidden) { return; }
      if (isDisabled() || withinCooldown()) { return; }
      if ('requestIdleCallback' in window) {
        requestIdleCallback(function () { reloadNow(); }, { timeout: 2000 });
      } else {
        reloadNow();
      }
    }, IDLE_MS);
  }

  // Apply a pending update at the first non-disruptive moment.
  function applyUpdateWhenSafe() {
    if (!updatePending || refreshing) { return; }
    if (isDisabled() || withinCooldown()) { return; }
    if (document.hidden) {
      reloadNow();
      return;
    }
    armIdleTimer(); // visible: wait for user idle (or tab-hide via visibilitychange)
  }

  function onUserActivity() {
    if (!updatePending) { return; } // near-zero overhead until an update is pending
    armIdleTimer();                 // any interaction resets the idle countdown
  }

  function checkForSwUpdate() {
    if (!registration) { return; }
    if ('onLine' in navigator && !navigator.onLine) { return; }
    var result;
    try { result = registration.update(); } catch (e) { return; }
    if (result && typeof result.catch === 'function') {
      result.catch(function () {});
    }
  }
  window.__checkForSwUpdate = checkForSwUpdate;

  function onControllerChange() {
    if (refreshing) { return; }
    if (!hasPreviousController) {
      hasPreviousController = true; // first install: now controlled, do NOT reload
      return;
    }
    updatePending = true;
    applyUpdateWhenSafe();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      hiddenAt = Date.now();
      if (updatePending && !refreshing && !isDisabled() && !withinCooldown()) {
        reloadNow();
      }
      return;
    }
    var awayFor = hiddenAt ? (Date.now() - hiddenAt) : 0;
    hiddenAt = 0;
    if (updatePending) {
      applyUpdateWhenSafe();
    } else if (awayFor >= REFOCUS_STALE_MS) {
      checkForSwUpdate();
    }
  }

  // Attach lifecycle listeners synchronously. This script runs during body parse,
  // before 'load'/'pageshow', so the post-reload 'pageshow' that restores scroll
  // is never missed (it would be if these were behind the async register().then).
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', restorePageState);

  // No options object (strict ES5: old engines coerce it to useCapture). These
  // handlers never call preventDefault, and touch/scroll are passive by default
  // in modern engines, so the third argument is unnecessary.
  var activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
  for (var i = 0; i < activityEvents.length; i++) {
    window.addEventListener(activityEvents[i], onUserActivity);
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      registration = reg;
      setInterval(checkForSwUpdate, UPDATE_POLL_MS);
    }).catch(function () {
      // Registration failed -- no SW to control; updates fall back to navigation.
    });
  });
})();
