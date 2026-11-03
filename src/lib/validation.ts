import type { Country, RemoteConfig } from './types';

export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 1440;

/** `host` matches exactly; `*.host` matches any subdomain (not the bare domain). */
export function hostMatches(host: string, patterns: string[]) {
    const h = host.toLowerCase();
    return patterns.some(p => (p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p));
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
    if (country.allowedHosts.length && !hostMatches(url.hostname, country.allowedHosts)) {
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

    // A different port on the same hostname is a different web origin. Host patterns are limited
    // to the default HTTPS port; a custom port is accepted only for the exact configured origin.
    return target.origin === base.origin || (target.protocol === 'https:' && !target.port && hostMatches(target.hostname, allowedHosts));
}
