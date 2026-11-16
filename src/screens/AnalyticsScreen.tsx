import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Modal, Pressable, StyleSheet, Text, ToastAndroid, useWindowDimensions, View } from 'react-native';
import { useNetworkState } from 'expo-network';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';

import { ErrorView, LoadingCover, LoadingView, PrivacyCover } from '../components/Screens';
import { DownloadBanner, ExportBanner } from '../components/TransferBanners';
import { useConfigSync } from '../hooks/useConfigSync';
import { useDownloadTracker } from '../hooks/useDownloadTracker';
import { useExports } from '../hooks/useExports';
import { useInactivity } from '../hooks/useInactivity';
import { buildInjectedScript, isActivityMessage, isAnyPageReadyMessage, isFilterAppliedMessage, pageKey, pageKindFromUrl, readBusyLabel, readPageContext, readReadOnlyAddKind, readyPageUrl, shouldKeepDashboardVisible, type AnalyticsPageKind } from '../lib/injected';
import type { ConfigStore, Country } from '../lib/types';
import { report } from '../lib/telemetry';
import { buildLandingUrl, isAuthoringDestination, isNavigationAllowed } from '../lib/validation';
import { endWebSession } from '../lib/webSession';
import { brand, useTheme } from '../theme';

// react-native-webview's `WebView<P>` class declaration is circular under TypeScript 6, which makes its JSX
// props resolve to `never`. This alias keeps full prop checking through the library's own WebViewProps.
type WebViewHandle = InstanceType<typeof WebView>;
const SupersetWebView = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle>; }>;

const MAX_TEXT_ZOOM = 1.3;
type Props = {
    country: Country;
    store: ConfigStore;
    allowInsecure: boolean;
    /** Resolves true once the app has left this screen, false if the switch could not be saved. */
    onSwitchCountry: () => boolean | Promise<boolean>;
    onLock: () => boolean;
};

