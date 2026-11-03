/**
 * Presentation layer injected into Superset's pages. It only restyles what Superset renders (sizes, spacing,
 * colour, alignment); it never moves, hides or reorders content. Selectors target Superset's stable
 * `data-test` hooks and Ant Design classes, so an unmatched selector is a harmless no-op.
 */

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

/* Floating Apply / Clear bar: brand colour, comfortable targets, and room below the filters so the last
   filter is never hidden behind it. */
@media (max-device-width: 700px) {
  [data-test="filterbar-action-buttons"] {
    position: fixed !important; left: 0 !important; bottom: 0 !important;
    width: 100vw !important; max-width: 100vw !important; box-sizing: border-box !important; z-index: 1000 !important;
    background: #fff !important; padding: 12px 18px !important; gap: 10px !important;
    border-top: 1px solid #DCE5E0 !important; box-shadow: 0 -4px 14px rgba(43, 48, 74, .12) !important;
  }
  [data-test="filterbar-action-buttons"] .ant-btn, [data-test="filterbar-action-buttons"] button { min-height: 40px !important; border-radius: 10px !important; }
  [data-test="filterbar-action-buttons"] .ant-btn-primary { background-color: ${GREEN} !important; border-color: ${GREEN} !important; }
  [data-test="filterbar-action-buttons"] .ant-btn-primary[disabled] { background-color: #E3EAE6 !important; border-color: #E3EAE6 !important; color: #8B9A93 !important; }
  *:has(> [data-test="filterbar-action-buttons"]) { padding-bottom: 96px !important; }
}`;
