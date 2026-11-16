import { useState } from 'react';
import Constants from 'expo-constants';
import { FlatList, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Logo } from '../components/Screens';
import { Spinner } from '../components/Spinner';
import type { Country } from '../lib/types';
import { useTheme } from '../theme';

// The header artwork is drawn on an 841 x 440 canvas (the design's proportions) and scaled to the screen width.
const ART_W = 841;
const ART_H = 440;
// On a wide portrait screen a width-scaled header would be too tall; cap its height instead.
const MAX_ART_HEIGHT = 300;
// Content column on wide screens (tablets); phones keep their 20 dp side margins.
const MAX_CONTENT_WIDTH = 640;
// Landscape: the brand panel takes this share of the width, within these bounds.
const PANEL_SHARE = 0.4;
const PANEL_MIN = 280;
const PANEL_MAX = 520;
// Landscape list column inside the right pane.
const MAX_LIST_WIDTH = 560;

const appVersion = (() => {
    const version = Constants.expoConfig?.version;
    const build = Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber;
    return version ? `Version ${version}${build ? ` (${build})` : ''}` : null;
})();

/** Portrait: green wave header with the white logo. The wave starts under the status bar, so nothing looks cut off. */
function Header({ topInset }: { topInset: number; }) {
    const { width } = useWindowDimensions();
    const scale = Math.min(width / ART_W, MAX_ART_HEIGHT / ART_H);
    const height = topInset + ART_H * scale;
    // Extra canvas height for the status-bar inset, so the wave's shape never stretches with it.
    const o = topInset / scale;
    const wave = `M0 0 H${ART_W} V${170 + o} C760 ${270 + o} 700 ${345 + o} 600 ${368 + o} C480 ${395 + o} 380 ${320 + o} 250 ${332 + o} C140 ${342 + o} 60 ${385 + o} 0 ${422 + o} Z`;
    const glow = `M${ART_W} ${170 + o} C760 ${270 + o} 700 ${345 + o} 600 ${368 + o} L600 ${ART_H + o} L${ART_W} ${ART_H + o} Z`;
    return (
        <View style={{ width, height }}>
            <Svg width={width} height={height} viewBox={`0 0 ${ART_W} ${ART_H + o}`} preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
                <Defs>
                    <LinearGradient id="wave" x1="1" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#0A5237" />
                        <Stop offset="0.55" stopColor="#12703F" />
                        <Stop offset="1" stopColor="#2B9446" />
                    </LinearGradient>
                    <RadialGradient id="glow" cx="841" cy={200 + o} rx="230" ry="200" gradientUnits="userSpaceOnUse">
                        <Stop offset="0" stopColor="#9BE3AC" stopOpacity="0.95" />
                        <Stop offset="1" stopColor="#9BE3AC" stopOpacity="0" />
                    </RadialGradient>
                </Defs>
                <Rect width={ART_W} height={ART_H + o} fill="transparent" />
                <G>
                    <Path d={glow} fill="url(#glow)" />
                    <Path d={wave} fill="url(#wave)" />
                </G>
            </Svg>
            <View style={[styles.logoWrap, { top: topInset + 14 }]}>
                <Logo size={176} height={96} tint="#FFFFFF" />
            </View>
        </View>
    );
}

/** Landscape: full-height green panel with the same gradient, glow and wave edge as the portrait header. */
function BrandPanel({ width, insets }: { width: number; insets: EdgeInsets; }) {
    const { height } = useWindowDimensions();
    // The right edge is a gentle wave, echoing the portrait header's curve.
    const edge = width - 28;
    const wave = `M0 0 H${width} C${edge} ${height * 0.3} ${width} ${height * 0.55} ${edge} ${height * 0.78} C${edge - 14} ${height * 0.9} ${edge} ${height} ${edge} ${height} H0 Z`;
    return (
        <View style={{ width, height: '100%' }}>
            <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
                <Defs>
                    <LinearGradient id="panel" x1="1" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#0A5237" />
                        <Stop offset="0.55" stopColor="#12703F" />
                        <Stop offset="1" stopColor="#2B9446" />
                    </LinearGradient>
                    <RadialGradient id="panelGlow" cx={width} cy={height * 0.15} rx={width * 0.6} ry={height * 0.45} gradientUnits="userSpaceOnUse">
                        <Stop offset="0" stopColor="#9BE3AC" stopOpacity="0.55" />
                        <Stop offset="1" stopColor="#9BE3AC" stopOpacity="0" />
                    </RadialGradient>
                </Defs>
                <Path d={wave} fill="url(#panel)" />
                <Path d={wave} fill="url(#panelGlow)" />
            </Svg>
            <View
                style={[styles.panelContent, {
                    paddingTop: insets.top + 24,
                    paddingBottom: Math.max(insets.bottom, 16) + 8,
                    paddingLeft: insets.left + 32,
                    paddingRight: 56,
                }]}
            >
                <View style={styles.panelMain}>
                    <Logo size={176} height={96} tint="#FFFFFF" />
                    <Text style={styles.panelTitle} accessibilityRole="header">Neotree Analytics</Text>
                    <Text style={styles.panelSubtitle}>Dashboards and reports for your country</Text>
                </View>
                {!!appVersion && <Text style={styles.panelVersion}>{appVersion}</Text>}
            </View>
        </View>
    );
}

