// Decodes the obfuscated email links that src/lib/email/ObfuscatedText.astro renders
// (atlas decision 0158: email obfuscation stays). Each <a data-email="..."> holds an XOR-encoded
// address: the first hex byte is the key, every later byte is one character XOR the key. The link
// becomes mailto:<address> with the address as its text. Same steps as decodeEmail in
// src/lib/email/obfuscate.ts.
(function () {
  'use strict';
  function decode(encoded) {
    var key = parseInt(encoded.substr(0, 2), 16);
    var out = '';
    for (var i = 2; i < encoded.length; i += 2) {
      out += String.fromCharCode(parseInt(encoded.substr(i, 2), 16) ^ key);
    }
    return out;
  }
  function run() {
    var links = document.querySelectorAll('a[data-email]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var address = decode(link.getAttribute('data-email') || '');
      if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(address)) {
        continue;
      }
      link.setAttribute('href', 'mailto:' + address);
      link.textContent = address;
      link.removeAttribute('data-email');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
