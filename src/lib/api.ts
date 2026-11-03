import type { Country } from './types';
import { SyncError } from './sync';

const TIMEOUT_MS = 10_000;

/** The value shipped in the example registry; it means the Webeditor's Reporting Configurations key was never filled in. */
export const PLACEHOLDER_API_KEY = 'nta_REPLACE_WITH_KEY_FROM_REPORTING_CONFIGURATIONS_PAGE';
export const NOT_CONFIGURED_MESSAGE = 'Superset not yet configured on Webeditor. Contact your administrator for assistance';

async function getJson(country: Country, path: string, fetchImpl: typeof fetch): Promise<unknown> {
    // Never send the placeholder to a server: report it as "not configured" straight away.
    if (country.apiKey?.trim() === PLACEHOLDER_API_KEY) throw new SyncError(NOT_CONFIGURED_MESSAGE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetchImpl(`${country.webeditorUrl}${path}`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
                ...(country.apiKey ? { 'x-api-key': country.apiKey } : {}),
            },
        });

        if (res.status === 401) throw new SyncError('The Webeditor rejected this app’s configuration access key. Please contact your support team.', '401');
        if (res.status === 404) throw new SyncError('The Webeditor has no Analytics configuration for this country. Please contact your support team.', '404');
        if (res.status === 429) throw new SyncError('The Webeditor is busy. Please wait a minute, then try again.', '429', true);
        if (res.status >= 500) throw new SyncError('The Webeditor is having a problem. Please try again in a few minutes.', String(res.status), true);
        if (!res.ok) throw new SyncError('The Webeditor could not provide the Analytics configuration. Please contact your support team.', String(res.status));

        return await res.json();
    } catch (e) {
        if (e instanceof SyncError) throw e;
        if ((e as Error)?.name === 'AbortError') throw new SyncError('The Webeditor did not respond in time. Check your connection, then try again.', undefined, true);
        throw new SyncError('Cannot reach the Webeditor to load configuration. Check your connection, then try again.', undefined, true);
    } finally {
        clearTimeout(timer);
    }
}

// Deliberately logs nothing: requests carry the API key.
export function createRemoteApi(fetchImpl: typeof fetch = fetch) {
    return {
        fetchVersion: (country: Country) => getJson(country, '/api/v1/mobile-analytics/version', fetchImpl),
        fetchConfig: (country: Country) => getJson(country, '/api/v1/mobile-analytics/config', fetchImpl),
    };
}
