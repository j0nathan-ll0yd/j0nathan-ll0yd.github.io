(function() {
  function loadSA() {
    var s = document.createElement('script');
    s.src = '/sa.js';
    s.async = true;
    s.onerror = function() {};
    document.body.appendChild(s);
  }
  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadSA, { timeout: 3000 });
  } else {
    setTimeout(loadSA, 2000);
  }
})();
