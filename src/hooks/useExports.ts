import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { abortExport, discardAllExports, discardExport, parseExportMessage, saveExportMessage, shareExport, sharesExports } from '../lib/downloads';
import { report } from '../lib/telemetry';

// Longer than the page's own timeouts (120 s to generate, 30 s per transferred chunk), so these only
// fire when the page can no longer report.
const PREPARE_SILENCE_MS = 150_000;
const TRANSFER_SILENCE_MS = 45_000;

/**
 * 'ready' (iOS, Android 7-9): the file is finished and waits for the user to save it.
 * 'complete': saved to Downloads (Android 10+) or saved/shared by the user.
 */
export type ExportProgress = {
    id: string;
    name: string;
    status: 'preparing' | 'saving' | 'ready' | 'complete' | 'failed';
    downloaded: number;
    total: number;
    error?: string;
};

/** Label the injected script uses for the dashboard PDF wait, which the user can cancel. */
export const PDF_WAIT_NAME = 'Preparing dashboard PDF';

type ScriptTarget = { injectJavaScript(script: string): void; };

/**
 * App side of the injected export bridge: receives export messages from the page, saves the chunks
 * through the native module and acknowledges each one, and keeps the banner state. Export files never
 * outlive their banner, the session or this screen; an export that falls silent is marked interrupted.
 */
export function useExports(webViewRef: RefObject<ScriptTarget | null>) {
    const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
    const [exportElapsed, setExportElapsed] = useState(0);
    // The export whose file belongs to the visible banner (iOS / Android 7-9 keep it until saved).
    const bannerExportId = useRef<string | null>(null);
    // Last export message from the page; a silent export means the page that produced it is gone.
    const exportActivityAt = useRef(0);

    const showExport = useCallback((id: string) => {
        if (bannerExportId.current && bannerExportId.current !== id) void discardExport(bannerExportId.current);
        bannerExportId.current = id;
    }, []);

    const dismissExport = useCallback(() => {
        if (bannerExportId.current) void discardExport(bannerExportId.current);
        bannerExportId.current = null;
        setExportProgress(null);
    }, []);

    const presentShare = useCallback(async (id: string) => {
        try {
            const done = await shareExport(id);
            setExportProgress(previous => (previous?.id === id ? { ...previous, status: done ? 'complete' : 'ready' } : previous));
        } catch (error) {
            setExportProgress(previous => (previous?.id === id
                ? { ...previous, status: 'failed', error: error instanceof Error ? error.message : 'Could not open the share sheet' }
                : previous));
        }
    }, []);

    /** Removes every export file, e.g. before the session ends. */
    const discardAll = useCallback(async () => {
        bannerExportId.current = null;
        await discardAllExports();
    }, []);

    const cancelPdfWait = useCallback(() => {
        webViewRef.current?.injectJavaScript('window.__ntCancelPdfWait && window.__ntCancelPdfWait();true;');
    }, [webViewRef]);

    /** Handles one WebView message. Returns true if it was an export message (and so fully consumed). */
    const handleExportMessage = useCallback((data: string): boolean => {
        const message = parseExportMessage(data);
        if (!message) return false;
        exportActivityAt.current = Date.now();
        if (message.type === 'export-prepare') {
            showExport(message.id);
            setExportProgress({ id: message.id, name: message.name, status: 'preparing', downloaded: 0, total: 0 });
        } else if (message.type === 'export-abort') {
            void abortExport(message.id);
            if (message.error === 'Cancelled') setExportProgress(null);
            else setExportProgress(previous => (previous?.id === message.id
                ? { ...previous, status: 'failed', error: message.error }
                : { id: message.id, name: message.name, status: 'failed', downloaded: 0, total: 0, error: message.error }));
        } else {
            const ack = (ok: boolean, error?: string) => webViewRef.current?.injectJavaScript(
                `window.__ntDownloadAck(${JSON.stringify(message.id)},${message.sequence},${ok}${error === undefined ? '' : `,${JSON.stringify(error)}`});true;`,
            );
            void (async () => {
                try {
                    const result = await saveExportMessage(message);
                    setExportProgress(previous => {
                        if (!previous || previous.id !== message.id) return previous;
                        if (message.type === 'export-start') return { ...previous, name: String(result || previous.name), status: 'saving', total: message.size };
                        if (message.type === 'export-chunk') return { ...previous, downloaded: message.downloaded };
                        return { ...previous, name: String(result || previous.name), status: sharesExports ? 'ready' : 'complete', downloaded: previous.total };
                    });
                    ack(true);
                    // Acknowledge first: the page must not wait while the user is in the share sheet / picker.
                    if (sharesExports && message.type === 'export-finish' && bannerExportId.current === message.id) void presentShare(message.id);
                } catch (error) {
                    const text = error instanceof Error ? error.message : 'Could not save export';
                    void abortExport(message.id);
                    setExportProgress(previous => (previous?.id === message.id ? { ...previous, status: 'failed', error: text } : previous));
                    ack(false, text);
                }
            })();
        }
        return true;
    }, [showExport, presentShare, webViewRef]);

    // Seconds counter shown while Superset generates the file.
    useEffect(() => {
        if (exportProgress?.status !== 'preparing') return;
        setExportElapsed(0);
        const started = Date.now();
        const timer = setInterval(() => setExportElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => clearInterval(timer);
    }, [exportProgress?.id, exportProgress?.status]);

    // One place reports every failed export, whichever step failed.
    useEffect(() => {
        if (exportProgress?.status === 'failed') report('export-failed', exportProgress.error || 'Could not save the export', { source: 'export' });
    }, [exportProgress?.id, exportProgress?.status]);

    // Exports have their own page-side timeouts, but if the page itself is gone (reload, crash) nothing
    // reports back. Fail the banner and delete the partial file once the export has been silent too long.
    useEffect(() => {
        if (exportProgress?.status !== 'preparing' && exportProgress?.status !== 'saving') return;
        const id = exportProgress.id;
        const limit = exportProgress.status === 'preparing' ? PREPARE_SILENCE_MS : TRANSFER_SILENCE_MS;
        // Each phase (preparing, then transferring) gets its own full allowance.
        exportActivityAt.current = Date.now();
        const timer = setInterval(() => {
            if (Date.now() - exportActivityAt.current < limit) return;
            void abortExport(id);
            setExportProgress(previous => (previous?.id === id
                ? { ...previous, status: 'failed', error: 'The export was interrupted. Please try again.' }
                : previous));
        }, 5_000);
        return () => clearInterval(timer);
    }, [exportProgress?.id, exportProgress?.status]);

    // Exported health data must not outlive this screen (country switch, lock, remount).
    useEffect(() => () => { void discardAllExports(); }, []);

    return { exportProgress, exportElapsed, handleExportMessage, dismissExport, presentShare, discardAll, cancelPdfWait };
}
