/* Service-worker purge of retired runtime caches (atlas decision 0160, PR 0b).
 *
 * Loaded into the generated sw.js through Workbox `importScripts`
 * (astro.config.mjs), so it runs in the service-worker global scope, not in a
 * page. It ships verbatim from public/js, so it keeps the syntax of its sibling
 * sw-register.js (var / function only).
 *
 * The `live-data` cache held CloudFront JSON, focus.json included, under a
 * NetworkFirst route that replayed it after a 3 s timeout or offline. That
 * route is gone, so no new entry is written. A returning visitor still has the
 * old entries on disk until this handler deletes them when the new worker
 * activates. Keep a retired name here until every old worker is gone; a delete
 * of an absent cache is a no-op. */
(function () {
  var RETIRED_CACHES = ['live-data'];

  self.addEventListener('activate', function (event) {
    event.waitUntil(Promise.all(RETIRED_CACHES.map(function (name) {
      return caches.delete(name).catch(function () { return false; });
    })));
  });
})();
