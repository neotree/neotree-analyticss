/**
 * Diagnostics reporting core: no React Native imports, so it is unit-tested in Node.
 *
 * Privacy rules (health analytics app): an event never carries patient data, dashboard content, user
 * names, cookies, API keys or query strings. Only app-generated messages, error types and stacks are
 * sent, and every string is scrubbed first. See README "Diagnostics reporting" for the wire format.
 */

export type TelemetryKind =
    | 'crash'           // render error caught by the error boundary
    | 'js-error'        // uncaught JavaScript error (fatal or not)
    | 'config-error'    // Webeditor configuration could not be loaded or verified
    | 'page-error'      // Superset page failed to load (network or HTTP status)
    | 'export-failed'   // an export or download could not be saved
    | 'navigation-blocked'; // the WebView tried to leave the approved hosts

export type TelemetryDetail = Record<string, string | number | boolean | null>;

export type TelemetryEvent = {
    id: string;
    time: string;
    kind: TelemetryKind;
    message: string;
    detail?: TelemetryDetail;
    stack?: string;
    session: string;
    country: string | null;
    app: { version: string; build: string; platform: string; os: string; };
};

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_DETAIL_VALUE = 200;
const MAX_DETAIL_KEYS = 12;

/**
 * Removes anything that could identify a person or grant access:
 *  - URLs keep only origin + path (query strings carry filter values and session keys);
 *  - Webeditor analytics keys, bearer/JWT tokens and e-mail addresses are redacted;
 *  - long digit runs (record numbers, phone numbers) are redacted.
 */
export function scrubText(value: unknown, max = MAX_MESSAGE): string {
    let text = String(value ?? '');
    text = text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>()]+/gi, match => {
        try {
            const url = new URL(match);
            return `${url.origin}${url.pathname}`;
        } catch {
            return '[url]';
        }
    });
    text = text
        .replace(/\bnta_[A-Za-z0-9_-]+/g, '[key]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
        .replace(/\d{7,}/g, '[number]');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function scrubDetail(detail: TelemetryDetail | undefined): TelemetryDetail | undefined {
    if (!detail) return undefined;
    const out: TelemetryDetail = {};
    for (const [key, value] of Object.entries(detail).slice(0, MAX_DETAIL_KEYS)) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
        out[key] = typeof value === 'string' ? scrubText(value, MAX_DETAIL_VALUE)
            : typeof value === 'number' ? (Number.isFinite(value) ? value : null)
            : value;
    }
    return out;
}

export function randomId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export type ReporterOptions = {
    app: TelemetryEvent['app'];
    /** Stores and sends events; the core never touches the network itself. */
    enqueue: (event: TelemetryEvent) => void;
    now?: () => number;
    maxPerSession?: number;
    dedupeWindowMs?: number;
};

/**
 * Builds scrubbed events and limits volume: at most `maxPerSession` events, and the same kind+message
 * only once per `dedupeWindowMs`, so a failure loop cannot flood the endpoint or the device.
 */
export function createReporter(options: ReporterOptions) {
    const now = options.now ?? Date.now;
    const maxPerSession = options.maxPerSession ?? 30;
    const dedupeWindowMs = options.dedupeWindowMs ?? 5 * 60_000;
    const session = randomId();
    const lastSeen = new Map<string, number>();
    let sent = 0;
    let country: string | null = null;

    return {
        setCountry(code: string | null) { country = code; },
        report(kind: TelemetryKind, error: unknown, detail?: TelemetryDetail): TelemetryEvent | null {
            const message = scrubText(error instanceof Error ? `${error.name}: ${error.message}` : error);
            const key = `${kind}|${message}`;
            const at = now();
            const previous = lastSeen.get(key);
            if (previous !== undefined && at - previous < dedupeWindowMs) return null;
            if (sent >= maxPerSession) return null;
            lastSeen.set(key, at);
            sent += 1;
            const stack = error instanceof Error && error.stack ? scrubText(error.stack, MAX_STACK) : undefined;
            const event: TelemetryEvent = {
                id: randomId(),
                time: new Date(at).toISOString(),
                kind,
                message,
                ...(detail ? { detail: scrubDetail(detail) } : {}),
                ...(stack ? { stack } : {}),
                session,
                country,
                app: options.app,
            };
            options.enqueue(event);
            return event;
        },
    };
}

/** Accepts only an https endpoint without credentials (http allowed for local development). */
export function parseTelemetryUrl(value: unknown, allowInsecure: boolean): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value.trim());
        if (url.username || url.password) return null;
        if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) return null;
        return url.href;
    } catch {
        return null;
    }
}
