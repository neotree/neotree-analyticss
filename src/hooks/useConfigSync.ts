import { useCallback, useEffect, useRef, useState } from 'react';

import { createRemoteApi } from '../lib/api';
import { resolveConfig, SyncError } from '../lib/sync';
import type { ConfigStore, Country, RemoteConfig } from '../lib/types';
import { report } from '../lib/telemetry';
import { validateRemoteConfig } from '../lib/validation';

export type SyncState =
    | { status: 'loading'; }
    | { status: 'error'; title: string; message: string; supportCode?: string; }
    // A saved configuration remains usable while Webeditor is temporarily unavailable.
    | { status: 'ready'; config: RemoteConfig; verifyError?: string; usingSavedConfig?: boolean; };

const api = createRemoteApi();
const FOREGROUND_RECHECK_INTERVAL_MS = 60_000;

/**
 * Keeps one country's cached config in step with its Webeditor.
 * Runs once on mount (guarded effect, not per-render) and again when `recheck` is called. Calls are
 * de-duplicated: while a check is in flight, further calls share it, so re-renders cannot cause loops.
 */
export function useConfigSync(country: Country, store: ConfigStore, allowInsecure: boolean) {
    const [state, setState] = useState<SyncState>({ status: 'loading' });
    const inFlight = useRef<Promise<void> | null>(null);
    const mounted = useRef(true);
    const lastVerifiedAt = useRef<number | null>(null);

    const run = useCallback((background: boolean) => {
        if (inFlight.current) return inFlight.current;

        const task = (async () => {
            if (!background) setState({ status: 'loading' });

            try {
                const local = await store.getConfig(country.code);
                if (lastVerifiedAt.current === null) lastVerifiedAt.current = local?.lastCheckedAt ?? null;
                const cached = local && validateRemoteConfig(local, country, { allowInsecure });
                if (!background && cached?.ok && local?.webeditorUrl === country.webeditorUrl && mounted.current) {
                    setState({ status: 'ready', config: cached.value });
                }

                const { config, fetched, verified, warning } = await resolveConfig(country, local, api, { allowInsecure });
                const now = Date.now();

                if (verified) {
                    if (fetched) await store.saveConfig(country.code, config, now, country.webeditorUrl);
                    else await store.touchChecked(country.code, now);
                    lastVerifiedAt.current = now;
                }

                if (!mounted.current) return;

                // Keep the same object when nothing changed so effects keyed on it don't re-fire.
                setState(prev => (
                    prev.status === 'ready'
                        && prev.config.versionNumber === config.versionNumber
                        && prev.config.supersetUrl === config.supersetUrl
                        && prev.config.inactivityTimeoutMinutes === config.inactivityTimeoutMinutes
                        && prev.verifyError === warning
                        && !!prev.usingSavedConfig === !verified
                        ? prev
                        : { status: 'ready', config, verifyError: warning, usingSavedConfig: !verified }
                ));
            } catch (e) {
                if (!mounted.current) return;
                const message = (e as Error)?.message || 'Could not verify configuration.';
                const supportCode = e instanceof SyncError ? e.supportCode : undefined;
                const title = e instanceof SyncError ? 'Webeditor configuration unavailable' : 'Configuration unavailable';
                report('config-error', message, { supportCode: supportCode ?? null, background, recoverable: e instanceof SyncError && e.recoverable });
                setState(prev => (background && prev.status === 'ready'
                    ? { ...prev, verifyError: message }
                    : { status: 'error', title, message, supportCode }));
            }
        })().finally(() => { inFlight.current = null; });

        inFlight.current = task;
        return task;
    }, [country, store, allowInsecure]);

    useEffect(() => {
        mounted.current = true;
        run(false);
        return () => { mounted.current = false; };
    }, [run]);

    const retry = useCallback(() => run(false), [run]);
    const refresh = useCallback(() => run(true), [run]);
    const recheck = useCallback(() => {
        const elapsed = lastVerifiedAt.current === null ? Infinity : Date.now() - lastVerifiedAt.current;
        if (elapsed >= 0 && elapsed < FOREGROUND_RECHECK_INTERVAL_MS) return Promise.resolve();
        return run(true);
    }, [run]);

    return { state, retry, refresh, recheck };
}
