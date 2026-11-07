/** Presentation layer injected into Superset's pages. */

const GREEN = '#2E7D5B';
const NAVY = '#2B304A';

/** Login page, laid out at device width (phone). */
export const LOGIN_CSS = `
@media (max-width: 700px) {
  html.nt-login, html.nt-login body { min-width: 0 !important; max-width: 100vw !important; overflow-x: hidden !important; }
  html.nt-login body * { max-width: 100% !important; box-sizing: border-box !important; }
  html.nt-login body { background: #F1F5F3 !important; -webkit-tap-highlight-color: transparent; }

  /* Brand row: Neotree beside Superset, never wrapping or overflowing. */
  .nt-login .navbar-brand { display: inline-flex !important; align-items: center !important; flex-wrap: nowrap !important; gap: 12px !important; }
  .nt-login .navbar-brand img { max-width: 55vw !important; max-height: 40px !important; width: auto !important; height: auto !important; object-fit: contain; }
  .nt-login .navbar-brand img:not(#nt-login-logo) { max-width: 35vw !important; }
  .nt-login .navbar-brand #nt-login-logo { width: min(30vw, 112px) !important; height: auto !important; max-height: 38px !important; flex-shrink: 0 !important; }

  /* The form sits near the top, so the keyboard never hides it, and uses the full phone width. */
  .nt-login *:has(> .ant-card), .nt-login *:has(> form):not(.ant-card-body):not(.ant-card) {
    justify-content: flex-start !important; align-items: stretch !important; min-height: 0 !important; height: auto !important; padding-top: 12px !important;
  }
  .nt-login .ant-card, .nt-login .panel, .nt-login [data-test="login-form"] {
    width: calc(100% - 32px) !important; min-width: 0 !important; margin: 16px auto 24px !important;
    border: 0 !important; border-radius: 18px !important; background: #fff !important;
    box-shadow: 0 8px 28px rgba(43, 48, 74, .10) !important;
  }
  .nt-login .ant-card-head { border-bottom: 0 !important; padding: 22px 22px 0 !important; min-height: 0 !important; }
  .nt-login .ant-card-head-title { font-size: 24px !important; font-weight: 700 !important; color: ${NAVY} !important; padding: 0 !important; }
  .nt-login .ant-card-body { padding: 10px 22px 26px !important; }
  .nt-login .ant-card-body p, .nt-login .ant-card-body .ant-typography { font-size: 15px !important; line-height: 22px !important; color: #5E6A75 !important; }

  .nt-login .ant-form-item { margin-bottom: 18px !important; }
  .nt-login .ant-form-item-label { padding-bottom: 6px !important; }
  .nt-login .ant-form-item-label > label, .nt-login label { font-size: 15px !important; font-weight: 600 !important; color: ${NAVY} !important; height: auto !important; }

  .nt-login input.ant-input, .nt-login .ant-input-affix-wrapper, .nt-login input[type="text"], .nt-login input[type="password"] {
    min-height: 50px !important; font-size: 16px !important; border-radius: 12px !important; border-color: #C9D6CF !important;
  }
  .nt-login .ant-input-affix-wrapper > input.ant-input { min-height: 0 !important; height: auto !important; border: 0 !important; box-shadow: none !important; }
  .nt-login .ant-input-affix-wrapper svg, .nt-login .ant-input-prefix, .nt-login .ant-input-suffix { font-size: 18px !important; }
  .nt-login input:focus, .nt-login .ant-input-affix-wrapper-focused, .nt-login .ant-input-affix-wrapper:focus {
    border-color: ${GREEN} !important; box-shadow: 0 0 0 3px rgba(46, 125, 91, .18) !important;
  }

  .nt-login .ant-btn-primary, .nt-login button[type="submit"], .nt-login input[type="submit"] {
    display: block !important; width: 100% !important; min-height: 52px !important; font-size: 17px !important; font-weight: 600 !important;
    border-radius: 14px !important; background: ${GREEN} !important; border-color: ${GREEN} !important; color: #fff !important; box-shadow: none !important;
  }
  .nt-login .ant-btn-primary:active, .nt-login button[type="submit"]:active { filter: brightness(.92); }
  .nt-login .alert, .nt-login .ant-alert, .nt-login .modal-dialog { max-width: calc(100vw - 32px) !important; overflow-wrap: anywhere; }
}`;

