import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

/**
 * Brand spinner used for every wait in the app: two counter-rotating arcs on a faint track.
 * Runs on the native driver, so it keeps turning while JS is busy.
 */
export function Spinner({ size = 48, color, track }: { size?: number; color?: string; track?: string; }) {
    const t = useTheme();
    const outer = useRef(new Animated.Value(0)).current;
    const inner = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const a = Animated.loop(Animated.timing(outer, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
        const b = Animated.loop(Animated.timing(inner, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }));
        a.start();
        b.start();
        return () => { a.stop(); b.stop(); };
    }, [outer, inner]);

    const stroke = Math.max(3, Math.round(size / 11));
    const arc = color ?? t.primary;
    const faint = track ?? (t.dark ? '#2C3542' : '#DCE9E2');
    const innerSize = size * 0.62;
    const spin = (v: Animated.Value, reverse = false) => ({
        transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: reverse ? ['360deg', '0deg'] : ['0deg', '360deg'] }) }],
    });

    return (
        <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: stroke, borderColor: faint }]} />
            <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: stroke, borderColor: 'transparent', borderTopColor: arc, borderRightColor: arc }, spin(outer)]} />
            <Animated.View style={[{ width: innerSize, height: innerSize, borderRadius: innerSize / 2, borderWidth: stroke - 1, borderColor: 'transparent', borderBottomColor: arc, opacity: 0.55 }, spin(inner, true)]} />
        </View>
    );
}

/** Spinner with an optional status line, fading in so quick waits do not flash. */
export function SpinnerBlock({ label, size = 56 }: { label?: string; size?: number; }) {
    const t = useTheme();
    const fade = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(fade, { toValue: 1, duration: 220, delay: 80, useNativeDriver: true }).start();
    }, [fade]);
    return (
        <Animated.View style={{ alignItems: 'center', opacity: fade }}>
            <Spinner size={size} />
            {!!label && <Text accessibilityLiveRegion="polite" style={[styles.label, { color: t.muted }]}>{label}</Text>}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    label: { marginTop: 16, fontSize: 15, fontWeight: '500', textAlign: 'center' },
});
