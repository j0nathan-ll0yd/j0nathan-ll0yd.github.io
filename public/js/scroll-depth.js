(function() {
  var depths = [25, 50, 75, 100];
  var tracked = {};
  window.addEventListener('scroll', function() {
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return;
    var scrollPct = Math.round((window.scrollY / docHeight) * 100);
    for (var i = 0; i < depths.length; i++) {
      if (scrollPct >= depths[i] && !tracked[depths[i]]) {
        tracked[depths[i]] = true;
        if (window.sa_event) sa_event('scroll_depth_' + depths[i]);
      }
    }
  });
})();