export function AnalyticsScreen({ country, store, allowInsecure, onSwitchCountry, onLock }: Props) {
    const t = useTheme();
    const { fontScale } = useWindowDimensions();
    // Follow the system font size inside Superset, capped so its fitted desktop layout does not break.
    const textZoom = Math.round(Math.min(Math.max(fontScale, 1), MAX_TEXT_ZOOM) * 100);
    const [loadedAt, setLoadedAt] = useState<number | null>(null);
    const lastBackPress = useRef(0);
    const network = useNetworkState();
    const offline = network.isConnected === false || network.isInternetReachable === false;
    const wasOffline = useRef(false);
    const { state, retry, refresh, recheck } = useConfigSync(country, store, allowInsecure);
    const webViewRef = useRef<WebViewHandle>(null);
    const { download, dismissDownload, kickDownloadPolling } = useDownloadTracker();
    const { exportProgress, exportElapsed, handleExportMessage, dismissExport, presentShare, discardAll, cancelPdfWait } = useExports(webViewRef);
    const canGoBack = useRef(false);
    const loadingUrl = useRef<string | null>(null);
    const readyPage = useRef<string | null>(null);
    const filterAppliedAt = useRef(0);
    const readOnlyAlertAt = useRef(0);
    const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [pageError, setPageError] = useState<string | null>(null);
    const [readySource, setReadySource] = useState<string | null>(null);
    const [coverLabel, setCoverLabel] = useState('Loading…');
    const [reportedPage, setReportedPage] = useState<{ kind: AnalyticsPageKind; url: string } | null>(null);
    const [blockedHost, setBlockedHost] = useState<string | null>(null);
    const [readOnlyDialog, setReadOnlyDialog] = useState<'Chart' | 'Dashboard' | null>(null);
    const endingSession = useRef(false);
    const [signingOut, setSigningOut] = useState(false);

    const config = state.status === 'ready' ? state.config : null;
    const supersetUrl = config?.supersetUrl;
    const pageReady = !!supersetUrl && readySource === supersetUrl;
    const filterResultVisible = reportedPage?.kind === 'dashboard' && Date.now() - filterAppliedAt.current < 60_000;
    const explainReadOnly = useCallback((kind: 'Chart' | 'Dashboard') => {
        if (Date.now() - readOnlyAlertAt.current < 1200) return;
        readOnlyAlertAt.current = Date.now();
        setReadOnlyDialog(kind);
    }, []);

    const currentPageKind = reportedPage?.kind ?? pageKindFromUrl(
        loadingUrl.current ?? (supersetUrl ? buildLandingUrl(supersetUrl, country.landingPath) : null),
        country.landingPath,
    );
    const lastUpdated = loadedAt ? ` Last updated ${new Date(loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
    const offlineNotice = currentPageKind === 'sign-in'
        ? 'No internet connection. Connect to Wi-Fi or mobile data to sign in.'
        : currentPageKind === 'dashboard'
            ? `No internet connection. This dashboard may be out of date. It will stay open while you reconnect.${lastUpdated}`
            : `No internet connection. This page may be out of date. Reconnect to load new information.${lastUpdated}`;
    const offlinePageTitle = currentPageKind === 'sign-in' ? 'Sign-in unavailable offline'
        : currentPageKind === 'dashboard' ? 'Dashboard unavailable offline' : 'Analytics unavailable offline';
    const offlinePageMessage = currentPageKind === 'sign-in'
        ? 'Connect to Wi-Fi or mobile data, then try signing in again.'
        : currentPageKind === 'dashboard'
            ? 'Connect to Wi-Fi or mobile data. The dashboard will retry when your connection returns.'
            : 'Connect to Wi-Fi or mobile data. This page will retry when your connection returns.';

    // Restore only a page that failed while offline. Keep an already visible
    // dashboard in place so reconnecting does not discard its filter state.
    useEffect(() => {
        if (offline) {
            wasOffline.current = true;
            return;
        }
        if (!wasOffline.current || (network.isConnected !== true && network.isInternetReachable !== true)) return;
        // An in-flight Webeditor request may still finish with its offline error.
        // Retry after it settles so the reconnect is not lost to deduplication.
        if (state.status === 'loading') return;
        wasOffline.current = false;
        if (state.status === 'error') void retry();
        else if (state.status === 'ready') {
            if (pageError) {
                setReadySource(null);
                setPageError(null);
            } else if (!pageReady) webViewRef.current?.reload();
            void refresh();
        }
    }, [offline, network.isConnected, network.isInternetReachable, state.status, pageError, pageReady, retry, refresh]);

    // Unmount the WebView at once (the "Signing out…" view replaces it), then end the session before
    // leaving. `then` reports whether the app moved on; if it did not (e.g. the country selection
    // could not be saved), this screen returns to a fresh sign-in page instead of a stuck spinner.
    const endSession = useCallback(async (then: () => boolean | Promise<boolean>) => {
        if (endingSession.current) return;
        endingSession.current = true;
        setSigningOut(true);
        let left = false;
        try {
            await discardAll();
            await endWebSession(supersetUrl);
            left = await then();
        } finally {
            if (!left) {
                endingSession.current = false;
                setReadySource(null);
                setSigningOut(false);
            }
        }
    }, [supersetUrl, discardAll]);

    const { covered, markActivity } = useInactivity({
        enabled: !!config,
        timeoutMinutes: config?.inactivityTimeoutMinutes ?? 15,
        onTimeout: () => { endSession(onLock); },
    });

    // Top-bar Reload: re-mounts the page after an error, otherwise reloads it in place (Superset keeps
    // the dashboard's filters in its URL).
    const reloadPage = useCallback(() => {
        markActivity();
        if (pageError) {
            setReadySource(null);
            loadingUrl.current = null;
            setPageError(null);
        } else {
            webViewRef.current?.reload();
        }
    }, [pageError, markActivity]);

    // Check Webeditor each time the app returns to the foreground.
    useEffect(() => {
        if (!config) return;
        const sub = AppState.addEventListener('change', next => {
            if (next === 'active') recheck();
        });
        return () => sub.remove();
    }, [config, recheck]);

    // Android back navigates inside Superset first; at the first page, a second press within 2 s leaves the app.
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (canGoBack.current) {
                webViewRef.current?.goBack();
                return true;
            }
            if (Date.now() - lastBackPress.current < 2_000) return false;
            lastBackPress.current = Date.now();
            ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
            return true;
        });
        return () => sub.remove();
    }, []);

    const landingUrl = useMemo(() => (supersetUrl ? buildLandingUrl(supersetUrl, country.landingPath) : null), [supersetUrl, country.landingPath]);

    const injected = useMemo(() => (landingUrl
        ? buildInjectedScript({ landingPathname: new URL(landingUrl).pathname, supersetOrigin: new URL(landingUrl).origin })
        : ''), [landingUrl]);

    useEffect(() => { setReportedPage(null); }, [landingUrl]);

    useEffect(() => () => {
        if (revealTimer.current) clearTimeout(revealTimer.current);
    }, []);

    // A stalled page load must never leave an opaque spinner over a usable WebView.
    useEffect(() => {
        if (!supersetUrl || pageReady || pageError || offline) return;
        const timer = setTimeout(() => setReadySource(supersetUrl), 15_000);
        return () => clearTimeout(timer);
    }, [supersetUrl, pageReady, pageError, offline]);

    const onMessage = useCallback((e: WebViewMessageEvent) => {
        if (handleExportMessage(e.nativeEvent.data)) return;
        if (isActivityMessage(e.nativeEvent.data)) {
            markActivity();
            kickDownloadPolling();
        }
        if (isFilterAppliedMessage(e.nativeEvent.data)) filterAppliedAt.current = Date.now();
        const readOnlyKind = readReadOnlyAddKind(e.nativeEvent.data);
        if (readOnlyKind) explainReadOnly(readOnlyKind);
        const context = readPageContext(e.nativeEvent.data);
        if (context) setReportedPage(context);
        const busy = readBusyLabel(e.nativeEvent.data);
        if (busy && !(pageReady && (shouldKeepDashboardVisible(readyPage.current, e.nativeEvent.url)
            || (Date.now() - filterAppliedAt.current < 60_000 && pageKindFromUrl(e.nativeEvent.url, country.landingPath) === 'dashboard')))) {
            // A form (e.g. sign-in) is being submitted: cover immediately, even though the next page may share
            // this page's path, and say what is happening.
            readyPage.current = null;
            setCoverLabel(busy);
            setReadySource(null);
        }
        if (isAnyPageReadyMessage(e.nativeEvent.data)) {
            setLoadedAt(Date.now());
            readyPage.current = pageKey(readyPageUrl(e.nativeEvent.data));
            setReadySource(supersetUrl ?? null);
            setCoverLabel('Loading…');
        }
    }, [markActivity, supersetUrl, pageReady, explainReadOnly, country.landingPath, handleExportMessage, kickDownloadPolling]);

    if (signingOut) return <LoadingView message="Signing out…" />;

    if (state.status === 'loading') return offline
        ? <ErrorView title="You're offline" message="Connect to Wi-Fi or mobile data. The app will try again when your connection returns." panel actions={[{ label: 'Try again', onPress: retry }, { label: 'Switch country', onPress: onSwitchCountry, secondary: true }]} />
        : <LoadingView message="Checking Webeditor configuration…" />;

    if (state.status === 'error') {
        return (
            <ErrorView
                title={offline ? "You're offline" : state.title}
                message={offline ? 'Connect to Wi-Fi or mobile data. The app will try again when your connection returns.' : state.message}
                supportCode={offline ? undefined : state.supportCode}
                panel
                actions={[
                    { label: 'Try again', onPress: retry },
                    { label: 'Switch country', onPress: onSwitchCountry, secondary: true },
                ]}
            />
        );
    }

    return (
        <SafeAreaView edges={['top', 'bottom']} style={[styles.root, { backgroundColor: t.background }]}>
            <View style={[styles.bar, { backgroundColor: t.primary }]}>
                <Text style={[styles.barTitle, { color: t.onPrimary }]} numberOfLines={1}>{country.name}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reload page"
                    onPress={reloadPage}
                    hitSlop={12}
                    style={({ pressed }) => [styles.barChip, styles.barChipSpacing, { borderColor: t.onPrimary }, pressed && { opacity: 0.7 }]}
                >
                    <Text style={[styles.barAction, { color: t.onPrimary }]}>Reload</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => endSession(onSwitchCountry)} hitSlop={12} style={({ pressed }) => [styles.barChip, { borderColor: t.onPrimary }, pressed && { opacity: 0.7 }]}>
                    <Text style={[styles.barAction, { color: t.onPrimary }]}>Switch country</Text>
                </Pressable>
            </View>

            {offline && !pageError && pageReady && (
                <View style={[styles.offlineBanner, { backgroundColor: t.warningSurface }]}>
                    <Text accessibilityRole="alert" style={[styles.offlineText, { color: t.onWarning }]}>
                        {offlineNotice}
                    </Text>
                </View>
            )}

            {!!state.verifyError && !offline && (
                <View style={[styles.banner, { backgroundColor: t.danger }]}>
                    <Text accessibilityRole="alert" style={styles.bannerText}>
                        {state.usingSavedConfig ? 'Webeditor unavailable; using saved settings. Superset may still be accessible. ' : 'Configuration check failed: '}
                        {state.verifyError}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Retry configuration check" onPress={refresh} hitSlop={12}>
                        <Text style={styles.bannerAction}>Retry</Text>
                    </Pressable>
                </View>
            )}

            {!!blockedHost && (
                <View style={[styles.banner, { backgroundColor: brand.navy }]}>
                    <Text style={styles.bannerText} numberOfLines={2}>Blocked navigation to {blockedHost}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss blocked navigation notice" onPress={() => setBlockedHost(null)} hitSlop={12}>
                        <Text style={styles.bannerAction}>Dismiss</Text>
                    </Pressable>
                </View>
            )}

            {!!download && <DownloadBanner download={download} onDismiss={dismissDownload} />}

            {!!exportProgress && (
                <ExportBanner
                    progress={exportProgress}
                    elapsed={exportElapsed}
                    onSave={() => void presentShare(exportProgress.id)}
                    onDismiss={dismissExport}
                    onCancelPdf={cancelPdfWait}
                />
            )}

            <View style={[styles.webWrap, currentPageKind !== 'sign-in' && styles.webSpacing]}>
                {landingUrl && !pageError && (
                    <SupersetWebView
                        // New URL => remount (full reload). A changed timeout or version does not reload.
                        key={supersetUrl}
                        ref={webViewRef}
                        source={{ uri: landingUrl }}
                        injectedJavaScript={injected}
                        injectedJavaScriptBeforeContentLoaded={injected}
                        // Required on Android: without it (useWideViewPort) the page's viewport meta is ignored and Superset
                        // lays out at phone width (stacked menu, clipped content).
                        scalesPageToFit
                        scrollEnabled
                        onMessage={onMessage}
                        onLoadStart={e => {
                            loadingUrl.current = e.nativeEvent.url;
                            if (pageKindFromUrl(e.nativeEvent.url, country.landingPath) !== 'dashboard') filterAppliedAt.current = 0;
                            // Every full document load (login, redirects, legacy pages) is covered until the
                            // page reports it has rendered. In-app route changes never reach here, so they
                            // are never covered: Superset shows its own placeholders for those.
                            // A reload of the page already on screen (Superset rewriting the URL after a filter is
                            // applied, a same-page refresh) keeps it visible: covering it would flash a spinner
                            // over content that is already correct.
                            if (pageReady && (
                                (reportedPage?.kind === 'dashboard' && Date.now() - filterAppliedAt.current < 60_000)
                                || (readyPage.current && (pageKey(e.nativeEvent.url) === readyPage.current
                                    || shouldKeepDashboardVisible(readyPage.current, e.nativeEvent.url)))
                                || (reportedPage?.kind === 'dashboard' && pageKindFromUrl(e.nativeEvent.url, country.landingPath) === 'dashboard')
                            )) return;
                            setReadySource(null);
                        }}
                        onLoadEnd={() => {
                            if (revealTimer.current) clearTimeout(revealTimer.current);
                            // The page's own "ready" signal (after charts settle) lifts the cover. This is only
                            // a backstop for a page whose bridge is blocked, so it is deliberately late.
                            if (!offline) revealTimer.current = setTimeout(() => setReadySource(supersetUrl ?? null), 10_000);
                        }}
                        // iOS only: an attachment response (e.g. CSV) is cancelled by the WebView and reported here.
                        // Re-fetch it inside the page, with its session, and save it through the export bridge.
                        onFileDownload={e => {
                            webViewRef.current?.injectJavaScript(`window.__ntTransferExport && window.__ntTransferExport(${JSON.stringify(e.nativeEvent.downloadUrl)});true;`);
                        }}
                        onNavigationStateChange={(nav: WebViewNavigation) => {
                            canGoBack.current = nav.canGoBack;
                        }}
                        onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => {
                            if (currentPageKind === 'dashboard' && /\/explore\/?(?:[?#]|$)/i.test(req.url)) return false;
                            if (isAuthoringDestination(req.url, supersetUrl!)) {
                                if (/\/chart\/add(?:\/|$)/i.test(new URL(req.url).pathname)) explainReadOnly('Chart');
                                else if (/\/dashboard\/new(?:\/|$)/i.test(new URL(req.url).pathname)) explainReadOnly('Dashboard');
                                return false;
                            }
                            if (isNavigationAllowed(req.url, supersetUrl!, country.allowedHosts, { allowInsecure })) {
                                // A link may turn out to be a file download handed to DownloadManager.
                                kickDownloadPolling();
                                return true;
                            }
                            let host = 'an unknown destination';
                            try { host = new URL(req.url).hostname || host; } catch { /* keep the generic label */ }
                            setBlockedHost(host);
                            report('navigation-blocked', 'Navigation outside the approved hosts', { host });
                            return false;
                        }}
                        onError={() => {
                            if (revealTimer.current) clearTimeout(revealTimer.current);
                            if (offline && pageReady) return;
                            if (!offline) report('page-error', 'Superset page failed to load', { network: true });
                            setPageError('Superset is not accessible. Check your connection or try again later.');
                        }}
                        onHttpError={(e: WebViewHttpErrorEvent) => {
                            if (e.nativeEvent.statusCode >= 400) {
                                if (revealTimer.current) clearTimeout(revealTimer.current);
                                report('page-error', `Superset returned HTTP ${e.nativeEvent.statusCode}`, { status: e.nativeEvent.statusCode });
                                setPageError(`Superset returned HTTP ${e.nativeEvent.statusCode}. Please try again or contact your administrator.`);
                            }
                        }}
                        originWhitelist={allowInsecure ? ['https://*', 'http://*'] : ['https://*']}
                        javaScriptEnabled
                        domStorageEnabled
                        // Android: wipes cookies, cache, history and saved form data every time this WebView
                        // mounts, so a session never carries over a timeout, restart or country switch.
                        incognito
                        cacheEnabled={false}
                        thirdPartyCookiesEnabled={false}
                        setSupportMultipleWindows={false}
                        allowFileAccess={false}
                        allowsLinkPreview={false}
                        mixedContentMode="never"
                        webviewDebuggingEnabled={false}
                        textZoom={textZoom}
                        // Allow deliberate pinch zoom; the page CSS keeps small filter fields readable.
                        setBuiltInZoomControls
                        setDisplayZoomControls={false}
                    />
                )}

                {!!pageError && (
                    <ErrorView
                        title={offline ? offlinePageTitle : 'Analytics unavailable'}
                        message={offline ? offlinePageMessage : pageError}
                        actions={[
                            { label: 'Retry', onPress: () => { setReadySource(null); loadingUrl.current = null; setPageError(null); } },
                            { label: 'Switch country', onPress: () => endSession(onSwitchCountry), secondary: true },
                        ]}
                    />
                )}

                {landingUrl && !pageError && !pageReady && !filterResultVisible && (offline
                    ? <View style={StyleSheet.absoluteFill}>
                        <ErrorView
                            title={offlinePageTitle}
                            message={offlinePageMessage}
                            actions={[{ label: 'Try again', onPress: () => webViewRef.current?.reload() }]}
                        />
                    </View>
                    : <LoadingCover label={coverLabel} />)}
            </View>

            {covered && <PrivacyCover />}
            <Modal visible={!!readOnlyDialog} transparent animationType="fade" onRequestClose={() => setReadOnlyDialog(null)}>
                <View style={styles.dialogBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setReadOnlyDialog(null)} accessibilityLabel="Close notice" />
                    <View style={[styles.dialogCard, { backgroundColor: t.surface }]}>
                        <View style={[styles.dialogIcon, { backgroundColor: t.primarySoft }]}>
                            <Text style={[styles.dialogIconText, { color: t.primary }]}>i</Text>
                        </View>
                        <Text style={[styles.dialogTitle, { color: t.text }]}>View only on mobile</Text>
                        <Text style={[styles.dialogMessage, { color: t.muted }]}>
                            {readOnlyDialog === 'Chart'
                                ? 'You can view charts here. To add a chart, open Superset on a computer.'
                                : 'You can view dashboards here. To add a dashboard, open Superset on a computer.'}
                        </Text>
                        <Pressable accessibilityRole="button" onPress={() => setReadOnlyDialog(null)} style={[styles.dialogButton, { backgroundColor: t.primary }]}>
                            <Text style={[styles.dialogButtonText, { color: t.onPrimary }]}>Got it</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 6 },
    barTitle: { fontSize: 15, fontWeight: '700', flex: 1, marginRight: 12 },
    barChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
    barChipSpacing: { marginRight: 8 },
    barAction: { fontSize: 12, fontWeight: '600' },
    banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    bannerText: { color: '#FFFFFF', fontSize: 13, flex: 1 },
    bannerAction: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
    offlineBanner: { paddingHorizontal: 16, paddingVertical: 10 },
    offlineText: { fontSize: 13, lineHeight: 18 },
    webWrap: { flex: 1 },
    webSpacing: { marginTop: 12 },
    dialogBackdrop: { flex: 1, backgroundColor: 'rgba(20, 38, 30, .45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    dialogCard: { width: '100%', maxWidth: 380, borderRadius: 20, padding: 24, alignItems: 'center', elevation: 8 },
    dialogIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    dialogIconText: { fontSize: 23, fontWeight: '700' },
    dialogTitle: { fontSize: 19, fontWeight: '700', textAlign: 'center' },
    dialogMessage: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, marginBottom: 22 },
    dialogButton: { minHeight: 46, width: '100%', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    dialogButtonText: { fontSize: 15, fontWeight: '700' },
});
