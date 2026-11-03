const TIMEOUT_MS = 4000;

/**
 * Best-effort Superset logout (GET /logout/) so a server-side session is ended where possible.
 * It can fail silently (offline, session already gone, Superset customisation), and removing the
 * WebView does NOT end a server session. The next WebView mount also wipes all cookies
 * (`incognito`), so a device never resumes an old session, but treat server-side invalidation as
 * "attempted", not "verified". Never throws and never blocks the lock screen.
 */
export async function bestEffortLogout(supersetUrl: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        await fetch(`${supersetUrl.replace(/\/+$/, '')}/logout/`, {
            method: 'GET',
            credentials: 'include',
            signal: controller.signal,
        });
    } catch {
        // intentionally ignored
    } finally {
        clearTimeout(timer);
    }
}
