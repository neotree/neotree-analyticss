/** Messages the injected export bridge posts to the app. Pure module so it can be unit-tested in Node. */
export type ExportMessage =
    | { type: 'export-prepare'; id: string; name: string }
    | { type: 'export-start'; id: string; name: string; mime: string; size: number; sequence: number }
    | { type: 'export-chunk'; id: string; data: string; downloaded: number; sequence: number }
    | { type: 'export-finish'; id: string; sequence: number }
    | { type: 'export-abort'; id: string; name: string; error: string };

/** Validates one bridge message; anything unexpected is ignored rather than passed to native code. */
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
