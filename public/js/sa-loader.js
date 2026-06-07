(function() {
  function loadSA() {
    var scripts = [
      'https://scripts.simpleanalyticscdn.com/latest.js',
      'https://scripts.simpleanalyticscdn.com/auto-events.js'
    ];
    scripts.forEach(function(src) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onerror = function() {};
      document.body.appendChild(s);
    });
  }
  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadSA, { timeout: 3000 });
  } else {
    setTimeout(loadSA, 2000);
  }
})();