/** Signed-in pages keep Superset's desktop layout and allow sideways panning on phones. */
export const APP_CSS = `
html { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
body { overscroll-behavior-y: none; }

/* Small filter fields trigger focus zoom in mobile WebViews. Keep their text at a
   readable CSS size while leaving the dashboard viewport and pinch zoom alone. */
@media (max-device-width: 700px) {
  html:not(.nt-login) input, html:not(.nt-login) textarea,
  html:not(.nt-login) select { font-size: 16px !important; }
}

/* Superset 6.1 places the native filter bar in the first dashboard grid column.
   On phones, charts span the grid and the open filter bar becomes an overlay. */
@media (max-device-width: 700px) {
  html.nt-dashboard-phone [data-test="dashboard-header-wrapper"],
  html.nt-dashboard-phone *:has(> [data-test="dashboard-content-wrapper"]) {
    grid-column: 1 / -1 !important;
    min-width: 0 !important;
  }
  /* ResizableSidebar renders its resize handle immediately before FiltersPanel.
     Hide only that handle; their shared parent is the entire dashboard grid. */
  html.nt-dashboard-phone *:has(+ [data-test="dashboard-filters-panel"]) { display: none !important; }
  html.nt-dashboard-phone [data-test="dashboard-header-wrapper"] { max-width: 100vw !important; }
  html.nt-dashboard-phone [data-test="dashboard-filters-panel"] { display: none !important; }
  html.nt-dashboard-phone [data-test="dashboard-filters-panel"]:has([data-test="filter-bar"].open) {
    display: block !important;
    position: fixed !important;
    left: var(--nt-filter-left, 0px) !important;
    top: var(--nt-filter-top, 0px) !important;
    width: var(--nt-filter-width, 360px) !important;
    height: var(--nt-filter-height, 700px) !important;
    transform: scale(var(--nt-filter-scale, 1));
    transform-origin: top left;
    overflow: visible !important;
    pointer-events: auto !important;
    z-index: 10002 !important;
    background: #fff !important;
    box-shadow: 8px 0 28px rgba(20, 38, 30, .23) !important;
  }
  html.nt-dashboard-phone [data-test="dashboard-filters-panel"] > div,
  html.nt-dashboard-phone [data-test="dashboard-filters-panel"] [data-test="filter-bar"],
  html.nt-dashboard-phone [data-test="dashboard-filters-panel"] [data-test="filter-bar"].open > div.open {
    width: var(--nt-filter-width, 360px) !important;
    height: 100% !important;
    min-height: 0 !important;
  }
  html.nt-dashboard-phone [data-test="dashboard-filters-panel"] [data-test="filter-bar"].open > div.open {
    position: relative !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: visible !important;
  }
  html.nt-dashboard-phone [data-test="filter-bar"].open > [data-test="filter-bar__collapsable"] { display: none !important; }
  html.nt-dashboard-phone [data-test="filter-bar"].open > div.open > div:nth-child(2) {
    flex: 1 1 auto !important;
    height: auto !important;
    min-height: 0 !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }
  html.nt-dashboard-phone [data-test="filterbar-action-buttons"] {
    position: relative !important;
    left: auto !important;
    bottom: auto !important;
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    flex: 0 0 auto !important;
    z-index: 2 !important;
    background: #fff !important;
    padding: 10px 16px !important;
    border-top: 1px solid #DCE5E0 !important;
    box-shadow: 0 -4px 14px rgba(43, 48, 74, .12) !important;
  }
  html.nt-dashboard-phone [data-test="filterbar-action-buttons"] button { min-height: 44px !important; border-radius: 10px !important; }
  html.nt-dashboard-phone [data-test="filterbar-action-buttons"] .ant-btn-primary { background-color: ${GREEN} !important; border-color: ${GREEN} !important; }
  html.nt-dashboard-phone [data-test="filterbar-action-buttons"] .ant-btn-primary[disabled] { background-color: #E3EAE6 !important; border-color: #E3EAE6 !important; color: #8B9A93 !important; }
  html.nt-dashboard-phone [data-test="edit-dashboard-button"],
  html.nt-dashboard-phone [data-test="dashboard-edit-actions"],
  html.nt-dashboard-phone [data-test="header-actions-menu"] li:has([data-test="save-as-menu-item"]),
  html.nt-dashboard-phone button:has([data-test="filterbar-orientation-icon"]) { display: none !important; }
  #nt-open-filters {
    appearance: none; border: 0; border-radius: 0;
    background: transparent; color: #2563B8; box-shadow: none;
    display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto; cursor: pointer;
  }
  #nt-open-filters:hover, #nt-open-filters:active { background: transparent; color: #174F98; }
  html.nt-dashboard-phone .ant-dropdown-menu [aria-disabled="true"],
  html.nt-dashboard-phone .ant-dropdown-menu-item-disabled,
  html.nt-dashboard-phone .ant-dropdown-menu-item-divider,
  html.nt-dashboard-phone .ant-dropdown-menu-item-group-title { display: none !important; }
  html.nt-dashboard-phone [data-test="header-actions-menu"],
  html.nt-dashboard-phone .ant-dropdown-menu:has([data-test="download-menu-item"]) {
    min-width: 245px !important;
    font-size: 15px !important;
  }
  html.nt-dashboard-phone [data-test="header-actions-menu"] [role="menuitem"],
  html.nt-dashboard-phone [data-test="header-actions-menu"] li,
  html.nt-dashboard-phone .nt-download-menu [role="menuitem"],
  html.nt-dashboard-phone .nt-download-menu li {
    min-height: 46px !important;
    padding: 11px 16px !important;
  }
  html.nt-dashboard-phone .nt-download-menu { min-width: 245px !important; font-size: 15px !important; }
  #nt-open-filters:focus-visible { outline: 3px solid #83C7A5; outline-offset: 2px; }
  #nt-filter-backdrop {
    position: fixed; background: rgba(20, 38, 30, .42);
    z-index: 10001; touch-action: none;
  }
}
html:not(.nt-login) .ant-menu-submenu:has([data-test="new-dropdown-icon"]) { display: none !important; }
html:not(.nt-login) a[href*="/dashboard/import"],
html:not(.nt-login) a[href*="/dataset/add"] { display: none !important; }
html:not(.nt-login) .nt-readonly-add {
  color: #84919B !important; border-color: #D7DFE3 !important;
  background: #F3F5F6 !important; opacity: .8 !important;
  cursor: help !important;
}
/* Dashboard and chart list rows need enough vertical space for touch selection. */
html.nt-resource-list .ant-table-tbody > tr > td,
html.nt-resource-list .table tbody > tr > td {
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}
html.nt-resource-list .ant-list-item { padding-top: 14px !important; padding-bottom: 14px !important; }
html.nt-resource-list .ant-table-tbody > tr > td a,
html.nt-resource-list .table tbody > tr > td a {
  display: inline-flex !important;
  align-items: center;
  min-height: 44px;
}
html:not(.nt-login) .nt-home-card-grid {
  max-height: none !important; overflow: visible !important;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)) !important;
  padding-left: 16px !important; padding-right: 16px !important;
}`;
