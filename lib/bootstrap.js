(function () {
  try {
    var MARK = '__DSH_IDLE_CRT__';
    // Already loaded (hot reload / duplicated injection row): keep the first one.
    if (window[MARK] && window[MARK].state && window[MARK].state !== 'booting') return;
    if (!window[MARK]) window[MARK] = { state: 'booting' };
    var ROUTE = '@@ROUTE@@';
    var VERSION = '@@VERSION@@';

    try {
      window[MARK].version = VERSION;
      window[MARK].state = 'booting';
    } catch (e) {}

    // Nothing is hidden or covered here on purpose: this is an idle screen. It
    // has to be able to appear LATER, and the page must boot exactly as before.
    var load = function () {
      try {
        var host = document.body || document.head || document.documentElement;
        if (!host) return;
        var el = document.createElement('script');
        el.src = ROUTE + '/client.js';
        el.async = false;
        el.onerror = function () {
          try { window[MARK].state = 'client-load-failed' } catch (e) {}
          try { console.warn('[dsh-idle-crt] client half failed to load') } catch (e) {}
        };
        host.appendChild(el);
      } catch (e) {
        try { window[MARK].state = 'client-load-threw' } catch (e2) {}
      }
    };
    if (document.body) load();
    else document.addEventListener('DOMContentLoaded', load, { once: true });
  } catch (e) {
    // Swallowed on purpose: the page must never fail to boot because of us.
  }
})();
