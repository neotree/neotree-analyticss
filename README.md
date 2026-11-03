# Neotree Analytics

Android app (`app.neotree.analytics`) built with Expo / React Native. It is a thin, controlled WebView around
each country's existing Apache Superset. The country's **Webeditor** supplies the Superset URL and inactivity
timeout (Webeditor → *Reporting Configurations*); Superset keeps owning login, dashboards and RBAC.

## How it works

1. First launch → choose a country (remembered locally).
2. App asks that country's Webeditor for `versionNumber` (`GET /api/v1/mobile-analytics/version`).
3. Same as the cached version → keep the cache. Different in either direction, or missing → fetch
   `GET /api/v1/mobile-analytics/config`, validate (HTTPS, approved host, timeout bounds) and commit
   URL + timeout + version in **one SQLite transaction**. A valid saved configuration opens Superset immediately while Webeditor is checked. If Webeditor is temporarily unavailable, the app keeps that configuration and shows a warning with **Retry**; without a valid saved configuration it shows a Webeditor error. A Superset page failure appears separately as **Analytics unavailable** and retries the WebView without a Webeditor request.
4. Opens `supersetUrl + landingPath` (landing path comes from the app's registry, default `/login/`).
The Neotree logo appears beside the Superset logo on the login page only.
Every full page load (first load, sign-in, redirects) sits behind the app's branded spinner until Superset's own interface is
on screen: on the login page that is the form, elsewhere the React shell (menu, skeleton or text). From then on Superset's
own loading skeletons take over; the app never waits for charts. Submitting a form (e.g. a wrong password) shows
"Signing in…" at once instead of a blank page. In-app navigation never gets a native cover. Backstops: 10 s after load, 15 s overall.
The app applies a phone-width viewport to the login page only (detected by path or the sign-in form). Authenticated pages use a 768px desktop layout (the narrowest width at which Superset keeps its horizontal menu) fitted to the phone on load. Users can then pinch zoom and pan horizontally or vertically. On phones, the filter action bar (Apply/Clear) stays pinned to the bottom.
`scalesPageToFit` stays on so Android respects the viewport setting. Pinch zoom is enabled on signed-in pages (up to 5x; double-tap zoom is off) and disabled on the login page.

Version checks run on every app start and at most once per minute when the app returns to the foreground,
de-duplicated while a check is in flight. The visible Retry button always checks immediately. Failed checks do not update the saved last-checked time.

Presentation lives in `src/lib/webStyles.ts` (login form and signed-in polish, injected into Superset's pages) and the
native top bar / loading cover in `AnalyticsScreen.tsx`. It restyles only; it never moves, hides or reorders Superset content.

## Setup

```bash
npm install
cp config/countries.example.json config/countries.local.json   # gitignored; edit it
npm start            # Expo dev server
npm run android      # build, install over USB, and open the Android app
npm test             # unit tests (registry, validation, sync, allowlist, injected script)
npm run typecheck
```

`npm run android` needs one authorized USB device. It builds for that device's CPU and uses ADB's
nonstreaming install mode, which works around phones that reject Expo's default streamed install.
After the first native build, use `npm start` for JavaScript-only changes.

If an Android run still prints `› Installing ... CommandError: adb: failed to install`, check the first
lines of its output. This project's current script prints `> node scripts/run-android.js` and
`Neotree Android runner: building and installing without ADB streaming`. The `› Installing` line
comes from Expo's separate `run:android` command. Run `npm pkg get scripts.android` in this repo
to confirm which script your terminal is using.

No `.env` is required for ordinary local development. See `.env.example` for optional registry and EAS settings.
For a locally signed Android release, copy it to `.env`, fill in and uncomment the four `NEOTREE_RELEASE_*`
values, then export them before running Gradle:

```bash
set -a
. ./.env
set +a
```

Gradle reads process environment variables; it does not load `.env` itself. EAS Build uses its own signing
credentials and country registry secret.

### Country registry

The build reads `config/countries.local.json` first, then `config/countries.json` if the local file is absent.
Environment variables `NEOTREE_COUNTRIES_JSON` and `NEOTREE_COUNTRIES_FILE` take precedence over both files.
The checked-in `config/countries.json` contains placeholder endpoints and keys; replace them before using it
with a real Webeditor. Cloud builds reject its placeholder keys.

`config/countries.local.json`:

| field | notes |
| --- | --- |
| `code`, `name` | shown in the picker |
| `webeditorUrl` | HTTPS base URL of that country's Webeditor |
| `apiKey` | the **analytics key** generated on the Webeditor *Reporting Configurations* page |
| `flag` | optional flag shown on the country picker: a path to a png/jpg/webp (≤150 KB, relative to the project root, embedded in the build), or an `https://` URL. If omitted, `assets/flags/<code>.png` is used when present, otherwise the country code is shown |
| `landingPath` | optional, defaults to `defaultLandingPath` (`/login/`) |
| `allowedHosts` | optional extra hosts the WebView may visit (`host` or `*.host`), e.g. an SSO provider. If non-empty, the Superset host from the Webeditor must also match. |

**Gitignore is not secrecy.** Everything here is compiled into the APK and can be extracted. Use only the
analytics key, which can read nothing but the two config endpoints and can be regenerated on the Webeditor
(regenerating invalidates the old key, so ship a new build). Never put an administrator or data-access key here.

### Build an APK

Cloud builds only upload git-tracked files. Supply a real registry as an EAS secret, or replace the
placeholder values in `config/countries.json`:

```bash
eas secret:create --scope project --name NEOTREE_COUNTRIES_FILE --type file --value config/countries.local.json
npm run build:apk          # eas build --platform android --profile preview
```

(`NEOTREE_COUNTRIES_JSON` also works.) A cloud build **fails** if it would use placeholder keys, so placeholder URLs never ship.
Keep the signing credentials EAS creates; you need them for upgrades. Release builds enable R8 shrinking/obfuscation
and Hermes bytecode; verify WebView behaviour on a release build before rollout.

For a **local** signed release build, export `NEOTREE_RELEASE_KEYSTORE`, `NEOTREE_RELEASE_STORE_PASSWORD`,
`NEOTREE_RELEASE_KEY_ALIAS`, and `NEOTREE_RELEASE_KEY_PASSWORD` before running Gradle. Without all four,
the local release variant is unsigned; it never falls back to the debug key. EAS Build injects its own signing
credentials. Keep `credentials.json` and keystores out of Git.

### Internal APK distribution

The `production` profile also builds an APK for distribution outside Google Play. Keep a consistent release signing
key across updates. Android may still show a Play Protect prompt when a user installs an APK from outside Play;
building and signing it as a production release does not suppress that device-level prompt. Explain the prompt in
your internal installation instructions and use an organization-managed installation channel where available.

## Security behaviour

- Local DB holds only country, Superset URL, timeout, version, last-checked time. No credentials, cookies, tokens, keys or dashboard data.
- WebView is limited to the exact Superset origin and approved HTTPS hosts on their default port; other navigation is blocked and a banner is shown.
  `javascript:`, `intent:`, `file:` and plain `http:` are refused.
- Android `incognito` WebView: **all cookies, cache, history and saved form data are wiped every time the WebView mounts**,
  so a session never survives a timeout, app restart or country switch. Users sign in to Superset each time they open the app.
- Inactivity: measured across foreground/background and from in-page touches/scrolls (throttled bridge). A new timeout applies
  immediately; the page reloads only if the URL changes. On timeout the WebView is **unmounted**, not hidden, and a
  best-effort `GET /logout/` is sent.
- The app is covered whenever it is not in the foreground, and on resume expiry is checked **before** the cover is lifted.
- Screenshots and Android recents previews are blocked before health analytics are shown.
- Backups disabled; cleartext traffic disabled in release builds; debugging of the WebView disabled.

## Known limits (please test before rollout)

- Server-side Superset logout is **attempted, not verified**. Removing the WebView does not end a server session; cookie wiping
  only guarantees *this device* will not resume it. Check your Superset session policy.
- The activity bridge and login layout hints were checked against a mock page, not your Superset build. Verify on the real
  login page and on small screens.
- Superset's own dashboards and filters may still use desktop-only layouts. `MOBILE_CONSUMPTION_MODE` was merged upstream
  after Superset 6.1.0, so it is not available in 6.1.0. A later server version that includes the feature can enable
  mobile drawers and dashboard layouts; the app cannot enable that mode from a WebView.
- The request to a Webeditor with a wrong/rotated key shows "access key rejected"; rotating the key means shipping a new build.

## Branding

Icons and splash are generated from `images/logo.png` by `npm run assets` (`scripts/generate-brand-assets.py`),
with the original navy backgrounds replaced by Neotree green `#2E7D5B`.
Keep the source image, generated assets, and generator together so branding can be reproduced when the logo changes.

## App version

Set the user-facing `expo.version` and increment `expo.android.versionCode` in `app.json` for each Android release.
`app.config.ts` adds the build-time country registry and security settings while preserving those values from `app.json`.
The version number returned by Webeditor is separate: it controls when the app refreshes the Superset configuration.
