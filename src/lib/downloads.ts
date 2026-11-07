import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type AndroidDownload = {
    id: string;
    name: string;
    status: number;
    downloaded: number;
    total: number;
};

export type ExportMessage =
    | { type: 'export-prepare'; id: string; name: string }
    | { type: 'export-start'; id: string; name: string; mime: string; size: number; sequence: number }
    | { type: 'export-chunk'; id: string; data: string; downloaded: number; sequence: number }
    | { type: 'export-finish'; id: string; sequence: number }
    | { type: 'export-abort'; id: string; name: string; error: string };

type NativeDownloads = {
    listDownloads: () => Promise<AndroidDownload[]>;
    startExport: (id: string, name: string, mime: string, size: number) => Promise<string>;
    appendExport: (id: string, data: string) => Promise<number>;
    finishExport: (id: string) => Promise<string>;
    abortExport: (id: string) => Promise<void>;
};

const native = Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeDownloads>('NeotreeDownloads')
    : null;

export const canTrackDownloads = !!native;

export async function listDownloads(): Promise<AndroidDownload[]> {
    return native ? native.listDownloads() : [];
}

export function parseExportMessage(data: string): ExportMessage | null {
    let value: any;
    try { value = JSON.parse(data); } catch { return null; }
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^export_[A-Za-z0-9_]+$/.test(value.id) || value.id.length > 64) return null;
    if (value.type === 'export-prepare' || value.type === 'export-abort') {
        if (typeof value.name !== 'string' || value.name.length > 128) return null;
        if (value.type === 'export-abort' && (typeof value.error !== 'string' || value.error.length > 300)) return null;
        return value;
    }
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) return null;
    if (value.type === 'export-start') {
        return typeof value.name === 'string' && value.name.length <= 128
            && typeof value.mime === 'string' && value.mime.length <= 100
            && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 100 * 1024 * 1024 ? value : null;
    }
    if (value.type === 'export-chunk') {
        return typeof value.data === 'string' && value.data.length <= 360_000 && /^[A-Za-z0-9+/=]*$/.test(value.data)
            && Number.isSafeInteger(value.downloaded) && value.downloaded >= 0 ? value : null;
    }
    return value.type === 'export-finish' ? value : null;
}

export async function saveExportMessage(message: Extract<ExportMessage, { sequence: number }>): Promise<string | number | void> {
    if (!native || typeof native.startExport !== 'function') throw new Error('Install the updated Android app to save exports');
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