function FlagOrBadge({ country, selected }: { country: Country; selected: boolean; }) {
    const t = useTheme();
    const [failed, setFailed] = useState(false);

    if (country.flag && !failed) {
        return (
            <View style={[styles.flagFrame, { borderColor: t.border }]}>
                <Image source={{ uri: country.flag }} style={styles.flag} resizeMode="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
            </View>
        );
    }
    return (
        <View style={[styles.badge, { borderColor: selected ? t.primary : t.border, backgroundColor: t.surface }]}>
            <Text style={[styles.badgeText, { color: t.text }]}>{country.code}</Text>
        </View>
    );
}

function CountryRow({ country, selected, busy, side, onPress }: {
    country: Country;
    selected: boolean;
    busy: boolean;
    side: number;
    onPress: () => void;
}) {
    const t = useTheme();
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={country.name}
            accessibilityState={{ checked: selected, disabled: busy }}
            disabled={busy}
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                {
                    marginHorizontal: side,
                    backgroundColor: selected ? t.selectedSurface : t.card,
                    borderColor: selected ? t.primary : t.border,
                    borderWidth: selected ? 2 : 1,
                },
                pressed && styles.rowPressed,
            ]}
        >
            <FlagOrBadge country={country} selected={selected} />
            <Text style={[styles.rowLabel, { color: t.text }]}>{country.name}</Text>
            <View style={[styles.radio, selected ? { backgroundColor: t.primary, borderColor: t.primary } : { borderColor: t.radioBorder }]}>
                {selected && <Text style={styles.radioMark}>✓</Text>}
            </View>
        </Pressable>
    );
}

function SectionRow({ count, side, top }: { count: number; side: number; top: number; }) {
    const t = useTheme();
    return (
        <View style={[styles.sectionRow, { paddingHorizontal: side, paddingTop: top }]}>
            <Text style={[styles.section, { color: t.text }]}>Select your country</Text>
            <Text style={[styles.count, { color: t.muted }]}>{count} available</Text>
        </View>
    );
}

function Footer({ selectedCountry, busy, error, side, bottomInset, showVersion, onNext }: {
    selectedCountry: Country | undefined;
    busy: boolean;
    error?: string | null;
    side: number;
    bottomInset: number;
    showVersion: boolean;
    onNext: () => void;
}) {
    const t = useTheme();
    return (
        <View style={[styles.footer, { backgroundColor: t.background, paddingHorizontal: side, paddingBottom: Math.max(bottomInset, 12) + 4 }]}>
            {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: t.danger }]}>{error}</Text>}
            <Text style={[styles.hint, { color: t.muted }]}>
                {selectedCountry ? `Selected: ${selectedCountry.name}` : 'Choose a country to continue'}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !selectedCountry || busy }}
                disabled={!selectedCountry || busy}
                onPress={onNext}
                style={({ pressed }) => [styles.next, { opacity: selectedCountry || busy ? 1 : 0.55 }, pressed && styles.nextPressed]}
            >
                <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
                    <Defs>
                        <LinearGradient id="next" x1="0" y1="0" x2="1" y2="0">
                            <Stop offset="0" stopColor="#2E8B43" />
                            <Stop offset="1" stopColor="#1B7A3A" />
                        </LinearGradient>
                    </Defs>
                    <Rect width="100%" height="100%" fill="url(#next)" />
                </Svg>
                {busy && <Spinner size={22} color="#FFFFFF" track="rgba(255,255,255,.35)" />}
                <Text style={styles.nextLabel}>{busy ? 'Saving…' : 'Next'}</Text>
            </Pressable>
            {showVersion && !!appVersion && <Text style={[styles.version, { color: t.muted }]}>{appVersion}</Text>}
        </View>
    );
}

