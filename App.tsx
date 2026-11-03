import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ScreenCapture from 'expo-screen-capture';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ALLOW_INSECURE, loadCountries } from './src/config';
import { openConfigStore } from './src/db/store';
import { ErrorView, LoadingView } from './src/components/Screens';
import type { ConfigStore, Country } from './src/lib/types';
import { AnalyticsScreen } from './src/screens/AnalyticsScreen';
import { CountrySelectScreen } from './src/screens/CountrySelectScreen';

type Boot =
    | { status: 'loading'; }
    | { status: 'error'; message: string; }
    | { status: 'ready'; store: ConfigStore; selected: string | null; };

export default function App() {
    const [boot, setBoot] = useState<Boot>({ status: 'loading' });
    const [bootAttempt, setBootAttempt] = useState(0);
    const [locked, setLocked] = useState(false);
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [savingSelection, setSavingSelection] = useState(false);
    const [captureAttempt, setCaptureAttempt] = useState(0);
    const [captureState, setCaptureState] = useState<{ status: 'checking' | 'ready' | 'error'; message?: string }>({ status: 'checking' });

    const registry = useMemo<{ countries: Country[]; error?: undefined; } | { error: string; countries?: undefined; }>(() => {
        try {
            return { countries: loadCountries() };
        } catch (e) {
            return { error: (e as Error).message };
        }
    }, []);

    // Sensitive health analytics: block screenshots and the recents thumbnail unless explicitly allowed.
    useEffect(() => {
        const allow = (Constants.expoConfig?.extra as { allowScreenCapture?: boolean; } | undefined)?.allowScreenCapture;
        let cancelled = false;
        // On Android the native activity can still be attaching at launch ("current activity is no longer
        // available"), so retry briefly before reporting a failure.
        const withRetry = async (fn: () => Promise<void>) => {
            for (let i = 0; ; i++) {
                try { return await fn(); } catch (e) {
                    if (i >= 5 || cancelled) throw e;
                    await new Promise(r => setTimeout(r, 400 * (i + 1)));
                }
            }
        };
        if (allow) {
            withRetry(() => ScreenCapture.allowScreenCaptureAsync())
                .then(() => { if (!cancelled) setCaptureState({ status: 'ready' }); })
                .catch(e => { if (!cancelled) setCaptureState({ status: 'error', message: `Could not enable screenshots: ${(e as Error)?.message || 'Unknown error'}` }); });
            return () => { cancelled = true; };
        }
        withRetry(() => ScreenCapture.preventScreenCaptureAsync())
            .then(() => { if (!cancelled) setCaptureState({ status: 'ready' }); })
            .catch(e => { if (!cancelled) setCaptureState({ status: 'error', message: `Could not protect this screen: ${(e as Error)?.message || 'Unknown error'}` }); });
        return () => { cancelled = true; };
    }, [captureAttempt]);

    useEffect(() => {
        return () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const store = await openConfigStore();
                const selected = await store.getSelectedCountry();
                if (!cancelled) setBoot({ status: 'ready', store, selected });
            } catch (e) {
                if (!cancelled) setBoot({ status: 'error', message: `The local configuration database could not be opened: ${(e as Error)?.message || 'Unknown error'}` });
            }
        })();
        return () => { cancelled = true; };
    }, [bootAttempt]);

    const select = useCallback(async (country: Country | null) => {
        if (boot.status !== 'ready' || savingSelection) return;
        setSavingSelection(true);
        setSelectionError(null);
        try {
            await boot.store.setSelectedCountry(country?.code ?? null);
            setLocked(false);
            setBoot({ ...boot, selected: country?.code ?? null });
        } catch (e) {
            setSelectionError(`Could not save your country selection: ${(e as Error)?.message || 'Unknown error'}`);
        } finally {
            setSavingSelection(false);
        }
    }, [boot, savingSelection]);

    let content: React.ReactNode;

    if (captureState.status === 'checking') {
        content = <LoadingView message="Protecting screen…" />;
    } else if (captureState.status === 'error') {
        content = <ErrorView title="Screen protection error" message={captureState.message || 'Could not protect this screen.'} actions={[
            { label: 'Retry', onPress: () => { setCaptureState({ status: 'checking' }); setCaptureAttempt(value => value + 1); } },
        ]} />;
    } else if (registry.error !== undefined) {
        content = <ErrorView title="App configuration error" message={registry.error} actions={[]} />;
    } else if (boot.status === 'loading') {
        content = <LoadingView message="Starting…" />;
    } else if (boot.status === 'error') {
        content = <ErrorView title="Something went wrong" message={boot.message} actions={[
            { label: 'Retry', onPress: () => { setBoot({ status: 'loading' }); setBootAttempt(value => value + 1); } },
        ]} />;
    } else {
        const country = registry.countries.find(c => c.code === boot.selected) || null;

        if (!country) {
            content = <CountrySelectScreen countries={registry.countries} onSelect={select} error={selectionError} busy={savingSelection} />;
        } else if (locked) {
            // The WebView is unmounted (not just hidden) while locked.
            content = (
                <ErrorView
                    title="Session locked"
                    message="You were signed out after a period of inactivity. You will need to sign in to Superset again."
                    actions={[
                        { label: 'Continue', onPress: () => setLocked(false) },
                        { label: 'Switch country', onPress: () => select(null), secondary: true },
                    ]}
                />
            );
        } else {
            content = (
                <AnalyticsScreen
                    // Keyed per country so nothing (state, WebView, session) is shared between countries.
                    key={country.code}
                    country={country}
                    store={boot.store}
                    allowInsecure={ALLOW_INSECURE}
                    onSwitchCountry={() => select(null)}
                    onLock={() => setLocked(true)}
                />
            );
        }
    }

    return (
        <SafeAreaProvider>
            <StatusBar style="auto" />
            {content}
            {!!selectionError && boot.status === 'ready' && boot.selected && (
                <View style={styles.errorBanner}>
                    <Text accessibilityRole="alert" style={styles.errorText}>{selectionError}</Text>
                    <Pressable accessibilityRole="button" onPress={() => setSelectionError(null)}>
                        <Text style={styles.dismiss}>Dismiss</Text>
                    </Pressable>
                </View>
            )}
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    errorBanner: { position: 'absolute', left: 12, right: 12, bottom: 20, backgroundColor: '#B3261E', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
    errorText: { color: '#FFFFFF', flex: 1, fontSize: 14 },
    dismiss: { color: '#FFFFFF', fontWeight: '700', textDecorationLine: 'underline' },
});
