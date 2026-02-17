/**
 * component-library.js — Empty/active state toggle for component library pages
 */
(function() {
  // Make all tri-cards visible immediately (no staggered fade-in on library pages)
  document.querySelectorAll('.tri-card').forEach(function(card) {
    card.classList.add('visible');
  });
  document.querySelectorAll('.identity-card').forEach(function(card) {
    card.classList.add('visible');
  });
  document.querySelectorAll('.left-panel-status').forEach(function(card) {
    card.classList.add('visible');
  });
  document.querySelectorAll('.left-panel-bio').forEach(function(card) {
    card.classList.add('visible');
  });

  // Toggle buttons for empty/active states
  document.querySelectorAll('[data-toggle-state]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = document.getElementById(btn.getAttribute('data-toggle-state'));
      if (target) {
        target.classList.toggle('state-empty');
        target.classList.toggle('state-active');
      }
    });
  });
})();
