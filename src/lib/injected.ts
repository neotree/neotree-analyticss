import { LOGIN_LOGO_DATA_URI } from '../assets/login-logo';
import { APP_CSS, LOGIN_CSS } from './webStyles';

const ACTIVITY_THROTTLE_MS = 5000;
const SETTLE_CAP_MS = 7000;
// Superset switches its menu to the stacked layout below 768px. Phones need at
// least this much layout width; larger devices can use their own width.
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
      // Superset creates PDF/CSV/ZIP blobs and image data URLs in JavaScript.
      // Android WebView's HTTP download listener never sees those links.
      if (window.ReactNativeWebView && window.HTMLAnchorElement && !window.__ntExportBridge) {
        window.__ntExportBridge = true;
        var exportSequence = 0;
        var exportAcks = {};
        var activeBlobUrls = {};
        var deferredRevokes = {};
        var preparingExport = null;
        var originalRevoke = window.URL.revokeObjectURL.bind(window.URL);
        window.URL.revokeObjectURL = function (url) {
          if (activeBlobUrls[url]) deferredRevokes[url] = true;
          else originalRevoke(url);
        };
        var exportPost = function (message) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        };
        window.__ntDownloadAck = function (id, sequence, ok, error) {
          var key = id + ':' + sequence;
          var pending = exportAcks[key];
          if (!pending) return;
          delete exportAcks[key];
          clearTimeout(pending.timer);
          if (ok) pending.resolve(); else pending.reject(new Error(error || 'Could not save export'));
        };
        var exportSend = function (message) {
          return new Promise(function (resolve, reject) {
            message.sequence = ++exportSequence;
            var key = message.id + ':' + message.sequence;
            var timer = setTimeout(function () {
              delete exportAcks[key];
              reject(new Error('Saving export timed out'));
            }, 30000);
            exportAcks[key] = { resolve: resolve, reject: reject, timer: timer };
            exportPost(message);
          });
        };
        var readExportChunk = function (piece) {
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
            reader.onerror = function () { reject(new Error('Could not read export')); };
            reader.readAsDataURL(piece);
          });
        };
        var transferExport = async function (href, name) {
          if (preparingExport) { clearTimeout(preparingExport.timer); preparingExport = null; }
          var id = 'export_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
          exportPost({ type: 'export-prepare', id: id, name: name });
          if (href.slice(0, 5) === 'blob:') activeBlobUrls[href] = true;
          try {
            var response = await fetch(href);
            if (!response.ok) throw new Error('Could not read generated file');
            var blob = await response.blob();
            if (blob.size > 100 * 1024 * 1024) throw new Error('Export is larger than 100 MB');
            await exportSend({ type: 'export-start', id: id, name: name, mime: blob.type || 'application/octet-stream', size: blob.size });
            for (var offset = 0; offset < blob.size; offset += 48 * 1024) {
              var chunk = await readExportChunk(blob.slice(offset, offset + 48 * 1024));
              await exportSend({ type: 'export-chunk', id: id, data: chunk, downloaded: Math.min(offset + 48 * 1024, blob.size) });
            }
            await exportSend({ type: 'export-finish', id: id });
          } catch (error) {
            exportPost({ type: 'export-abort', id: id, name: name, error: String(error && error.message || error) });
          } finally {
            delete activeBlobUrls[href];
            if (deferredRevokes[href]) { delete deferredRevokes[href]; originalRevoke(href); }
          }
        };
        var handleExportLink = function (anchor) {
          var href = anchor.href;
          if (!anchor.download || !/^(blob:|data:)/.test(href)) return false;
          transferExport(href, anchor.download);
          return true;
        };
        var originalAnchorClick = window.HTMLAnchorElement.prototype.click;
        window.HTMLAnchorElement.prototype.click = function () {
          if (!handleExportLink(this)) return originalAnchorClick.apply(this, arguments);
        };
        document.addEventListener('click', function (event) {
          var anchor = event.target && event.target.closest && event.target.closest('a[download]');
          if (anchor && handleExportLink(anchor)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
        document.addEventListener('click', function (event) {
          var item = event.target && event.target.closest && event.target.closest('[role="menuitem"], .ant-dropdown-menu-item');
          if (!item) return;
          var label = (item.textContent || '').trim();
          if (!/^(export (to|as) pdf|download as image|export screenshot.*|export yaml|export as example|export.*csv|download.*csv|export.*excel)$/i.test(label)) return;
          if (preparingExport) clearTimeout(preparingExport.timer);
          var id = 'export_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
          exportPost({ type: 'export-prepare', id: id, name: label });
          preparingExport = { timer: setTimeout(function () {
            exportPost({ type: 'export-abort', id: id, name: label, error: 'No file was generated. Please try again.' });
            preparingExport = null;
          }, 120000) };
        }, true);
      }
      // Superset reserves a wide column for native filters when they start open.
      // On phones, start dashboards with Superset's own filter panel collapsed so
      // charts receive the full dashboard width. Its filter control still opens it.
      if (Number(window.screen && window.screen.width) < 700 && typeof history !== 'undefined') {
        var collapseDashboardUrl = function (value) {
          if (value == null) return value;
          try {
            var target = new URL(String(value), location.href);
            if (target.origin !== ${origin} || !/(^|\\/)superset\\/dashboard\\/[^/]+/.test(target.pathname)
              || target.searchParams.has('expand_filters')) return value;
            target.searchParams.set('expand_filters', '0');
            return target.href;
          } catch (e) { return value; }
        };
        if (typeof history.replaceState === 'function') {
          var originalReplace = history.replaceState.bind(history);
          var initialUrl = collapseDashboardUrl(location.href);
          if (initialUrl !== location.href) originalReplace(history.state, '', initialUrl);
          history.replaceState = function (state, title, url) {
            return originalReplace(state, title, collapseDashboardUrl(url));
          };
        }
        if (typeof history.pushState === 'function') {
          var originalPush = history.pushState.bind(history);
          history.pushState = function (state, title, url) {
            return originalPush(state, title, collapseDashboardUrl(url));
          };
        }
      }
      // The login form uses device width. Signed-in pages use at least 768 CSS pixels
      // so Superset's navigation and dashboards have room; Android fits that to phones.
      // This script runs before <body> exists, so everything that depends on the page is applied by
      // decorate(), which is idempotent and re-run (throttled) on every DOM change.
      var LOGIN_VIEWPORT = 'width=device-width, initial-scale=1, user-scalable=no';
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
        var screenWidth = Number(window.screen && window.screen.width);
        var APP_VIEWPORT = screenWidth >= ${APP_VIEWPORT_WIDTH}
          ? 'width=device-width, initial-scale=1, user-scalable=yes, maximum-scale=5'
          : 'width=${APP_VIEWPORT_WIDTH}, user-scalable=yes, maximum-scale=5';
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
      window.addEventListener('resize', decorate);

      // Superset owns the filter state and Apply action. The phone adds only a
      // larger entry point and changes where its existing panel is painted.
      var filterPanel = null;
      var filterBackdrop = null;
      var filterMetrics = '';
      var closePhoneFilters = function () {
        var collapse = document.querySelector('[data-test="filter-bar__collapse-button"]');
        if (collapse) collapse.click();
      };
      var updateFilterMetrics = function () {
        if (!filterPanel) return;
        var visual = window.visualViewport;
        var screenWidth = Number(window.screen && window.screen.width) || 360;
        var width = visual ? visual.width : window.innerWidth;
        var height = visual ? visual.height : window.innerHeight;
        var left = visual ? visual.offsetLeft : 0;
        var top = visual ? visual.offsetTop : 0;
        if (!width || !height) return;
        var scale = width / screenWidth;
        var panelWidth = Math.min(screenWidth * 0.92, 420);
        var values = [left, top, scale, panelWidth, height / scale].join(':');
        if (values !== filterMetrics) {
          filterMetrics = values;
          filterPanel.style.setProperty('--nt-filter-left', left + 'px');
          filterPanel.style.setProperty('--nt-filter-top', top + 'px');
          filterPanel.style.setProperty('--nt-filter-scale', String(scale));
          filterPanel.style.setProperty('--nt-filter-width', panelWidth + 'px');
          filterPanel.style.setProperty('--nt-filter-height', height / scale + 'px');
        }
        if (filterBackdrop) {
          filterBackdrop.style.left = left + 'px';
          filterBackdrop.style.top = top + 'px';
          filterBackdrop.style.width = width + 'px';
          filterBackdrop.style.height = height + 'px';
        }
      };
      var syncPhoneDashboard = function () {
        var mobileDashboard = Number(window.screen && window.screen.width) < 700
          && /(^|\\/)superset\\/dashboard\\/[^/]+/.test(location.pathname);
        var root = document.documentElement;
        if (root && root.classList) {
          if (mobileDashboard) root.classList.add('nt-dashboard-phone');
          else root.classList.remove('nt-dashboard-phone');
        }
        if (!mobileDashboard || !document.body || !document.body.appendChild) {
          if (filterBackdrop) { filterBackdrop.remove(); filterBackdrop = null; }
          var oldButton = document.getElementById('nt-open-filters');
          if (oldButton) oldButton.remove();
          filterPanel = null;
          filterMetrics = '';
          return;
        }
        // Header menu is portal-rendered. Keep its reading, sharing and download
        // actions, but remove dashboard authoring entries on the phone.
        var authoringLabels = /^(save as|edit properties|embed dashboard|set filter mapping)$/i;
        var menuItems = document.querySelectorAll('[data-test="header-actions-menu"] [role="menuitem"], [data-test="header-actions-menu"] li');
        for (var i = 0; i < menuItems.length; i++) {
          if (authoringLabels.test((menuItems[i].textContent || '').trim())) menuItems[i].style.display = 'none';
        }
        var panel = document.querySelector('[data-test="dashboard-filters-panel"]');
        var header = document.querySelector('[data-test="dashboard-header-container"]');
        if (!panel || !header) return;
        var button = document.getElementById('nt-open-filters');
        if (!button) {
          var edit = header.querySelector('[data-test="edit-dashboard-button"]');
          var anchor = edit && edit.parentElement || header.querySelector('.button-container') || header;
          button = document.createElement('button');
          button.id = 'nt-open-filters';
          button.type = 'button';
          button.setAttribute('aria-controls', 'nt-phone-filter-panel');
          button.onclick = function () {
            var bar = document.querySelector('[data-test="filter-bar"]');
            if (bar && bar.classList.contains('open')) closePhoneFilters();
            else {
              var expand = document.querySelector('[data-test="filter-bar__collapsable"]');
              if (expand) expand.click();
            }
          };
          if (edit && edit.parentElement) edit.parentElement.insertBefore(button, edit);
          else anchor.appendChild(button);
        }
        var visual = window.visualViewport;
        var screenWidth = Number(window.screen && window.screen.width) || 360;
        var ratio = ((visual && visual.width) || window.innerWidth || screenWidth) / screenWidth;
        button.style.fontSize = Math.round(15 * ratio) + 'px';
        button.style.minHeight = Math.round(38 * ratio) + 'px';
        button.style.padding = '0 ' + Math.round(13 * ratio) + 'px';
        var bar = panel.querySelector('[data-test="filter-bar"]');
        var open = !!bar && bar.classList.contains('open');
        button.textContent = open ? 'Close filters' : 'Filters';
        button.setAttribute('aria-expanded', String(open));
        if (!open) {
          if (filterBackdrop) { filterBackdrop.remove(); filterBackdrop = null; }
          filterPanel = null;
          filterMetrics = '';
          return;
        }
        panel.id = 'nt-phone-filter-panel';
        filterPanel = panel;
        if (!filterBackdrop) {
          filterBackdrop = document.createElement('div');
          filterBackdrop.id = 'nt-filter-backdrop';
          filterBackdrop.setAttribute('aria-label', 'Close filters');
          filterBackdrop.onclick = closePhoneFilters;
          document.body.appendChild(filterBackdrop);
        }
        updateFilterMetrics();
      };
      syncPhoneDashboard();
      if (typeof setInterval === 'function') setInterval(syncPhoneDashboard, 400);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateFilterMetrics);
        window.visualViewport.addEventListener('scroll', updateFilterMetrics);
      }
      window.addEventListener('resize', updateFilterMetrics);
      if (document.addEventListener) {
        document.addEventListener('click', function (event) {
          if (!document.documentElement.classList.contains('nt-dashboard-phone')) return;
          var headerTarget = event.target && event.target.closest && event.target.closest('[data-test="dashboard-header-container"]');
          if (headerTarget) {
            var statusTarget = event.target;
            while (statusTarget && statusTarget !== headerTarget) {
              if (/^(published|draft)$/i.test((statusTarget.textContent || '').trim())) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
              }
              statusTarget = statusTarget.parentElement;
            }
          }
          var authoring = event.target && event.target.closest && event.target.closest(
            '[data-test="edit-dashboard-button"], [data-test="dashboard-edit-actions"], button:has([data-test="filterbar-orientation-icon"]), [data-test="header-actions-menu"] [role="menuitem"], [data-test="header-actions-menu"] li'
          );
          if (authoring && (authoring.matches('[data-test="edit-dashboard-button"], [data-test="dashboard-edit-actions"], button:has([data-test="filterbar-orientation-icon"])')
            || /^(save as|edit properties|embed dashboard|set filter mapping)$/i.test((authoring.textContent || '').trim()))) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          var apply = event.target && event.target.closest && event.target.closest('[data-test="filter-bar__apply-button"]');
          if (filterPanel && apply && !apply.disabled && typeof setTimeout === 'function') {
            setTimeout(closePhoneFilters, 250);
          }
        }, true);
        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape' && filterPanel) closePhoneFilters();
        });
      }
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
