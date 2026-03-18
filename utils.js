/**
 * SatContact — общие утилиты (base URL и т.п.)
 */
(function () {
  'use strict';
  window.SatContactResolveUrl = function (relativePath) {
    const baseEl = document.querySelector('base');
    const base = baseEl ? (baseEl.href.replace(/\/?$/, '/') || './') : './';
    return base + (relativePath || '').replace(/^\//, '');
  };
})();
