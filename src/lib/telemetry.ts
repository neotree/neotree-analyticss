import Constants from 'expo-constants';
import * as SQLite from 'expo-sqlite';
import { AppState, Platform } from 'react-native';

import { ALLOW_INSECURE } from '../config';
import { createReporter, parseTelemetryUrl, type TelemetryDetail, type TelemetryEvent, type TelemetryKind } from './telemetryCore';

/** Build-time endpoint (NEOTREE_TELEMETRY_URL). Without one, nothing is stored or sent. */
const endpoint = parseTelemetryUrl((Constants.expoConfig?.extra as { telemetryUrl?: unknown; } | undefined)?.telemetryUrl, ALLOW_INSECURE);
export const telemetryEnabled = !!endpoint;

const MAX_OUTBOX = 50;
const BATCH_SIZE = 20;
const SEND_TIMEOUT_MS = 8_000;
const FLUSH_DELAY_MS = 2_000;

let db: SQLite.SQLiteDatabase | null = null;
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Separate database from the configuration cache. It holds only scrubbed diagnostic events waiting to be
 * sent (at most 50), and is written synchronously so a fatal crash is still reported on the next launch.
 */
function outbox(): SQLite.SQLiteDatabase {
    if (!db) {
        db = SQLite.openDatabaseSync('neotree-diagnostics.db');
        db.execSync('CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)');
    }
    return db;
}

function enqueue(event: TelemetryEvent) {
    if (!endpoint) {
        if (__DEV__) console.warn(`[diagnostics] ${event.kind}: ${event.message}`);
        return;
    }
    try {
        const store = outbox();
        store.runSync('INSERT OR IGNORE INTO outbox (id, body, created_at) VALUES (?, ?, ?)', event.id, JSON.stringify(event), Date.now());
        store.runSync('DELETE FROM outbox WHERE id NOT IN (SELECT id FROM outbox ORDER BY created_at DESC LIMIT ?)', MAX_OUTBOX);
    } catch {
        // Diagnostics must never break the app.
    }
    scheduleFlush();
}

function scheduleFlush(delay = FLUSH_DELAY_MS) {
    if (!endpoint || flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushTelemetry();
    }, delay);
}

/** Sends waiting events. Kept on network errors and 5xx/408/429; dropped once accepted or permanently rejected. */
export async function flushTelemetry(): Promise<void> {
    if (!endpoint || flushing) return;
    flushing = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
        const rows = outbox().getAllSync<{ id: string; body: string; }>('SELECT id, body FROM outbox ORDER BY created_at LIMIT ?', BATCH_SIZE);
        if (!rows.length) return;
        const events = rows.map(row => { try { return JSON.parse(row.body) as TelemetryEvent; } catch { return null; } }).filter(Boolean);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ schema: 1, events }),
            credentials: 'omit',
            signal: controller.signal,
        });
        const retry = response.status >= 500 || response.status === 408 || response.status === 429;
        if (!retry) {
            outbox().runSync(`DELETE FROM outbox WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map(row => row.id));
            if (rows.length === BATCH_SIZE) scheduleFlush(0);
        }
    } catch {
        // Offline or endpoint down: events stay in the outbox for the next attempt.
    } finally {
        clearTimeout(timer);
        flushing = false;
    }
}

const reporter = createReporter({
    app: {
        version: Constants.expoConfig?.version ?? 'unknown',
        build: String((Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : Constants.expoConfig?.ios?.buildNumber) ?? ''),
        platform: Platform.OS,
        os: String(Platform.Version),
    },
    enqueue,
});

/** Records a diagnostic event (scrubbed, rate-limited). Never throws. */
export function report(kind: TelemetryKind, error: unknown, detail?: TelemetryDetail) {
    try {
        reporter.report(kind, error, detail);
    } catch {
        // Diagnostics must never break the app.
    }
}

/** The selected country's code is attached to later events (it is not personal data). */
export function setTelemetryCountry(code: string | null) {
    reporter.setCountry(code);
}

/** Reports uncaught JavaScript errors, then lets React Native's own handler continue (red box / crash). */
export function startTelemetry() {
    const errorUtils = (globalThis as { ErrorUtils?: { getGlobalHandler(): (error: unknown, isFatal?: boolean) => void; setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void; }; }).ErrorUtils;
    if (errorUtils) {
        const previous = errorUtils.getGlobalHandler();
        errorUtils.setGlobalHandler((error, isFatal) => {
            report('js-error', error, { fatal: !!isFatal });
            previous(error, isFatal);
        });
    }
    if (!endpoint) return;
    AppState.addEventListener('change', state => { if (state === 'active') scheduleFlush(0); });
    scheduleFlush(0);
}
