import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

const CHECK_INTERVAL_MS = 10_000;

/**
 * Inactivity clock across foreground and background.
 *  - `markActivity` is the only thing that resets it, so re-renders cannot.
 *  - The timeout is read from a ref, so a new value from a config sync applies immediately.
 *  - `covered` is true whenever the app is not in the foreground. On resume the expiry is checked
 *    BEFORE the cover is lifted, so an expired session never flashes on screen.
 */
export function useInactivity(params: { enabled: boolean; timeoutMinutes: number; onTimeout: () => void; }) {
    const { enabled, timeoutMinutes, onTimeout } = params;
    const lastActivity = useRef(Date.now());
    const timeoutMs = useRef(timeoutMinutes * 60_000);
    const onTimeoutRef = useRef(onTimeout);
    const fired = useRef(false);
    const [covered, setCovered] = useState(AppState.currentState !== 'active');

    timeoutMs.current = timeoutMinutes * 60_000;
    onTimeoutRef.current = onTimeout;

    const markActivity = useCallback(() => {
        lastActivity.current = Date.now();
    }, []);

    const expireIfNeeded = useCallback(() => {
        if (fired.current || Date.now() - lastActivity.current < timeoutMs.current) return false;
        fired.current = true;
        onTimeoutRef.current();
        return true;
    }, []);

    useEffect(() => {
        if (!enabled) return;

        lastActivity.current = Date.now();
        fired.current = false;

        const sub = AppState.addEventListener('change', next => {
            if (next === 'active') {
                if (!expireIfNeeded()) setCovered(false);
            } else {
                setCovered(true);
            }
        });
        const timer = setInterval(() => {
            if (AppState.currentState === 'active') expireIfNeeded();
        }, CHECK_INTERVAL_MS);

        return () => {
            sub.remove();
            clearInterval(timer);
        };
    }, [enabled, expireIfNeeded]);

    return { covered, markActivity };
}
