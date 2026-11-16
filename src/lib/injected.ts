import { LOGIN_LOGO_DATA_URI } from '../assets/login-logo';
import { APP_CSS, LOGIN_CSS } from './webStyles';

const ACTIVITY_THROTTLE_MS = 5000;
const SETTLE_CAP_MS = 7000;
// Keep Superset's navigation in its horizontal desktop layout. Tablets in
// portrait need a wider CSS viewport than phones to avoid the stacked menu.
const PHONE_VIEWPORT_WIDTH = 768;
const TABLET_VIEWPORT_WIDTH = 1024;

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

    // Superset menu labels the export bridge recognises. Checked against Superset 6.1.0 with the English UI.
    // Superset has no stable ids for these items, so re-test exports after every Superset upgrade or
    // language change (README: "Superset upgrade checklist") and adjust only these patterns.
    var NT_LABELS = {
      pdf: /^export (?:to|as) \.?pdf$/i,
      image: /^download as (?:an )?image$/i,
      // Any menu item that produces a file; shows "Preparing export…" until it arrives.
      file: /^(?:export (?:to|as) \.?pdf|download as (?:an )?image|export screenshot.*|export yaml|export as examples?|(?:export|download).*(?:csv|excel|xlsx))$/i
    };
    // Menu text includes icon padding and line breaks; compare a single-spaced version.
    var ntLabel = function (element) {
      return String((element && element.textContent) || '').replace(/\s+/g, ' ').trim();
    };

    function boot() {

    var path = location.pathname.replace(/\\/+$/, '').toLowerCase() || '/';
    var isLoginPath = path === ${landing} || /\\/login$/.test(path);
    var authoringPath = /\\/chart\\/add$/.test(path) ? 'Chart' : /\\/dashboard\\/new$/.test(path) ? 'Dashboard' : null;
    if (location.origin === ${origin} && authoringPath) {
      var fallback = location.origin + location.pathname.replace(/\\/(?:chart\\/add|dashboard\\/new)\\/?$/i,
        authoringPath === 'Chart' ? '/chart/list/' : '/dashboard/list/');
      var stored = null;
      try { stored = window.sessionStorage && window.sessionStorage.getItem('nt-last-view-route'); } catch (e) {}
      try {
        if (stored && new URL(stored).origin === location.origin && !/\\/(?:chart\\/add|dashboard\\/new)\\/?$/i.test(new URL(stored).pathname)) fallback = stored;
      } catch (e) {}
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'read-only-add', kind: authoringPath }));
      if (typeof location.replace === 'function') location.replace(fallback);
      return;
    }
    if (location.origin === ${origin}) {
      try { window.sessionStorage && window.sessionStorage.setItem('nt-last-view-route', location.href); } catch (e) {}
    }
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
        var createdBlobs = {};
        var deferredRevokes = {};
        var pendingPdf = false;
        var pendingPdfId = null;
        var pdfWaitCancelled = false;
        window.__ntCancelPdfWait = function () {
          if (!pendingPdfId) return;
          pdfWaitCancelled = true;
          pendingPdf = false;
          if (preparingExport) { clearTimeout(preparingExport.timer); preparingExport = null; }
          exportPost({ type: 'export-abort', id: pendingPdfId, name: 'Dashboard PDF', error: 'Cancelled' });
          pendingPdfId = null;
        };
        // Superset's image exporter already forces virtualized rows into view and
        // waits for charts. Waiting here repeats that work and can block forever.
        var originalCreate = window.URL.createObjectURL.bind(window.URL);
        window.URL.createObjectURL = function (blob) {
          var url = originalCreate(blob);
          if (blob && /^(application\\/pdf|image\\/)/.test(blob.type || '')) createdBlobs[url] = blob;
          return url;
        };
        var preparingExport = null;
        var originalRevoke = window.URL.revokeObjectURL.bind(window.URL);
        window.URL.revokeObjectURL = function (url) {
          if (activeBlobUrls[url]) deferredRevokes[url] = true;
          else { delete createdBlobs[url]; originalRevoke(url); }
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
          if (pdfWaitCancelled) { pdfWaitCancelled = false; return; }
          var convertToPdf = pendingPdf;
          pendingPdf = false;
          pendingPdfId = null;
          var id = 'export_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
          exportPost({ type: 'export-prepare', id: id, name: name });
          if (href.slice(0, 5) === 'blob:') activeBlobUrls[href] = true;
          try {
            var blob, disposition = null;
            if (href.slice(0, 5) === 'blob:' && createdBlobs[href]) {
              blob = createdBlobs[href];
            } else if (href.slice(0, 5) === 'data:') {
              var comma = href.indexOf(',');
              if (comma < 0) throw new Error('Invalid image export');
              var mime = href.slice(5, comma).split(';')[0] || 'application/octet-stream';
              var encoded = href.slice(comma + 1);
              if (encoded.length > 140 * 1024 * 1024) throw new Error('Export is larger than 100 MB');
              var binary = /;base64/i.test(href.slice(5, comma)) ? atob(encoded) : decodeURIComponent(encoded);
              var parts = [];
              for (var i = 0; i < binary.length; i += 32768) {
                var part = new Uint8Array(Math.min(32768, binary.length - i));
                for (var j = 0; j < part.length; j++) part[j] = binary.charCodeAt(i + j);
                parts.push(part);
              }
              blob = new Blob(parts, { type: mime });
            } else {
              var response = await fetch(href, { credentials: 'include' });
              if (!response.ok) throw new Error('Could not read generated file');
              blob = await response.blob();
              disposition = response.headers && response.headers.get('content-disposition');
            }
            var named = disposition && /filename\\*?=(?:UTF-8''|["']?)([^"';]+)/i.exec(disposition);
            if (named) { try { name = decodeURIComponent(named[1]); } catch (e) { name = named[1]; } }
            var blobType = (blob.type || '').split(';')[0].toLowerCase();
            var extension = blobType === 'application/pdf' ? 'pdf' : blobType.indexOf('image/') === 0 ? blobType.split('/')[1].replace('+xml', '')
              : blobType === 'text/csv' ? 'csv' : blobType === 'application/zip' ? 'zip' : blobType === 'application/json' ? 'json'
              : /spreadsheetml/.test(blobType) ? 'xlsx' : 'bin';
            if (!name) name = 'dashboard.' + extension;
            else if (!/\\.[A-Za-z0-9]{2,5}$/.test(name)) name += '.' + extension;
            if (convertToPdf && blob.type.indexOf('image/') === 0) name = name.replace(/\\.[^.]+$/, '') + '.pdf';
            name = name.slice(0, 120);
            if (blob.size > 100 * 1024 * 1024) throw new Error('Export is larger than 100 MB');
            await exportSend({ type: 'export-start', id: id, name: name, mime: blob.type || 'application/octet-stream', size: blob.size });
            for (var offset = 0; offset < blob.size; offset += 256 * 1024) {
              var chunk = await readExportChunk(blob.slice(offset, offset + 256 * 1024));
              await exportSend({ type: 'export-chunk', id: id, data: chunk, downloaded: Math.min(offset + 256 * 1024, blob.size) });
            }
            await exportSend({ type: 'export-finish', id: id });
          } catch (error) {
            exportPost({ type: 'export-abort', id: id, name: name, error: String(error && error.message || error) });
          } finally {
            delete activeBlobUrls[href];
            if (deferredRevokes[href]) { delete deferredRevokes[href]; delete createdBlobs[href]; originalRevoke(href); }
          }
        };
        // iOS: WKWebView reports attachment responses (e.g. CSV) through onFileDownload with no file.
        // The app calls this to fetch the same URL here, with the page's session, and save it through
        // the export bridge. Only same-origin GET downloads can be repeated this way.
        window.__ntTransferExport = function (url) {
          try {
            var target = new URL(String(url), location.href);
            if (target.origin !== location.origin) return false;
            var last = target.pathname.split('/').filter(Boolean).pop() || 'download';
            try { last = decodeURIComponent(last); } catch (e) { /* keep the encoded segment */ }
            transferExport(target.href, last);
            return true;
          } catch (e) { return false; }
        };
        var handleExportLink = function (anchor) {
          var href = anchor.href;
          var name = anchor.download;
          if (!name || !/^(blob:|data:)/.test(href)) return false;
          transferExport(href, name);
          return true;
        };
        var originalOpen = window.open;
        window.open = function (url) {
          if (preparingExport && url) {
            try {
              var target = new URL(String(url), location.href);
              if (target.origin === location.origin && /(?:export|pdf|screenshot|image)/i.test(target.pathname)) {
                transferExport(target.href, preparingExport.name);
                return null;
              }
            } catch (e) { /* Let Superset handle an invalid URL. */ }
          }
          return originalOpen && originalOpen.apply(window, arguments);
        };
        var originalAnchorClick = window.HTMLAnchorElement.prototype.click;
        window.HTMLAnchorElement.prototype.click = function () {
          if (!handleExportLink(this)) return originalAnchorClick.apply(this, arguments);
        };
        document.addEventListener('click', function (event) {
          var anchor = event.target && event.target.closest && event.target.closest('a[href]');
          if (!anchor) return;
          var captured = handleExportLink(anchor);
          if (!captured && anchor.href && /(?:export|pdf|screenshot|image)/i.test(anchor.pathname || '')) {
            try {
              var target = new URL(anchor.href, location.href);
              var label = ntLabel(anchor);
              if (target.origin === location.origin && (preparingExport || NT_LABELS.pdf.test(label) || NT_LABELS.image.test(label))) {
                transferExport(target.href, anchor.download || (preparingExport && preparingExport.name) || label);
                captured = true;
              }
            } catch (e) { /* Keep normal navigation if this is not a valid export URL. */ }
          }
          if (captured) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
        document.addEventListener('click', function (event) {
          var item = event.target && event.target.closest && event.target.closest('[role="menuitem"], .ant-dropdown-menu-item');
          if (!item) return;
          var label = ntLabel(item);
          if (NT_LABELS.pdf.test(label) && /(^|\\/)superset\\/dashboard\\//.test(location.pathname)) {
            var options = document.querySelectorAll('[role="menuitem"], .ant-dropdown-menu-item');
            for (var p = 0; p < options.length; p++) {
              if (!NT_LABELS.image.test(ntLabel(options[p]))) continue;
              event.preventDefault();
              event.stopImmediatePropagation();
              pendingPdfId = 'export_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
              pdfWaitCancelled = false;
              pendingPdf = true;
              exportPost({ type: 'export-prepare', id: pendingPdfId, name: 'Preparing dashboard PDF' });
              options[p].click();
              return;
            }
          }
          if (pendingPdf && NT_LABELS.image.test(label)) {
            if (preparingExport) clearTimeout(preparingExport.timer);
            var pdfId = pendingPdfId;
            preparingExport = { timer: setTimeout(function () {
              pendingPdf = false;
              pendingPdfId = null;
              pdfWaitCancelled = true;
              exportPost({ type: 'export-abort', id: pdfId, name: 'Dashboard PDF', error: 'Dashboard export timed out. Please try again.' });
              preparingExport = null;
            }, 90000) };
            return;
          }
          if (!NT_LABELS.file.test(label)) return;
          if (preparingExport) clearTimeout(preparingExport.timer);
          var id = 'export_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
          exportPost({ type: 'export-prepare', id: id, name: label });
          preparingExport = { timer: setTimeout(function () {
            exportPost({ type: 'export-abort', id: id, name: label, error: 'No file was generated. Please try again.' });
            preparingExport = null;
          }, 120000) };
        }, true);
      }
      // React Router can create pages with history.pushState without a WebView
      // navigation callback. Stop those routes before the chart editor mounts.
      if (typeof history !== 'undefined') {
        var readOnlyRouteKind = function (value) {
          if (!value) return null;
          try {
            var target = new URL(String(value), location.href);
            if (target.origin !== location.origin) return null;
            if (/\\/chart\\/add\\/?$/.test(target.pathname)) return 'Chart';
            if (/\\/dashboard\\/new\\/?$/.test(target.pathname)) return 'Dashboard';
          } catch (e) { /* Keep ordinary navigation unchanged. */ }
          return null;
        };
        ['pushState', 'replaceState'].forEach(function (method) {
          if (typeof history[method] !== 'function') return;
          var original = history[method].bind(history);
          history[method] = function (state, title, url) {
            var kind = readOnlyRouteKind(url);
            if (kind) {
              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'read-only-add', kind: kind }));
              if (typeof location.replace === 'function') {
                var safeUrl = location.href;
                setTimeout(function () { location.replace(safeUrl); }, 0);
              }
              return;
            }
            var result = original(state, title, url);
            try { window.sessionStorage && window.sessionStorage.setItem('nt-last-view-route', location.href); } catch (e) {}
            return result;
          };
        });
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
      var pageKind = function () {
        if (onLoginPage()) return 'sign-in';
        return /(^|\\/)superset\\/dashboard\\/[^/]+/.test(location.pathname) ? 'dashboard' : 'other';
      };
      var lastPageContext = '';
      var reportPageContext = function () {
        var kind = pageKind();
        var signature = kind + ':' + location.pathname;
        if (signature === lastPageContext) return;
        lastPageContext = signature;
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'page-context', kind: kind, url: location.href }));
      };
      var decorate = function () {
        var login = onLoginPage();
        observedPath = location.pathname;
        loginActive = login;
        var screenWidth = Number(window.screen && window.screen.width);
        var minimumWidth = screenWidth >= 600 ? ${TABLET_VIEWPORT_WIDTH} : ${PHONE_VIEWPORT_WIDTH};
        var APP_VIEWPORT = screenWidth >= minimumWidth
          ? 'width=device-width, initial-scale=1, user-scalable=yes, maximum-scale=5'
          : 'width=' + minimumWidth + ', user-scalable=yes, maximum-scale=5';
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
      var addKind = function (node) {
        if (!node) return null;
        if (node.matches && node.matches('button, a, [role="button"]')
          && node.querySelector && node.querySelector('[data-test="add-annotation-layer-button"]')) return 'Chart';
        if (/\\/chart\\/list\\/?$/i.test(location.pathname) && node.matches && node.matches('button, a, [role="button"]')
          && /^Chart$/i.test((node.textContent || '').trim()) && node.querySelector && node.querySelector('svg')) return 'Chart';
        var labels = [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')];
        for (var i = 0; i < labels.length; i++) {
          var label = String(labels[i] || '').replace(/\\s+/g, ' ').trim();
          var match = /^(?:\\+\\s*|Create\\s+)(Chart|Dashboard)$/i.exec(label);
          if (match) return match[1].toLowerCase() === 'chart' ? 'Chart' : 'Dashboard';
        }
        var href = node.getAttribute('href') || '';
        if (/\\/chart\\/add(?:[/?#]|$)/i.test(href)) return 'Chart';
        if (/\\/dashboard\\/new(?:[/?#]|$)/i.test(href)) return 'Dashboard';
        return null;
      };
      var isAuthoringControl = function (node) {
        if (!node) return false;
        var labels = [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')];
        for (var q = 0; q < labels.length; q++) {
          var label = String(labels[q] || '').replace(/\\s+/g, ' ').trim();
          if (/^\\+\\s*(?:Chart|Dashboard)$|^Import (?:dashboards?|charts?)$|^Create (?:chart|dashboard)$/i.test(label)
            || (label === 'Import' && /\\/dashboard\\/list\\/?$/i.test(location.pathname))) return true;
        }
        return /\\/(?:chart\\/add|dashboard\\/(?:new|import)|dataset\\/add)(?:[/?#]|$)/i.test(node.getAttribute('href') || '');
      };
      var syncReadOnlyUI = function () {
        if (!document.body || !document.querySelectorAll) return;
        var hide = function (node) { node.style.setProperty('display', 'none', 'important'); };
        var createIcon = document.querySelector('[data-test="new-dropdown-icon"]');
        if (createIcon) hide(createIcon.closest('.ant-menu-submenu, [role="menuitem"], li') || createIcon);
        var nav = document.querySelectorAll('nav a, nav button, header a, header button, [role="menuitem"], .ant-dropdown-menu-item');
        for (var n = 0; n < nav.length; n++) {
          var item = nav[n];
          var label = (item.textContent || '').trim();
          if (/^(Datasets|SQL|SQL Lab)$/i.test(label) && item.closest('nav, header')) hide(item.closest('li') || item);
          if (!addKind(item) && /^(?:Create|New|Add|Save|Edit|Update|Delete|Duplicate|Import|Manage)(?:\\s|$)/i.test(label)
            || /^Set filter mapping$/i.test(label)) hide(item.closest('li') || item);
        }
        var creates = document.querySelectorAll('[data-test="new-chart-button"], [data-test="add-chart-button"], [data-test="add-slice-button"], [data-test="create-button"], [data-test="edit-chart-button"], [data-test="chart-edit-button"], [data-test="dashboard-edit-actions"], [data-test="edit-dashboard-button"], [data-test="import-dashboard-button"], [data-test="import-button"]');
        for (var c = 0; c < creates.length; c++) if (!addKind(creates[c])) hide(creates[c]);
        var navButtons = document.querySelectorAll('nav button, header button');
        for (var b = 0; b < navButtons.length; b++) {
          var button = navButtons[b];
          if (!addKind(button) && (/^(\\+|Add new|Create new)$/i.test((button.textContent || '').trim())
            || /^(add|create|new)$/i.test(button.getAttribute('aria-label') || ''))) hide(button.closest('li') || button);
        }
        var authoringControls = document.querySelectorAll('button, a[href], [role="button"]');
        for (var x = 0; x < authoringControls.length; x++) {
          var action = authoringControls[x];
          if (addKind(action)) action.classList.add('nt-readonly-add');
          else if (isAuthoringControl(action)) hide(action);
        }
        var menuEntries = document.querySelectorAll('[data-test="header-actions-menu"] [role="menuitem"], .ant-dropdown-menu [role="menuitem"]');
        for (var m = 0; m < menuEntries.length; m++) {
          var entry = menuEntries[m];
          var entryLabel = ntLabel(entry);
          if (/^(?:Export YAML|Export as example|Export as examples|Examples|YAML)$/i.test(entryLabel)) hide(entry.closest('li') || entry);
          if (NT_LABELS.pdf.test(entryLabel) || NT_LABELS.image.test(entryLabel)) {
            var downloadMenu = entry.closest('ul, [role="menu"]');
            if (downloadMenu) downloadMenu.classList.add('nt-download-menu');
          }
          if (entry.closest('[data-test="header-actions-menu"]') && (entry.getAttribute('aria-disabled') === 'true' || entry.classList.contains('ant-dropdown-menu-item-disabled'))) hide(entry.closest('li') || entry);
        }
        if (/(^|\\/)superset\\/welcome\\/?$/.test(location.pathname)) {
          var cards = document.querySelectorAll('.ant-card');
          for (var k = 0; k < cards.length; k++) {
            var parent = cards[k].parentElement;
            while (parent && parent !== document.body && window.getComputedStyle(parent).display !== 'grid') parent = parent.parentElement;
            if (parent && parent !== document.body && parent.children.length > 1) parent.classList.add('nt-home-card-grid');
          }
        }
        var popups = document.querySelectorAll('.ant-menu-submenu-popup ul, .ant-dropdown-menu, ul[role="menu"]');
        for (var z = 0; z < popups.length; z++) {
          var popup = popups[z];
          var contents = (popup.textContent || '');
          if (!/Logout|Log out/i.test(contents) || !/Info|About|Security|Database Connections/i.test(contents)) continue;
          popup.classList.add('nt-settings-popup');
          var settingRows = popup.querySelectorAll('li');
          for (var y = 0; y < settingRows.length; y++) {
            var row = settingRows[y];
            if (!/(?:\\b(?:User|Info|Logout|Log out|About)\\b|Version:)/i.test(row.textContent || '')) hide(row);
          }
          var allowed = popup.querySelectorAll('a, button, [role="menuitem"], .ant-menu-item, li');
          for (var a = 0; a < allowed.length; a++) {
            if (!/^(?:Info|Logout|Log out|About)$/i.test((allowed[a].textContent || '').trim())) continue;
            var visible = allowed[a];
            while (visible && visible !== popup) {
              visible.style.removeProperty('display');
              visible = visible.parentElement;
            }
          }
          var groupTitles = popup.querySelectorAll('.ant-menu-item-group-title');
          for (var g = 0; g < groupTitles.length; g++) {
            if (!/^About$/i.test((groupTitles[g].textContent || '').trim())) hide(groupTitles[g]);
          }
        }
      };
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
        syncReadOnlyUI();
        reportPageContext();
        var mobileDashboard = Number(window.screen && window.screen.width) < 700
          && /(^|\\/)superset\\/dashboard\\/[^/]+/.test(location.pathname);
        var root = document.documentElement;
        if (root && root.classList) {
          if (mobileDashboard) root.classList.add('nt-dashboard-phone');
          else root.classList.remove('nt-dashboard-phone');
          if (/\\/(?:chart|dashboard)\\/list\\/?$/i.test(location.pathname)) root.classList.add('nt-resource-list');
          else root.classList.remove('nt-resource-list');
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
        button.style.width = Math.round(42 * ratio) + 'px';
        button.style.height = Math.round(42 * ratio) + 'px';
        button.style.padding = '0';
        var bar = panel.querySelector('[data-test="filter-bar"]');
        var open = !!bar && bar.classList.contains('open');
        button.setAttribute('aria-label', open ? 'Close filters' : 'Open filters');
        button.setAttribute('title', open ? 'Close filters' : 'Filters');
        button.innerHTML = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M7 12h10m-7 5h4"/><circle cx="8" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/></svg>';
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
      window.addEventListener('click', function (event) {
        var target = event.target;
        var pressed = target && target.closest && target.closest('button, a, [role="button"], [role="menuitem"], .ant-menu-item');
        var chartAddIcon = target && target.closest && target.closest('[data-test="add-annotation-layer-button"]');
        var kind = addKind(pressed) || (chartAddIcon ? 'Chart' : null);
        if (!kind) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'read-only-add', kind: kind }));
      }, true);
      if (document.addEventListener) {
        document.addEventListener('click', function (event) {
          var pressed = event.target && event.target.closest && event.target.closest('button, a, [role="button"], [role="menuitem"], .ant-menu-item');
          if (isAuthoringControl(pressed)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          if (!document.documentElement.classList.contains('nt-dashboard-phone')) return;
          if (pressed && /\\/explore\\/?(?:[?#]|$)/i.test(pressed.getAttribute('href') || '')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          if (event.target && event.target.closest && event.target.closest('.dashboard-chart, .dashboard-component-chart-holder')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
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
          if (apply && !apply.disabled) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'filter-applied' }));
            if (filterPanel && typeof setTimeout === 'function') setTimeout(closePhoneFilters, 250);
          }
        }, true);
        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape' && filterPanel) closePhoneFilters();
        });
      }
      if (typeof MutationObserver !== 'undefined' && document.documentElement && document.documentElement.nodeType) {
        var decorateQueued = false;
        new MutationObserver(function (changes) {
          syncReadOnlyUI();
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
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'page-ready', url: location.href,
        kind: typeof pageKind === 'function' ? pageKind() : 'other'
      }));
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

    // Sign-in and legacy form navigations need the native cover. Dashboard filter
    // changes already update charts in place, so do not cover that visible result.
    var submitting = false;
    window.addEventListener('submit', function () { submitting = true; }, true);
    window.addEventListener('beforeunload', function () {
      if (!submitting) return;
      var login = typeof onLoginPage === 'function' && onLoginPage();
      if (!login && /\\/superset\\/dashboard\\/[^/]+/.test(location.pathname)) return;
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

export function readReadOnlyAddKind(data: string): 'Chart' | 'Dashboard' | null {
    try {
        const message = JSON.parse(data);
        return message?.type === 'read-only-add' && (message.kind === 'Chart' || message.kind === 'Dashboard') ? message.kind : null;
    } catch {
        return null;
    }
}

export function isFilterAppliedMessage(data: string): boolean {
    try { return JSON.parse(data)?.type === 'filter-applied'; } catch { return false; }
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

export type AnalyticsPageKind = 'sign-in' | 'dashboard' | 'other';

/** The current Superset page, as reported by the injected script. */
export function readPageContext(data: string): { kind: AnalyticsPageKind; url: string } | null {
    try {
        const message = JSON.parse(data);
        if ((message?.type !== 'page-ready' && message?.type !== 'page-context')
            || !['sign-in', 'dashboard', 'other'].includes(message.kind)
            || typeof message.url !== 'string') return null;
        return { kind: message.kind, url: message.url };
    } catch {
        return null;
    }
}

/** Path fallback before the page can report its form or dashboard state. */
export function pageKindFromUrl(url: string | null, loginPathname: string): AnalyticsPageKind {
    if (!url) return 'other';
    try {
        const path = normalisePath(new URL(url).pathname);
        if (path === normalisePath(loginPathname) || /\/login$/.test(path)) return 'sign-in';
        return /(^|\/)superset\/dashboard\/[^/]+/.test(path) ? 'dashboard' : 'other';
    } catch {
        return 'other';
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

/** Dashboard navigation uses Superset's own loading UI once a dashboard is visible. */
export function shouldKeepDashboardVisible(visiblePageKey: string | null, nextUrl: string): boolean {
    if (!visiblePageKey) return false;
    try {
        const visible = new URL(visiblePageKey);
        const next = new URL(nextUrl);
        const dashboard = /\/superset\/dashboard\/[^/]+/;
        return visible.origin === next.origin && dashboard.test(visible.pathname) && dashboard.test(next.pathname);
    } catch {
        return false;
    }
}
