import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { canTrackDownloads, downloadStatus, listDownloads, type AndroidDownload } from '../lib/downloads';
import { report } from '../lib/telemetry';

const POLL_FAST_MS = 1_000;
const POLL_IDLE_MS = 10_000;
const POLL_FAST_WINDOW_MS = 15_000;

/**
 * Follows the newest HTTP download the WebView handed to Android's DownloadManager, which offers no
 * start event to the app. Polls every second only while that download runs or just after the user
 * interacted (call `kickDownloadPolling`: a tap may have started one); otherwise every 10 seconds, and
 * not at all in the background. Downloads that existed before the screen opened are ignored.
 */
export function useDownloadTracker() {
    const [download, setDownload] = useState<AndroidDownload | null>(null);
    const seenDownloads = useRef<Set<string> | null>(null);
    const pollFastUntil = useRef(0);
    const wakeDownloadPoll = useRef<(() => void) | null>(null);

    const kickDownloadPolling = useCallback(() => {
        pollFastUntil.current = Date.now() + POLL_FAST_WINDOW_MS;
        wakeDownloadPoll.current?.();
    }, []);
    const dismissDownload = useCallback(() => setDownload(null), []);

    useEffect(() => {
        if (!canTrackDownloads) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let trackedActive = false;
        let trackedId: string | null = null;
        const schedule = () => {
            if (cancelled) return;
            if (timer) clearTimeout(timer);
            const fast = trackedActive || Date.now() < pollFastUntil.current;
            timer = setTimeout(check, fast ? POLL_FAST_MS : POLL_IDLE_MS);
        };
        const check = async () => {
            timer = null;
            if (AppState.currentState !== 'active') return schedule();
            try {
                const downloads = await listDownloads();
                if (cancelled) return;
                if (!seenDownloads.current) {
                    seenDownloads.current = new Set(downloads.map(item => item.id));
                    return;
                }
                const newest = downloads.filter(item => !seenDownloads.current!.has(item.id))
                    .sort((a, b) => Number(b.id) - Number(a.id))[0];
                if (newest) {
                    seenDownloads.current.add(newest.id);
                    trackedId = newest.id;
                    setDownload(newest);
                } else {
                    setDownload(previous => previous && downloads.find(item => item.id === previous.id) || previous);
                }
                const tracked = trackedId ? downloads.find(item => item.id === trackedId) : undefined;
                trackedActive = !!tracked && downloadStatus(tracked) === 'active';
            } catch {
                // Android's own download notification remains available if status polling fails.
            } finally {
                schedule();
            }
        };
        wakeDownloadPoll.current = () => {
            if (!timer) return; // a check is already running and will reschedule itself
            clearTimeout(timer);
            timer = null;
            void check();
        };
        void check();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            wakeDownloadPoll.current = null;
        };
    }, []);

    const failed = !!download && downloadStatus(download) === 'failed';
    useEffect(() => {
        if (failed) report('export-failed', 'Android download failed', { source: 'download-manager' });
    }, [failed, download?.id]);

    return { download, dismissDownload, kickDownloadPolling };
}
