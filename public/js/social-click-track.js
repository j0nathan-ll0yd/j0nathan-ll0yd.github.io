/* social-click-track.js -- consumer-side social-click analytics for the
 * IdentityCard widget (CSP script-src 'self'). The DS IdentityCard ships
 * scriptless; per its production-wrapper contract the consumer attaches the
 * delegated click handler here. ES5 only (W9). Loaded via
 * <script is:inline src="/js/social-click-track.js" defer> from Dashboard.astro.
 * Platform is derived from the link text (lowercased), matching the prior
 * inline IIFE's behavior. */
(function() {
  document.body.addEventListener('click', function(e) {
    var link = e.target.closest && e.target.closest('.id-links a');
    if (!link) return;
    var platform = (link.textContent || '').trim().toLowerCase();
    if (!platform) return;
    if (typeof window.sa_event === 'function') {
      window.sa_event('social_click', { platform: platform });
    }
  });
})();
