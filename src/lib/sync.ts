import type { Country, RemoteConfig, StoredConfig } from './types';
import { validateRemoteConfig, validateVersion } from './validation';

export class SyncError extends Error {
    constructor(message: string, readonly supportCode?: string, readonly recoverable = false) {
        super(message);
        this.name = 'SyncError';
    }
}

export type RemoteApi = {
    fetchVersion(country: Country): Promise<unknown>;
    fetchConfig(country: Country): Promise<unknown>;
};

/**
 * The version-check flow from the requirements:
 *  - ask the Webeditor for versionNumber;
 *  - same as the (valid) cached one => keep the cache, no full-config fetch;
 *  - different or missing => fetch + validate the full config.
 * If Webeditor is temporarily unavailable, a valid saved configuration can still open Superset.
 */
export async function resolveConfig(
    country: Country,
    local: StoredConfig | null,
    api: RemoteApi,
    opts: { allowInsecure: boolean; },
): Promise<{ config: RemoteConfig; fetched: boolean; verified: boolean; warning?: string; }> {
    const cached = local && validateRemoteConfig(local, country, opts);
    const cachedConfig = cached?.ok && local?.webeditorUrl === country.webeditorUrl ? cached.value : null;

    try {
        const version = validateVersion(((await api.fetchVersion(country)) as any)?.versionNumber);
        if (!version.ok) throw new SyncError(version.error);

        if (cachedConfig && cachedConfig.versionNumber === version.value) {
            return { config: cachedConfig, fetched: false, verified: true };
        }

        const validated = validateRemoteConfig(await api.fetchConfig(country), country, opts);
        if (!validated.ok) throw new SyncError(validated.error);

        return { config: validated.value, fetched: true, verified: true };
    } catch (e) {
        if (cachedConfig && e instanceof SyncError && e.recoverable) {
            return { config: cachedConfig, fetched: false, verified: false, warning: e.message };
        }
        throw e;
    }
}
