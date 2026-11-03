import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';

import { ErrorView, LoadingCover, LoadingView, PrivacyCover } from '../components/Screens';
import { useConfigSync } from '../hooks/useConfigSync';
import { useInactivity } from '../hooks/useInactivity';
import { buildInjectedScript, isActivityMessage, isAnyPageReadyMessage, pageKey, readBusyLabel, readyPageUrl } from '../lib/injected';
import { bestEffortLogout } from '../lib/logout';
import type { ConfigStore, Country } from '../lib/types';
import { buildLandingUrl, isNavigationAllowed } from '../lib/validation';
import { brand, useTheme } from '../theme';

// react-native-webview's `WebView<P>` class declaration is circular under TypeScript 6, which makes its JSX
// props resolve to `never`. This alias keeps full prop checking through the library's own WebViewProps.
type WebViewHandle = InstanceType<typeof WebView>;
const SupersetWebView = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle>; }>;

type Props = {
    country: Country;
    store: ConfigStore;
    allowInsecure: boolean;
    onSwitchCountry: () => void;
    onLock: () => void;
};

export function AnalyticsScreen({ country, store, allowInsecure, onSwitchCountry, onLock }: Props) {
    const t = useTheme();
    const { state, retry, recheck } = useConfigSync(country, store, allowInsecure);
    const webViewRef = useRef<WebViewHandle>(null);
    const canGoBack = useRef(false);
    const loadingUrl = useRef<string | null>(null);
    const readyPage = useRef<string | null>(null);
    const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [pageError, setPageError] = useState<string | null>(null);
    const [readySource, setReadySource] = useState<string | null>(null);
    const [coverLabel, setCoverLabel] = useState('Loading…');
    const [blockedHost, setBlockedHost] = useState<string | null>(null);

    const config = state.status === 'ready' ? state.config : null;
    const supersetUrl = config?.supersetUrl;
    const pageReady = !!supersetUrl && readySource === supersetUrl;

    const endSession = useCallback(async (then: () => void) => {
        if (supersetUrl) bestEffortLogout(supersetUrl);
        then();
    }, [supersetUrl]);

    const { covered, markActivity } = useInactivity({
        enabled: !!config,
        timeoutMinutes: config?.inactivityTimeoutMinutes ?? 15,
        onTimeout: () => { endSession(onLock); },
    });

    // Check Webeditor each time the app returns to the foreground.
    useEffect(() => {
        if (!config) return;
        const sub = AppState.addEventListener('change', next => {
            if (next === 'active') recheck();
        });
        return () => sub.remove();
    }, [config, recheck]);

    // Android back navigates inside Superset before leaving the app.
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (canGoBack.current) {
                webViewRef.current?.goBack();
                return true;
            }
            return false;
        });
        return () => sub.remove();
    }, []);

    const landingUrl = useMemo(() => (supersetUrl ? buildLandingUrl(supersetUrl, country.landingPath) : null), [supersetUrl, country.landingPath]);

    const injected = useMemo(() => (landingUrl
        ? buildInjectedScript({ landingPathname: new URL(landingUrl).pathname, supersetOrigin: new URL(landingUrl).origin })
        : ''), [landingUrl]);

    useEffect(() => () => {
        if (revealTimer.current) clearTimeout(revealTimer.current);
    }, []);

    // A stalled page load must never leave an opaque spinner over a usable WebView.
    useEffect(() => {
        if (!supersetUrl || pageReady || pageError) return;
        const timer = setTimeout(() => setReadySource(supersetUrl), 15_000);
        return () => clearTimeout(timer);
    }, [supersetUrl, pageReady, pageError]);

    const onMessage = useCallback((e: WebViewMessageEvent) => {
        if (isActivityMessage(e.nativeEvent.data)) markActivity();
        const busy = readBusyLabel(e.nativeEvent.data);
        if (busy) {
            // A form (e.g. sign-in) is being submitted: cover immediately, even though the next page may share
            // this page's path, and say what is happening.
            readyPage.current = null;
            setCoverLabel(busy);
            setReadySource(null);
        }
        if (isAnyPageReadyMessage(e.nativeEvent.data)) {
            readyPage.current = pageKey(readyPageUrl(e.nativeEvent.data));
            setReadySource(supersetUrl ?? null);
            setCoverLabel('Loading…');
        }
    }, [markActivity, supersetUrl]);

    if (state.status === 'loading') return <LoadingView message="Checking Webeditor configuration…" />;

    if (state.status === 'error') {
        return (
            <ErrorView
                title={state.title}
                message={state.message}
                supportCode={state.supportCode}
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
                <Pressable accessibilityRole="button" onPress={() => endSession(onSwitchCountry)} hitSlop={12} style={({ pressed }) => [styles.barChip, { borderColor: t.onPrimary }, pressed && { opacity: 0.7 }]}>
                    <Text style={[styles.barAction, { color: t.onPrimary }]}>Switch country</Text>
                </Pressable>
            </View>

            {!!state.verifyError && (
                <View style={[styles.banner, { backgroundColor: t.danger }]}>
                    <Text accessibilityRole="alert" style={styles.bannerText}>
                        {state.usingSavedConfig ? 'Webeditor unavailable; using saved settings. Superset may still be accessible. ' : 'Configuration check failed: '}
                        {state.verifyError}
                    </Text>
                    <Pressable accessibilityRole="button" onPress={recheck} hitSlop={12}>
                        <Text style={styles.bannerAction}>Retry</Text>
                    </Pressable>
                </View>
            )}

            {!!blockedHost && (
                <View style={[styles.banner, { backgroundColor: brand.navy }]}>
                    <Text style={styles.bannerText} numberOfLines={2}>Blocked navigation to {blockedHost}</Text>
                    <Pressable accessibilityRole="button" onPress={() => setBlockedHost(null)} hitSlop={12}>
                        <Text style={styles.bannerAction}>Dismiss</Text>
                    </Pressable>
                </View>
            )}

            <View style={styles.webWrap}>
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
                            // Every full document load (login, redirects, legacy pages) is covered until the
                            // page reports it has rendered. In-app route changes never reach here, so they
                            // are never covered: Superset shows its own placeholders for those.
                            // A reload of the page already on screen (Superset rewriting the URL after a filter is
                            // applied, a same-page refresh) keeps it visible: covering it would flash a spinner
                            // over content that is already correct.
                            if (pageReady && readyPage.current && pageKey(e.nativeEvent.url) === readyPage.current) return;
                            setReadySource(null);
                        }}
                        onLoadEnd={() => {
                            if (revealTimer.current) clearTimeout(revealTimer.current);
                            // The page's own "ready" signal (after charts settle) lifts the cover. This is only
                            // a backstop for a page whose bridge is blocked, so it is deliberately late.
                            revealTimer.current = setTimeout(() => setReadySource(supersetUrl ?? null), 10_000);
                        }}
                        onNavigationStateChange={(nav: WebViewNavigation) => {
                            canGoBack.current = nav.canGoBack;
                        }}
                        onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => {
                            if (isNavigationAllowed(req.url, supersetUrl!, country.allowedHosts, { allowInsecure })) return true;
                            try { setBlockedHost(new URL(req.url).hostname || req.url); } catch { setBlockedHost('an unknown destination'); }
                            return false;
                        }}
                        onError={() => {
                            if (revealTimer.current) clearTimeout(revealTimer.current);
                            setPageError('Superset is not accessible. Check your connection or try again later.');
                        }}
                        onHttpError={(e: WebViewHttpErrorEvent) => {
                            if (e.nativeEvent.statusCode >= 400) {
                                    if (revealTimer.current) clearTimeout(revealTimer.current);
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
                        textZoom={100}
                        // Pinch zoom for signed-in pages (the login page's viewport forbids it). The on-screen +/- buttons stay hidden.
                        setBuiltInZoomControls
                        setDisplayZoomControls={false}
                    />
                )}

                {!!pageError && (
                    <ErrorView
                        title="Analytics unavailable"
                        message={pageError}
                        actions={[
                            { label: 'Retry', onPress: () => { setReadySource(null); loadingUrl.current = null; setPageError(null); } },
                            { label: 'Switch country', onPress: () => endSession(onSwitchCountry), secondary: true },
                        ]}
                    />
                )}

                {landingUrl && !pageError && !pageReady && <LoadingCover label={coverLabel} />}
            </View>

            {covered && <PrivacyCover />}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 6 },
    barTitle: { fontSize: 15, fontWeight: '700', flex: 1, marginRight: 12 },
    barChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
    barAction: { fontSize: 12, fontWeight: '600' },
    banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    bannerText: { color: '#FFFFFF', fontSize: 13, flex: 1 },
    bannerAction: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
    webWrap: { flex: 1 },
});
