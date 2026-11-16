# Neotree Analytics

Android app (`app.neotree.analytics`) built with Expo / React Native. It is a thin, controlled WebView around
each country's existing Apache Superset. The country's **Webeditor** supplies the Superset URL and inactivity
timeout (Webeditor → *Reporting Configurations*); Superset keeps owning login, dashboards and RBAC.

## How it works

1. First launch → choose a country (remembered locally).
2. App asks that country's Webeditor for `versionNumber` (`GET /api/v1/mobile-analytics/version`).
3. Same as the cached version → keep the cache (but the full configuration is downloaded again once it is more than
   24 hours old, so a Webeditor change saved without a version bump still reaches devices within a day).
   Different in either direction, or missing → fetch
   `GET /api/v1/mobile-analytics/config`, validate (HTTPS, approved host, timeout bounds) and commit
   URL + timeout + version in **one SQLite transaction**. A valid saved configuration opens Superset immediately while Webeditor is checked. If Webeditor is temporarily unavailable, the app keeps that configuration and shows a warning with **Retry**; without a valid saved configuration it shows a Webeditor error. A Superset page failure appears separately as **Analytics unavailable** and retries the WebView without a Webeditor request.
4. Opens `supersetUrl + landingPath` (landing path comes from the app's registry, default `/login/`).
The Neotree logo appears beside the Superset logo on the login page only.
Every full page load (first load, sign-in, redirects) sits behind the app's branded spinner until Superset's own interface is
on screen: on the login page that is the form, elsewhere the React shell (menu, skeleton or text). From then on Superset's
own loading skeletons take over; the app never waits for charts. Submitting a form (e.g. a wrong password) shows
"Signing in…" at once instead of a blank page. In-app navigation never gets a native cover. Backstops: 10 s after load, 15 s overall.
The login page uses the device-width viewport. Signed-in pages use at least 768px of layout width: Android fits that layout to smaller phones, while devices 768px or wider use their own width. **Tablets** (smallest screen side ≥ 600 dp, the same threshold as the page's tablet layout) rotate freely and the page re-fits on rotation; **phones stay in portrait** (`src/lib/orientation.ts`). Users can pinch zoom and pan. On phones, Apply/Clear stays at the bottom of the filter overlay.
`scalesPageToFit` stays on so Android respects the viewport setting. Pinch zoom remains available on signed-in pages. Filter fields use a readable font size to avoid focus zoom, while Apply/Clear stays pinned at the bottom.
Phone dashboards start with Superset's native filter panel collapsed, giving charts the full dashboard width. A Filters button in the dashboard header opens the native panel as a phone-sized overlay. The dashboard stays visible behind it; Apply/Clear stays reachable when the keyboard opens. Dashboard authoring controls are hidden in this mobile UI.
Applying dashboard filters leaves the updated charts visible. The app's full-page loading cover is reserved for first load, sign-in, and other page transitions that have no dashboard on screen.
Android HTTP downloads show progress in the app and the system notification. Superset-generated PDF, image, CSV, and ZIP files use the WebView export bridge, which saves them to the device's Downloads folder (Android 10+) or offers a **Save as** picker (Android 7–9) and shows preparation, progress, completion, or failure in the app.
The top bar has **Reload** (reloads the page in place; after an error it starts the page again) and **Switch country**. Android **back** goes back inside Superset; at the first page a second press within two seconds leaves the app. Text inside Superset follows the system font size up to 130% (larger sizes break Superset's fitted layout). While offline, the stale-data warning says when the page last finished loading. The app version is shown under the country picker.
When Android reports no usable network, the app shows an offline message for the page on screen: sign-in asks the user to reconnect before signing in; a loaded dashboard stays visible with a stale-data warning; other Superset pages use general wording. Failed loads retry when connectivity returns. A reachable network does not imply that Superset itself is available, so server errors retain their separate message.

Version checks run on every app start and at most once per minute when the app returns to the foreground,
de-duplicated while a check is in flight. The visible Retry button always checks immediately. Failed checks do not update the saved last-checked time.

Presentation lives in `src/lib/webStyles.ts` (login form and signed-in polish, injected into Superset's pages) and the
native top bar / loading cover in `AnalyticsScreen.tsx`. On phones the app asks Superset to start dashboards with its filter panel collapsed and displays the existing panel as an overlay; Superset still owns filter state and chart layout. The mobile authoring restrictions are presentation controls, not a replacement for server permissions.

## Setup

```bash
npm install
cp config/countries.example.json config/countries.local.json   # gitignored; edit it
npm start            # Expo dev server
npm run android      # build, install over USB, and open the Android app
npm test             # unit tests (registry, validation, sync, allowlist, injected script, export bridge, diagnostics scrubbing)
npm run typecheck
```

`npm run android` needs one authorized USB device. It builds for that device's CPU and uses ADB's
nonstreaming install mode, which works around phones that reject Expo's default streamed install.
The debug APK loads JavaScript from Metro on port 8081. The runner forwards that port over USB;
if this project's Metro is already running there, it reuses it. Stop a different server on 8081 before retrying.
In that case `npm run android` returns to the shell after launching the app; Metro keeps running in its original terminal.
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
| `allowedHosts` | **required, non-empty.** Hosts (`host` or `*.host`, optionally with `:port`, e.g. `superset.example.org:10243`) approved for this country. Write hostnames, not URLs (no `https://` or `/`). An entry without a port approves the standard HTTPS port only; a Superset served on a custom port must list that port. The Superset URL sent by the Webeditor must match one of them, otherwise the app refuses it; the WebView may also visit them (e.g. an SSO provider). The build and the app both fail on a country without one, so a compromised Webeditor cannot point the app at an arbitrary sign-in page. |

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

### Google Play

```bash
npm run build:play         # Android App Bundle (.aab), profile `play`
npm run submit:play        # uploads the latest build to the internal track as a draft
```

Upload a Google Play service-account key to EAS (`eas credentials`) before the first submit. With Play App Signing,
Google re-signs the app, so a Play install and a sideloaded `production` APK have different signatures and cannot
upgrade one another. Pick one channel per device fleet.

## Security behaviour

- Local DB holds only country, Superset URL, timeout, version, last-checked and last-downloaded times. No credentials, cookies, tokens, keys or dashboard data.
- When diagnostics reporting is enabled, a second database (`neotree-diagnostics.db`) holds at most 50 scrubbed events waiting to be sent; without an endpoint it is never created.
- WebView is limited to the exact Superset origin and approved HTTPS hosts on their default port; other navigation is blocked and a banner is shown.
  `javascript:`, `intent:`, `file:` and plain `http:` are refused.
- Android `incognito` WebView: **all cookies, cache, history and saved form data are wiped every time the WebView mounts**,
  so a session never survives a timeout, app restart or country switch. Users sign in to Superset each time they open the app.
- Inactivity: measured across foreground/background and from in-page touches/scrolls (throttled bridge). A new timeout applies
  immediately; the page reloads only if the URL changes. On timeout or **Switch country** the WebView is **unmounted**
  at once ("Signing out…"), a best-effort `GET /logout/` is sent (on Android it shares the WebView's cookie store, so it
  carries the session cookie), and then the WebView's cookies and DOM storage are cleared. The same clear runs at app
  launch, so a session left by a killed app does not stay on disk.
- The app is covered whenever it is not in the foreground, and on resume expiry is checked **before** the cover is lifted.
- Screenshots and Android recents previews are blocked before health analytics are shown.
- Backups disabled; cleartext traffic disabled in release builds; debugging of the WebView disabled.

## Diagnostics reporting

Off by default. Set `NEOTREE_TELEMETRY_URL` (HTTPS, e.g. an endpoint on your Webeditor) at build time to enable it;
the build fails on a malformed or non-HTTPS URL. Without it nothing is stored or sent (development builds log to the console).

**What is reported:** render crashes (the app shows a *Something went wrong → Restart* screen instead of going blank),
uncaught JavaScript errors (fatal ones are written to the outbox first and sent on the next launch), Webeditor
configuration errors, Superset page failures (network or HTTP status), failed exports/downloads, and navigation
blocked by the host allowlist. Native (Kotlin/Swift) crashes are not captured.

**What is never reported:** patient or dashboard data, user names, cookies, API keys, query strings. Every string is
scrubbed before it is stored: URLs are cut to origin + path; `nta_…` keys, bearer/JWT tokens, e-mail addresses and
runs of 7+ digits are redacted (`src/lib/telemetryCore.ts`, covered by `npm test`). At most 30 events per app session,
and the same error at most once per 5 minutes.

**Wire format:** `POST <url>` with `Content-Type: application/json`, no cookies, batches of up to 20:

```json
{
  "schema": 1,
  "events": [{
    "id": "lq3x9k2a8f1c",
    "time": "2026-11-15T09:41:07.123Z",
    "kind": "page-error",
    "message": "Superset returned HTTP 502",
    "detail": { "status": 502 },
    "stack": "…(only for JavaScript errors)…",
    "session": "lq3x8z0b4d2e",
    "country": "ZW",
    "app": { "version": "1.0.1", "build": "1", "platform": "android", "os": "34" }
  }]
}
```

`kind` is one of `crash`, `js-error`, `config-error`, `page-error`, `export-failed`, `navigation-blocked`. Reply `2xx`
to accept a batch. `5xx`, `408` and `429` are retried later; any other status drops the batch, so a broken endpoint
cannot fill the device. The endpoint is unauthenticated (the URL is inside the APK), so validate the schema,
rate-limit by IP and cap body size on the receiving side.

## Known limits (please test before rollout)

- Server-side Superset logout is **attempted, not verified**. Cookie clearing guarantees *this device* will not resume the
  session; it does not end it on the server if `/logout/` failed (offline, timeout). On iOS the logout request cannot carry the
  WebView's cookie, so it rarely ends the server session there. Keep Superset's own session lifetime short.
- The activity bridge and login layout hints were checked against a mock page, not your Superset build. Verify on the real
  login page and on small screens.
- Superset's own dashboards and filters may still use desktop-only layouts. `MOBILE_CONSUMPTION_MODE` was merged upstream
  after Superset 6.1.0, so it is not available in 6.1.0. A later server version that includes the feature can enable
  mobile drawers and dashboard layouts; the app cannot enable that mode from a WebView. Test these scoped CSS workarounds on each deployed Superset build and on phones and tablets.
- Superset generates many exports as `blob:` or `data:` links, which Android WebView's HTTP download listener does not receive. The app transfers these exports through its native module to Android Downloads. Files above 100 MB are rejected with a visible error.
- **Android 7–9** cannot write to public Downloads without the storage permission, which this app blocks. There, a finished
  export opens the system **Save as** picker (the banner's **Save…** reopens it); the file is kept privately until then.
  Plain HTTP attachment downloads (handled by the WebView's own downloader, not the export bridge) still require that
  permission on Android 7–9 and therefore fail there.
- Export files never outlive their use: a partial or unsaved export is deleted on **Dismiss**, sign-out, lock, switching
  country, and at the next app launch. An export that stops reporting (the page reloaded or crashed) is marked
  *interrupted* and its partial file removed.
- Android download progress is polled every second only while a download is running or just after the user interacted
  with the page; otherwise every 10 seconds, and not while the app is in the background.
- **iOS exports** use the same bridge, then open the share sheet, where the user picks **Save to Files** (or another app).
  The file is kept in a data-protected temporary folder only while its banner is shown: **Dismiss**, sign-out, inactivity
  lock, switching country and the next app launch all delete it. **Save Image** (Photos), contacts and Reading List are
  removed from the sheet so health data is not copied into the photo library or iCloud Photos. Attachment downloads
  (e.g. CSV) are re-fetched inside the page with its session; only same-origin `GET` downloads can be repeated, so a
  download produced by a form `POST` still fails with a visible error. Dashboard **Export to PDF** is converted on the
  device; very long dashboards are rendered at a lower resolution or refused with a suggestion to download an image.
  Check `npm run build:ios-simulator` (no Apple account needed) compiles before any device build.

### Superset upgrade checklist

Superset menu items have no stable ids, so the export bridge recognises them by their English labels. All patterns live
in one table, `NT_LABELS`, at the top of the injected script (`src/lib/injected.ts`), and `npm test` checks them
against known labels. Checked against **Superset 6.1.0, English UI**. After any Superset upgrade or UI language change,
on a phone and a tablet:

1. Dashboard menu → **Download as Image**: the banner shows progress and the file is saved.
2. Dashboard menu → **Export to PDF**: a multi-page PDF is saved.
3. Chart menu → **Export to .CSV** and **Export to Excel**: the file is saved with the right extension.
4. If a step shows "No file was generated" or nothing happens, compare the menu text with `NT_LABELS` and update it
   (and the label test in `tests/lib.test.ts`).

### Tester screen recordings

Set `NEOTREE_ALLOW_SCREEN_CAPTURE=true` when building an internal feedback APK to allow screenshots and recordings. Omit it for ordinary builds; health analytics and Android recents previews remain protected. Share recordings only through the approved project channel.
- The request to a Webeditor with a wrong/rotated key shows "access key rejected"; rotating the key means shipping a new build.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `master` and every pull request: typecheck, unit tests, the app config
with the example registry (so the allowlist and flag checks still resolve), a dependency audit at high severity, and a
compile of the Android native module. Dependabot (`.github/dependabot.yml`) proposes weekly patch/minor updates;
Expo / React Native majors are left to a deliberate SDK upgrade with `npx expo install --fix`.

## Branding

Icons and splash are generated from `images/logo.png` by `npm run assets` (`scripts/generate-brand-assets.py`),
with the original navy backgrounds replaced by Neotree green `#2E7D5B`.
Keep the source image, generated assets, and generator together so branding can be reproduced when the logo changes.

## App version

Set the user-facing `expo.version` and increment `expo.android.versionCode` in `app.json` for **every** Android build you
distribute. Android refuses to upgrade to an equal or lower `versionCode`, and Google Play rejects the upload.
`app.config.ts` adds the build-time country registry and security settings while preserving those values from `app.json`.
The version number returned by Webeditor is separate: it controls when the app refreshes the Superset configuration.
