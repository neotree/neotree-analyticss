import type { Country } from './types';

export const DEFAULT_LANDING_PATH = '/login/';

const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function parseBaseUrl(value: unknown, label: string, allowInsecure: boolean): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);

    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error(`${label} is not a valid URL`);
    }

    if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
        throw new Error(`${label} must use HTTPS`);
    }
    if (url.username || url.password) throw new Error(`${label} must not contain credentials`);

    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function parsePath(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
        throw new Error(`${label} must start with a single "/"`);
    }
    return value;
}

const FLAG_PATTERN = /^(https:\/\/\S+|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/;

function parseFlag(value: unknown, label: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !FLAG_PATTERN.test(value.trim())) {
        throw new Error(`${label}.flag must be an https URL or an embedded png/jpeg/webp image`);
    }
    return value.trim();
}

/**
 * Validates the build-time country registry. Throws a descriptive Error so a bad registry fails
 * loudly on launch instead of silently pointing the app at the wrong place.
 */
export function parseCountryRegistry(raw: unknown, opts: { allowInsecure: boolean; }): Country[] {
    const root = raw as { defaultLandingPath?: unknown; countries?: unknown; } | null;

    if (!root || !Array.isArray(root.countries) || !root.countries.length) {
        throw new Error('Country registry must contain at least one country');
    }

    const defaultLandingPath = root.defaultLandingPath === undefined
        ? DEFAULT_LANDING_PATH
        : parsePath(root.defaultLandingPath, 'defaultLandingPath');

    const seen = new Set<string>();

    return root.countries.map((item: any, index) => {
        const label = `countries[${index}]`;
        const code = typeof item?.code === 'string' ? item.code.trim().toUpperCase() : '';
        const name = typeof item?.name === 'string' ? item.name.trim() : '';

        if (!code) throw new Error(`${label}.code is required`);
        if (!name) throw new Error(`${label}.name is required`);
        if (seen.has(code)) throw new Error(`${label}.code "${code}" is duplicated`);
        seen.add(code);

        const allowedHosts = (Array.isArray(item.allowedHosts) ? item.allowedHosts : []).map((h: unknown) => {
            const host = typeof h === 'string' ? h.trim().toLowerCase() : '';
            if (!HOST_PATTERN.test(host)) throw new Error(`${label}.allowedHosts contains an invalid host`);
            return host;
        });

        return {
            code,
            name,
            flag: parseFlag(item.flag, label),
            webeditorUrl: parseBaseUrl(item.webeditorUrl, `${label}.webeditorUrl`, opts.allowInsecure),
            apiKey: typeof item.apiKey === 'string' && item.apiKey.trim() ? item.apiKey.trim() : undefined,
            landingPath: item.landingPath === undefined ? defaultLandingPath : parsePath(item.landingPath, `${label}.landingPath`),
            allowedHosts,
        };
    });
}
