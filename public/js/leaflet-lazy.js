(function() {
  var loaded = false;
  function loadLeaflet(callback) {
    if (loaded) { if (callback) callback(); return; }
    var s = document.createElement('script');
    s.src = '/vendor/leaflet/leaflet.js';
    s.onload = function() { loaded = true; if (callback) callback(); };
    document.head.appendChild(s);
  }
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          var target = entries[i].target;
          loadLeaflet(function() {
            var evt = new CustomEvent('leaflet:ready', { detail: { container: target } });
            target.dispatchEvent(evt);
          });
          observer.unobserve(target);
        }
      }
    });
    var maps = document.querySelectorAll('[data-widget="map"]');
    for (var j = 0; j < maps.length; j++) { observer.observe(maps[j]); }
  }
  window.__loadLeaflet = loadLeaflet;
})();