export function CountrySelectScreen({ countries, onSelect, error, busy = false }: {
    countries: Country[];
    onSelect: (country: Country) => void;
    error?: string | null;
    busy?: boolean;
}) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const [selectedCode, setSelectedCode] = useState<string | null>(null);
    const selectedCountry = countries.find(country => country.code === selectedCode);
    const { width, height } = useWindowDimensions();
    const landscape = width > height;

    const next = () => { if (selectedCountry) onSelect(selectedCountry); };
    const renderRow = (side: number) => ({ item }: { item: Country; }) => (
        <CountryRow country={item} selected={item.code === selectedCode} busy={busy} side={side} onPress={() => setSelectedCode(item.code)} />
    );
    const separator = () => <View style={{ height: 16 }} />;

    if (landscape) {
        const panelWidth = Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width * PANEL_SHARE)));
        const paneWidth = width - panelWidth - insets.right;
        const side = Math.max(24, (paneWidth - MAX_LIST_WIDTH) / 2);
        return (
            <View style={[styles.root, styles.landscape, { backgroundColor: t.background }]}>
                {/* The status-bar icons sit over the list pane on the right, so follow its theme. */}
                <StatusBar style="auto" />
                <BrandPanel width={panelWidth} insets={insets} />
                <View style={[styles.flex, { paddingRight: insets.right }]}>
                    <FlatList
                        data={countries}
                        keyExtractor={c => c.code}
                        ListHeaderComponent={<SectionRow count={countries.length} side={side} top={insets.top + 24} />}
                        contentContainerStyle={styles.list}
                        ItemSeparatorComponent={separator}
                        showsVerticalScrollIndicator={false}
                        style={styles.flex}
                        renderItem={renderRow(side)}
                    />
                    <Footer selectedCountry={selectedCountry} busy={busy} error={error} side={side} bottomInset={insets.bottom} showVersion={false} onNext={next} />
                </View>
            </View>
        );
    }

    const side = Math.max(20, (width - MAX_CONTENT_WIDTH) / 2);
    return (
        <View style={[styles.root, { backgroundColor: t.background }]}>
            <StatusBar style="light" />
            <FlatList
                data={countries}
                keyExtractor={c => c.code}
                ListHeaderComponent={(
                    <View>
                        <Header topInset={insets.top} />
                        <View style={styles.intro}>
                            <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">Neotree Analytics</Text>
                            <Text style={[styles.subtitle, { color: t.muted }]}>Dashboards and reports for your country</Text>
                        </View>
                        <SectionRow count={countries.length} side={side} top={30} />
                    </View>
                )}
                contentContainerStyle={styles.list}
                ItemSeparatorComponent={separator}
                showsVerticalScrollIndicator={false}
                style={styles.flex}
                renderItem={renderRow(side)}
            />
            <Footer selectedCountry={selectedCountry} busy={busy} error={error} side={side} bottomInset={insets.bottom} showVersion onNext={next} />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    landscape: { flexDirection: 'row' },
    flex: { flex: 1 },
    logoWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1 },
    panelContent: { flex: 1, justifyContent: 'space-between' },
    panelMain: { flex: 1, justifyContent: 'center', alignItems: 'flex-start' },
    panelTitle: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', letterSpacing: 0.2, marginTop: 18 },
    panelSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 16, marginTop: 8 },
    panelVersion: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
    intro: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 14 },
    title: { fontSize: 30, fontWeight: '800', letterSpacing: 0.2 },
    subtitle: { fontSize: 16, marginTop: 8, textAlign: 'center' },
    sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 14 },
    section: { fontSize: 19, fontWeight: '800' },
    count: { fontSize: 14 },
    list: { paddingBottom: 20 },
    row: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderRadius: 20, gap: 16,
        elevation: 4, shadowColor: '#0B3B2A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 14,
    },
    rowPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
    flagFrame: { width: 64, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
    flag: { width: '100%', height: '100%' },
    badge: { width: 64, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontWeight: '800', fontSize: 16 },
    rowLabel: { fontSize: 21, fontWeight: '700', flex: 1 },
    radio: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioMark: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', lineHeight: 18 },
    footer: { paddingTop: 10 },
    version: { fontSize: 12, textAlign: 'center', marginTop: 10 },
    error: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
    hint: { fontSize: 15, textAlign: 'center', marginBottom: 14 },
    next: { height: 58, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
    nextPressed: { transform: [{ scale: 0.985 }] },
    nextLabel: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
});
