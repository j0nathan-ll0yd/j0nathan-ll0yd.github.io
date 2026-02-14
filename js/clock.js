/**
 * clock.js — Live clock updater
 */
function updateClock() {
  var el = document.getElementById('liveClock');
  if (!el) return;
  var now = new Date();
  var h = String(now.getHours()).padStart(2, '0');
  var m = String(now.getMinutes()).padStart(2, '0');
  var s = String(now.getSeconds()).padStart(2, '0');
  el.textContent = h + ':' + m + ':' + s;
}
updateClock();
setInterval(updateClock, 1000);
