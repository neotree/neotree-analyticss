import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const GREEN = '#2E7D5B';

/**
 * Country registry, resolved at build time (never committed with real values):
 *   1. NEOTREE_COUNTRIES_JSON  - the JSON itself (CI / EAS secret)
 *   2. NEOTREE_COUNTRIES_FILE  - path to a JSON file (EAS "file" secret)
 *   3. config/countries.local.json - gitignored, for local development
 *   4. config/countries.json - checked-in fallback
 *
 * Anything placed here ends up inside the APK and can be extracted. Only put an analytics-only key
 * in `apiKey` - never an administrator or data-access key.
 */
function loadRegistry(): unknown {
    const read = (file: string) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

    if (process.env.NEOTREE_COUNTRIES_JSON) return JSON.parse(process.env.NEOTREE_COUNTRIES_JSON);
    if (process.env.NEOTREE_COUNTRIES_FILE) return read(process.env.NEOTREE_COUNTRIES_FILE);
    if (fs.existsSync('config/countries.local.json')) return read('config/countries.local.json');
    if (fs.existsSync('config/countries.json')) {
        const fallback = read('config/countries.json');
        const fallbackText = JSON.stringify(fallback);
        if (process.env.EAS_BUILD && (fallbackText.includes('REPLACE_WITH_KEY') || fallbackText.includes('example.org'))) {
            throw new Error('config/countries.json contains placeholder settings. Supply a real registry for this build.');
        }
        return fallback;
    }

    throw new Error('No country registry found. Supply config/countries.local.json, config/countries.json, NEOTREE_COUNTRIES_FILE, or NEOTREE_COUNTRIES_JSON.');
}

/** Same rule as the runtime parser, applied at build time so a registry without host pinning never ships. */
function assertAllowedHosts(registry: unknown): unknown {
    const countries = (registry as { countries?: { code?: unknown; allowedHosts?: unknown; }[]; } | null)?.countries;
    if (!Array.isArray(countries)) return registry;
    const missing = countries
        .filter(country => !Array.isArray(country?.allowedHosts) || !country.allowedHosts.some(host => typeof host === 'string' && host.trim()))
        .map((country, index) => (typeof country?.code === 'string' ? country.code : `countries[${index}]`));
    if (missing.length) {
        throw new Error(`Country registry: allowedHosts must list the approved Superset host for ${missing.join(', ')}`);
    }
    return registry;
}

/** Optional diagnostics endpoint. Must be HTTPS (no credentials in the URL); checked so a typo fails the build. */
function telemetryUrl(): string | undefined {
    const value = process.env.NEOTREE_TELEMETRY_URL?.trim();
    if (!value) return undefined;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('NEOTREE_TELEMETRY_URL is not a valid URL'); }
    if (url.protocol !== 'https:') throw new Error('NEOTREE_TELEMETRY_URL must use HTTPS');
    if (url.username || url.password) throw new Error('NEOTREE_TELEMETRY_URL must not contain credentials');
    return url.href;
}

const FLAG_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_FLAG_BYTES = 150 * 1024;

function flagDataUri(file: string, code: string): string {
    const full = path.resolve(file);
    const type = FLAG_TYPES[path.extname(full).toLowerCase()];
    if (!type) throw new Error(`Flag for ${code} must be a .png, .jpg or .webp file (got "${file}")`);
    if (!fs.existsSync(full)) throw new Error(`Flag file for ${code} not found: ${file}`);
    const bytes = fs.readFileSync(full);
    if (bytes.length > MAX_FLAG_BYTES) throw new Error(`Flag for ${code} is larger than ${MAX_FLAG_BYTES / 1024} KB; use a smaller image`);
    return `data:${type};base64,${bytes.toString('base64')}`;
}

/**
 * Flags are part of each country's registry entry: `"flag"` is a path to an image (relative to the project root),
 * an https URL, or omitted. When omitted, assets/flags/<code>.png is used if it exists, otherwise the app shows the
 * country code instead. File flags are embedded into the build, so the picker works offline.
 */
function withFlags(registry: unknown): unknown {
    const root = registry as { countries?: Record<string, unknown>[]; } | null;
    if (!root || !Array.isArray(root.countries)) return registry;

    return {
        ...root,
        countries: root.countries.map(country => {
            const code = typeof country?.code === 'string' ? country.code.trim().toLowerCase() : '';
            const explicit = typeof country?.flag === 'string' && country.flag.trim() ? country.flag.trim() : undefined;
            if (explicit && (explicit.startsWith('https://') || explicit.startsWith('data:image/'))) return country;

            const file = explicit ?? (code ? `assets/flags/${code}.png` : undefined);
            if (!file || (!explicit && !fs.existsSync(path.resolve(file)))) return country;
            return { ...country, flag: flagDataUri(file, code.toUpperCase()) };
        }),
    };
}

export default ({ config }: ConfigContext): ExpoConfig => ({
    ...config,
    name: 'Neotree Analytics',
    slug: 'neotree-analytics',
    scheme: 'neotree-analytics',
    // Every orientation is allowed here; src/lib/orientation.ts keeps phones in portrait at launch.
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    backgroundColor: '#FFFFFF',
    primaryColor: GREEN,
    ios: {
        bundleIdentifier: 'app.neotree.analytics',
        supportsTablet: true,
    },
    android: {
        ...config.android,
        package: 'app.neotree.analytics',
        // Keep the config cache out of device backups.
        allowBackup: false,
        adaptiveIcon: {
            backgroundColor: GREEN,
            foregroundImage: './assets/android-icon-foreground.png',
            backgroundImage: './assets/android-icon-background.png',
            monochromeImage: './assets/android-icon-monochrome.png',
        },
        predictiveBackGestureEnabled: false,
        blockedPermissions: [
            'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.WRITE_EXTERNAL_STORAGE',
        ],
    },
    plugins: [
        './plugins/withSecureAndroidReleaseSigning',
        'expo-sqlite',
        [
            'expo-splash-screen',
            {
                image: './assets/splash-icon.png',
                imageWidth: 240,
                backgroundColor: '#FFFFFF',
                dark: {
                    image: './assets/splash-icon-dark.png',
                    backgroundColor: GREEN,
                },
            },
        ],
        [
            'expo-build-properties',
            {
                android: {
                    usesCleartextTraffic: false,
                    // R8 shrinking/obfuscation of native code in release builds.
                    enableProguardInReleaseBuilds: true,
                    enableShrinkResourcesInReleaseBuilds: true,
                },
            },
        ],
    ],
    extra: {
        countryRegistry: withFlags(assertAllowedHosts(loadRegistry())),
        // Internal feedback builds may opt in to screen recording. Keep release builds protected.
        allowScreenCapture: process.env.NEOTREE_ALLOW_SCREEN_CAPTURE === 'true',
        // Diagnostics reporting (README "Diagnostics reporting"). Unset means nothing is stored or sent.
        telemetryUrl: telemetryUrl(),
        ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
    },
});
