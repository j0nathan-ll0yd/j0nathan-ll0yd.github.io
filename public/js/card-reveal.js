(function() {
  setTimeout(function() {
    var id = document.getElementById('identityCard');
    if (id) id.classList.add('visible');
  }, 100);
  setTimeout(function() {
    var bio = document.getElementById('cardBio');
    if (bio) bio.classList.add('visible');
  }, 250);
  setTimeout(function() {
    var sys = document.getElementById('cardSystem');
    if (sys) sys.classList.add('visible');
  }, 550);

  var columns = document.querySelectorAll('.triptych-column');
  columns.forEach(function(col, colIdx) {
    var cards = col.querySelectorAll('.tri-card');
    cards.forEach(function(card, rowIdx) {
      setTimeout(function() {
        card.classList.add('visible');
      }, 400 + colIdx * 150 + rowIdx * 100);
    });
  });
})();
