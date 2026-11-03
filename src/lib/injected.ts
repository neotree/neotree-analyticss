import { LOGIN_LOGO_DATA_URI } from '../assets/login-logo';
import { APP_CSS, LOGIN_CSS } from './webStyles';

const ACTIVITY_THROTTLE_MS = 5000;
const SETTLE_CAP_MS = 7000;
// Superset switches its menu to the stacked (mobile) layout at 767px. Use the narrowest desktop
// viewport and let Android fit it to the screen on load; users can then pinch zoom and pan.
const APP_VIEWPORT_WIDTH = 768;

function normalisePath(path: string) {
    return path.replace(/\/+$/, '').toLowerCase() || '/';
}

/**
 * Script injected after every page load:
 *  1. Makes the login form fit a phone without changing Superset's dashboard layout.
 *  2. Reports navigation and user activity to the app.
 */
export function buildInjectedScript(params: { landingPathname: string; supersetOrigin: string; }) {
    const landing = JSON.stringify(normalisePath(params.landingPathname));
    const origin = JSON.stringify(params.supersetOrigin);
    const logo = JSON.stringify(LOGIN_LOGO_DATA_URI);

    return `
(function () {
  try {
    if (window.__ntInit) return;
    window.__ntInit = true;

    function boot() {

    var path = location.pathname.replace(/\\/+$/, '').toLowerCase() || '/';
    var isLoginPath = path === ${landing} || /\\/login$/.test(path);
    if (location.origin === ${origin} && !document.getElementById('nt-filter-actions-style')) {
      var appStyle = document.createElement('style');
      appStyle.id = 'nt-filter-actions-style';
      appStyle.textContent = ${JSON.stringify(APP_CSS)};
      (document.head || document.documentElement).appendChild(appStyle);
    }
    if (location.origin === ${origin}) {
      // Login: device width. Everything else: a desktop-width layout that initially fits the phone;
      // pinch zoom and panning remain available once signed in.
      // This script runs before <body> exists, so everything that depends on the page is applied by
      // decorate(), which is idempotent and re-run (throttled) on every DOM change.
      var LOGIN_VIEWPORT = 'width=device-width, initial-scale=1, user-scalable=no';
      var APP_VIEWPORT = 'width=${APP_VIEWPORT_WIDTH}, user-scalable=yes, maximum-scale=5';
      var LOGIN_CSS = ${JSON.stringify(LOGIN_CSS)};
      var observedPath = location.pathname, loginActive = false;
      var onLoginPage = function () {
        var p = location.pathname.replace(/\\/+$/, '').toLowerCase() || '/';
        if (p === ${landing} || /\\/login$/.test(p)) return true;
        try { return !!document.querySelector('[data-test="login-form"], input[name="username"]'); } catch (e) { return false; }
      };
      var decorate = function () {
        var login = onLoginPage();
        observedPath = location.pathname;
        loginActive = login;
        var VIEWPORT = login ? LOGIN_VIEWPORT : APP_VIEWPORT;
        var viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
          viewport = document.createElement('meta');
          viewport.name = 'viewport';
          (document.head || document.documentElement).appendChild(viewport);
        }
        if (viewport.content !== VIEWPORT) viewport.content = VIEWPORT;

        var root = document.documentElement;
        if (root && root.classList) {
          if (login) root.classList.add('nt-login'); else root.classList.remove('nt-login');
        }
        if (!login) return;
        if (!document.getElementById('nt-mobile-style')) {
          var mobileStyle = document.createElement('style');
          mobileStyle.id = 'nt-mobile-style';
          mobileStyle.textContent = LOGIN_CSS;
          (document.head || document.documentElement).appendChild(mobileStyle);
        }
        var brand = document.querySelector('.navbar-brand');
        if (brand && !document.getElementById('nt-login-logo')) {
          var logo = document.createElement('img');
          logo.id = 'nt-login-logo';
          logo.src = ${logo};
          logo.alt = 'Neotree';
          brand.appendChild(logo);
        }
      };
      decorate();
      if (typeof MutationObserver !== 'undefined' && document.documentElement && document.documentElement.nodeType) {
        var decorateQueued = false;
        new MutationObserver(function (changes) {
          // Dashboards change their DOM often. Recheck only when navigation or the viewport meta changes;
          // login pages still need to watch for the form and brand row appearing after initial load.
          if (!loginActive && location.pathname === observedPath && !changes.some(function (change) {
            return change.target && (change.target.nodeName === 'HEAD'
              || (change.target.nodeName === 'META' && change.target.name === 'viewport'));
          })) return;
          if (decorateQueued) return;
          decorateQueued = true;
          window.requestAnimationFrame(function () { decorateQueued = false; decorate(); });
        }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
      }
    }

    // The native cover stays up until Superset's own interface is on screen, then hands over to it:
    // Superset's skeletons / spinners take over from there (they are NOT waited for). "On screen" means
    // the React root has rendered (menu, skeleton or any text); on the login page, the form itself.
    var SHELL = '.ant-skeleton, [data-test="loading-indicator"], .ant-menu, [role="menu"], nav, header';
    function postReady() {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'page-ready', url: location.href }));
    }
    function shellRendered() {
      var app = document.getElementById('app') || document.body;
      if (!app || app.childElementCount === 0) return false;
      if (typeof onLoginPage === 'function' && onLoginPage()) {
        return !!document.querySelector('input[name="username"], input[type="password"], [data-test="login-form"]');
      }
      return !!app.querySelector(SHELL) || String(app.innerText || '').replace(/\s+/g, '').length > 0;
    }
    function whenSettled(done) {
      if (typeof setTimeout !== 'function') { done(); return; }
      var started = Date.now(), quiet = 0;
      (function poll() {
        var ready = false;
        try { ready = shellRendered(); } catch (e) { ready = true; }
        quiet = ready ? quiet + 1 : 0;
        if (quiet >= 2 || Date.now() - started > ${SETTLE_CAP_MS}) done();
        else setTimeout(poll, 100);
      })();
    }
    function afterLoad() {
      function afterFonts() {
        window.requestAnimationFrame(function () {
          if (location.origin === ${origin} && isLoginPath) window.dispatchEvent(new Event('resize'));
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () { whenSettled(postReady); });
          });
        });
      }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(afterFonts, afterFonts);
      else afterFonts();
    }
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });

    // A submitted form (sign-in, filters on legacy pages) reloads the document. Tell the app as soon as the
    // navigation starts so it can show its spinner immediately instead of a blank white page. A submit that
    // never navigates (client-side validation failed) triggers nothing.
    var submitting = false;
    window.addEventListener('submit', function () { submitting = true; }, true);
    window.addEventListener('beforeunload', function () {
      if (!submitting) return;
      var login = typeof onLoginPage === 'function' && onLoginPage();
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'busy', label: login ? 'Signing in\u2026' : 'Loading\u2026' }));
    });

    var last = 0;
    function activity() {
      var now = Date.now();
      if (now - last < ${ACTIVITY_THROTTLE_MS}) return;
      last = now;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'activity' }));
    }
    ['touchstart', 'touchmove', 'scroll', 'click', 'keydown'].forEach(function (evt) {
      window.addEventListener(evt, activity, { passive: true, capture: true });
    });
    }

    // Runs before the document exists on some WebViews: wait for the root element, then set everything up.
    if (document.documentElement) boot();
    else if (typeof MutationObserver !== 'undefined') {
      var rootWatch = new MutationObserver(function () {
        if (document.documentElement) { rootWatch.disconnect(); boot(); }
      });
      rootWatch.observe(document, { childList: true });
    } else document.addEventListener('DOMContentLoaded', boot);
  } catch (e) {}
})();
true;
`;
}

