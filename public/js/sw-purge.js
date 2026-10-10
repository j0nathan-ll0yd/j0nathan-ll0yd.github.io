/* Service-worker purge of retired runtime caches (atlas decision 0160, PR 0b).
 *
 * Loaded into the generated sw.js through Workbox 'importScripts'
 * (astro.config.mjs), so it runs in the service-worker global scope, not in a
 * page. It ships verbatim from public/js, so it keeps the syntax of its sibling
 * sw-register.js (var / function only).
 *
 * The 'live-data' cache held CloudFront JSON, focus.json included, under a
 * NetworkFirst route that replayed it after a 3 s timeout or offline. The
 * 'local-images' cache was written by a route whose regex tested the whole
 * URL, so a gated feed requested with an image path in its query string was
 * stored there and replayed for up to 30 days. Both routes are gone (the image
 * route now writes 'local-images-v2'), so no new entry is written. A returning
 * visitor still has the old entries on disk until this handler deletes them
 * when the new worker activates. Keep a retired name here until every old worker is gone; a delete
 * of an absent cache is a no-op. This handler runs only if the new worker
 * activates, so public/js/sw-register.js also deletes the cache from the page
 * on every load. */
(function () {
  var RETIRED_CACHES = ['live-data', 'local-images'];

  self.addEventListener('activate', function (event) {
    event.waitUntil(Promise.all(RETIRED_CACHES.map(function (name) {
      return caches['delete'](name)['catch'](function () { return false; });
    })));
  });
})();
