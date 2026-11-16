import { Pressable, StyleSheet, Text, View } from 'react-native';

import { downloadStatus, exportDoneLabel, sharesExports, type AndroidDownload } from '../lib/downloads';
import type { ExportProgress } from '../hooks/useExports';
import { PDF_WAIT_NAME } from '../hooks/useExports';
import { useTheme } from '../theme';
import { Spinner } from './Spinner';

function percent(done: number, total: number) {
    return Math.min(100, Math.max(0, done / total * 100));
}

function BannerAction({ label, accessibilityLabel, onPress }: { label: string; accessibilityLabel: string; onPress: () => void; }) {
    const t = useTheme();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={12}>
            <Text style={[styles.action, { color: t.primary }]}>{label}</Text>
        </Pressable>
    );
}

function ProgressTrack({ done, total }: { done: number; total: number; }) {
    const t = useTheme();
    return (
        <View style={[styles.track, { backgroundColor: t.border }]}>
            <View style={[styles.fill, { backgroundColor: t.primary, width: `${percent(done, total)}%` }]} />
        </View>
    );
}

/** Progress of an HTTP download handed to Android's DownloadManager (Android only). */
export function DownloadBanner({ download, onDismiss }: { download: AndroidDownload; onDismiss: () => void; }) {
    const t = useTheme();
    const status = downloadStatus(download);
    const measured = status === 'active' && download.total > 0;
    return (
        <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: t.surface, borderColor: t.border }]}>
            {status === 'active' && <Spinner size={25} />}
            <View style={styles.details}>
                <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>
                    {status === 'complete' ? 'Download complete' : status === 'failed' ? 'Download failed' : 'Downloading…'}
                </Text>
                <Text style={[styles.subtitle, { color: t.muted }]} numberOfLines={2}>
                    {status === 'complete' ? `Saved to Downloads/${download.name}`
                        : status === 'failed' || download.total > 0 ? download.name
                        : `${download.name} · waiting for file size`}
                </Text>
                {measured && <ProgressTrack done={download.downloaded} total={download.total} />}
            </View>
            {measured && <Text style={[styles.percent, { color: t.primary }]}>{Math.round(percent(download.downloaded, download.total))}%</Text>}
            {status !== 'active' && <BannerAction label="Dismiss" accessibilityLabel="Dismiss download notice" onPress={onDismiss} />}
        </View>
    );
}

/** Progress of an export coming through the injected bridge, and its save/share actions. */
export function ExportBanner({ progress, elapsed, onSave, onDismiss, onCancelPdf }: {
    progress: ExportProgress;
    elapsed: number;
    onSave: () => void;
    onDismiss: () => void;
    onCancelPdf: () => void;
}) {
    const t = useTheme();
    const { status, name } = progress;
    const measured = status === 'saving' && progress.total > 0;
    const title = status === 'complete' ? 'Export complete'
        : status === 'ready' ? 'Export ready'
        : status === 'failed' ? 'Export failed'
        : status === 'preparing' ? 'Preparing export…' : 'Saving export…';
    const subtitle = status === 'complete' ? (sharesExports ? `${name} · ${exportDoneLabel}` : `Saved to Downloads/${name}`)
        : status === 'ready' ? `${name} · tap Save to keep a copy`
        : status === 'failed' ? progress.error || 'Could not save the file'
        : measured ? name : `${name} · ${elapsed}s`;
    return (
        <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: t.surface, borderColor: t.border }]}>
            {(status === 'preparing' || status === 'saving') && <Spinner size={25} />}
            <View style={styles.details}>
                <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{title}</Text>
                <Text style={[styles.subtitle, { color: t.muted }]} numberOfLines={2}>{subtitle}</Text>
                {measured && <ProgressTrack done={progress.downloaded} total={progress.total} />}
            </View>
            {measured && <Text style={[styles.percent, { color: t.primary }]}>{Math.round(percent(progress.downloaded, progress.total))}%</Text>}
            {sharesExports && (status === 'ready' || status === 'complete') && (
                <BannerAction label="Save…" accessibilityLabel={`Save or share ${name}`} onPress={onSave} />
            )}
            {(status === 'complete' || status === 'ready' || status === 'failed') && (
                <BannerAction label="Dismiss" accessibilityLabel="Dismiss export notice" onPress={onDismiss} />
            )}
            {status === 'preparing' && name === PDF_WAIT_NAME && (
                <BannerAction label="Cancel" accessibilityLabel="Cancel PDF export" onPress={onCancelPdf} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    banner: { borderBottomWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
    details: { flex: 1 },
    title: { fontSize: 14, fontWeight: '700' },
    subtitle: { fontSize: 12, marginTop: 2 },
    track: { height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
    fill: { height: 4, borderRadius: 2 },
    action: { fontSize: 12, fontWeight: '700' },
    percent: { fontSize: 16, fontWeight: '800', minWidth: 44, textAlign: 'right' },
});