/** Accept only the known message types from the page. */
export function isActivityMessage(data: string) {
    try {
        return JSON.parse(data)?.type === 'activity';
    } catch {
        return false;
    }
}

export function isPageReadyMessage(data: string, url: string) {
    try {
        const message = JSON.parse(data);
        return message?.type === 'page-ready' && message.url === url;
    } catch {
        return false;
    }
}

/** Label of a "busy" message (a form submit started a navigation), or null. */
export function readBusyLabel(data: string): string | null {
    try {
        const message = JSON.parse(data);
        return message?.type === 'busy' ? (typeof message.label === 'string' ? message.label.slice(0, 40) : 'Loading…') : null;
    } catch {
        return null;
    }
}

/** Any page-ready signal; the URL may legitimately differ from the load-start URL after redirects. */
export function isAnyPageReadyMessage(data: string) {
    try {
        return JSON.parse(data)?.type === 'page-ready';
    } catch {
        return false;
    }
}

/** URL carried by a page-ready message, or null. */
export function readyPageUrl(data: string): string | null {
    try {
        const message = JSON.parse(data);
        return message?.type === 'page-ready' && typeof message.url === 'string' ? message.url : null;
    } catch {
        return null;
    }
}

/** Identity of a page for cover decisions: origin + path. Query and hash changes are the same page. */
export function pageKey(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
        return null;
    }
}
