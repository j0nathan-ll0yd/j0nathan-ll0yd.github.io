(function () {
  var fmt = null;
  try { fmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) {}
  function tick() {
    var el = document.getElementById('liveClock'); if (!el) return;
    var now = new Date();
    if (fmt) { el.textContent = fmt.format(now); return; }
    el.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
  }
  tick();
  setInterval(tick, 1000);
})();
