import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import type { ExportMessage } from './exportMessages';

export { parseExportMessage, type ExportMessage } from './exportMessages';

export type AndroidDownload = {
    id: string;
    name: string;
    status: number;
    downloaded: number;
    total: number;
};

type NativeDownloads = {
    startExport: (id: string, name: string, mime: string, size: number) => Promise<string>;
    appendExport: (id: string, data: string) => Promise<number>;
    finishExport: (id: string) => Promise<string>;
    abortExport: (id: string) => Promise<void>;
    /** Android only: this app's DownloadManager entries. */
    listDownloads?: () => Promise<AndroidDownload[]>;
    /** iOS and Android 7-9: finished exports live in a private folder until saved/shared or discarded. */
    shareExport?: (id: string) => Promise<boolean>;
    discardExport?: (id: string) => Promise<void>;
    discardAllExports?: () => Promise<void>;
};

const native = Platform.OS === 'android' || Platform.OS === 'ios'
    ? requireOptionalNativeModule<NativeDownloads>('NeotreeDownloads')
    : null;

export const canTrackDownloads = Platform.OS === 'android' && typeof native?.listDownloads === 'function';

/**
 * True where a finished export is not written to Downloads automatically and the user saves it instead:
 * iOS (share sheet, "Save to Files") and Android 7-9 (system "Save as" picker; no storage permission).
 */
export const sharesExports = typeof native?.shareExport === 'function'
    && (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) < 29));

/** Word for a completed save, matching what the platform's sheet offers. */
export const exportDoneLabel = Platform.OS === 'ios' ? 'shared' : 'saved';

export async function listDownloads(): Promise<AndroidDownload[]> {
    return native?.listDownloads ? native.listDownloads() : [];
}

/** Opens the share sheet (iOS) or "Save as" picker (Android 7-9). Resolves true if the user saved or shared it. */
export async function shareExport(id: string): Promise<boolean> {
    if (!native?.shareExport) throw new Error('Sharing exports is not available on this device');
    return native.shareExport(id);
}

/** Removes a finished or partial export's private file. Never throws. */
export async function discardExport(id: string): Promise<void> {
    try { if (native?.discardExport) await native.discardExport(id); } catch { /* temporary folder is swept on launch */ }
}

/** Removes every export file (and closes the iOS share sheet), e.g. when the session ends. Never throws. */
export async function discardAllExports(): Promise<void> {
    try { if (native?.discardAllExports) await native.discardAllExports(); } catch { /* temporary folder is swept on launch */ }
}

export async function saveExportMessage(message: Extract<ExportMessage, { sequence: number }>): Promise<string | number | void> {
    if (!native || typeof native.startExport !== 'function') throw new Error('Install the latest version of the app to save exports');
    switch (message.type) {
        case 'export-start': return native.startExport(message.id, message.name, message.mime, message.size);
        case 'export-chunk': return native.appendExport(message.id, message.data);
        case 'export-finish': return native.finishExport(message.id);
    }
}

export async function abortExport(id: string): Promise<void> {
    if (native && typeof native.abortExport === 'function') await native.abortExport(id);
}

export function downloadStatus(download: AndroidDownload): 'active' | 'complete' | 'failed' {
    // Android DownloadManager: pending=1, running=2, paused=4, successful=8, failed=16.
    return download.status === 8 ? 'complete' : download.status === 16 ? 'failed' : 'active';
}
