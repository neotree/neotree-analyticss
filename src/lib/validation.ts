import type { Country, RemoteConfig } from './types';

export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 1440;

/**
 * `host` matches exactly; `*.host` matches any subdomain (not the bare domain). A pattern may end in
 * `:port` to approve that port only; without one it approves the scheme's default port only.
 */
export function hostMatches(url: URL, patterns: string[]) {
    const h = url.hostname.toLowerCase();
    return patterns.some(pattern => {
        const [p, port = ''] = pattern.split(':');
        if (port !== url.port) return false;
        return p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p;
    });
}

type Opts = { allowInsecure: boolean; };

export type ValidationResult<T> = { ok: true; value: T; } | { ok: false; error: string; };

/** Validates the Webeditor /config response: HTTPS, approved host, timeout bounds, version. */
export function validateRemoteConfig(raw: unknown, country: Country, opts: Opts): ValidationResult<RemoteConfig> {
    const r = raw as Partial<Record<keyof RemoteConfig, unknown>> | null;

    if (!r || typeof r !== 'object') return { ok: false, error: 'Configuration response is malformed' };

    const version = validateVersion(r.versionNumber);
    if (!version.ok) return version;

    const timeout = r.inactivityTimeoutMinutes;
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MINUTES || timeout > MAX_TIMEOUT_MINUTES) {
        return { ok: false, error: 'Configuration has an invalid inactivity timeout' };
    }

    let url: URL;
    try {
        url = new URL(String(r.supersetUrl));
    } catch {
        return { ok: false, error: 'Configuration has an invalid Superset URL' };
    }

    if (url.protocol !== 'https:' && !(opts.allowInsecure && url.protocol === 'http:')) {
        return { ok: false, error: 'Superset URL must use HTTPS' };
    }
    if (url.username || url.password) return { ok: false, error: 'Superset URL must not contain credentials' };
    // An empty allowlist approves nothing: the registry requires one, and this check never fails open.
    if (!hostMatches(url, country.allowedHosts)) {
        return { ok: false, error: 'Superset host is not an approved host for this country' };
    }

    return {
        ok: true,
        value: {
            supersetUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ''),
            inactivityTimeoutMinutes: timeout,
            versionNumber: version.value,
        },
    };
}

export function validateVersion(raw: unknown): ValidationResult<number> {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
        return { ok: false, error: 'Version response is malformed' };
    }
    return { ok: true, value: raw };
}

/** Superset base URL + the app-configured landing path. */
export function buildLandingUrl(supersetUrl: string, landingPath: string) {
    return `${supersetUrl.replace(/\/+$/, '')}${landingPath}`;
}

/**
 * WebView navigation allowlist: only the Superset host (plus the country's explicitly allowed hosts)
 * over HTTPS. Anything else - other hosts, http, intent:, file:, javascript: - is refused.
 */
export function isNavigationAllowed(url: string, supersetUrl: string, allowedHosts: string[], opts: Opts) {
    if (url === 'about:blank') return true;

    let target: URL;
    let base: URL;
    try {
        target = new URL(url);
        base = new URL(supersetUrl);
    } catch {
        return false;
    }

    if (target.protocol !== 'https:' && !(opts.allowInsecure && target.protocol === 'http:')) return false;

    // A different port on the same hostname is a different web origin: hostMatches approves a custom
    // port only when an allowedHosts entry names it.
    return target.origin === base.origin || (target.protocol === 'https:' && hostMatches(target, allowedHosts));
}

/** Hide authoring routes from this read-only WebView without showing a blocked-host warning. */
export function isAuthoringDestination(url: string, supersetUrl: string): boolean {
    try {
        const target = new URL(url);
        if (target.origin !== new URL(supersetUrl).origin) return false;
        return /\/(?:chart\/add|dashboard\/(?:new|import)|dataset\/add)(?:\/|$)/i.test(target.pathname)
            || (/\/sqllab\/?$/i.test(target.pathname) && target.searchParams.get('new') === 'true');
    } catch {
        return false;
    }
}
