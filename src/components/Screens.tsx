import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';
import { SpinnerBlock } from './Spinner';

export function Logo({ size = 140, height = size, tint }: { size?: number; height?: number; tint?: string; }) {
    return <Image source={require('../../assets/logo.png')} style={{ width: size, height, ...(tint ? { tintColor: tint } : null) }} resizeMode="contain" accessibilityLabel="Neotree" />;
}

export function Button({ label, onPress, secondary }: { label: string; onPress: () => void; secondary?: boolean; }) {
    const t = useTheme();
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                secondary
                    ? { borderColor: t.primary, borderWidth: 1.5, backgroundColor: 'transparent' }
                    : { backgroundColor: t.primary },
                pressed && { opacity: 0.8 },
            ]}
        >
            <Text style={[styles.buttonLabel, { color: secondary ? t.primary : t.onPrimary }]}>{label}</Text>
        </Pressable>
    );
}

export function LoadingView({ message }: { message: string; }) {
    const t = useTheme();
    return (
        <View style={[styles.center, { backgroundColor: t.background }]}>
            <Logo />
            <View style={{ marginTop: 32 }}><SpinnerBlock label={message} /></View>
        </View>
    );
}

/** Opaque cover over the WebView while a page loads or a form is processing. */
export function LoadingCover({ label }: { label: string; }) {
    const t = useTheme();
    return (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.background }]}>
            <Logo size={120} height={64} />
            <View style={{ marginTop: 28 }}><SpinnerBlock label={label} /></View>
        </View>
    );
}

export function ErrorView(props: { title: string; message: string; supportCode?: string; panel?: boolean; actions: { label: string; onPress: () => void; secondary?: boolean; }[]; }) {
    const t = useTheme();
    const details = (
        <>
            <Text style={[styles.title, props.panel && styles.panelTitle, { color: t.text }]}>{props.title}</Text>
            <Text style={[styles.message, props.panel && styles.panelMessage, { color: t.muted }]}>{props.message}</Text>
            <View style={styles.actions}>
                {props.actions.map(a => <Button key={a.label} {...a} />)}
            </View>
        </>
    );
    return (
        <View style={[styles.center, props.panel && styles.panelScreen, { backgroundColor: t.background }]}>
            <Logo size={110} height={props.panel ? 60 : undefined} />
            {props.panel
                ? <View style={[styles.panel, { backgroundColor: t.surface, borderColor: t.border }]}>{details}</View>
                : details}
            {!!props.supportCode && <Text style={[styles.supportCode, { color: t.muted }]}>Still having trouble? Contact your support team and mention code {props.supportCode}.</Text>}
        </View>
    );
}

/** Opaque cover used while the app is backgrounded so nothing shows in the recents screen. */
export function PrivacyCover() {
    const t = useTheme();
    return (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.background }]}>
            <Logo />
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    panelScreen: { paddingHorizontal: 20 },
    panel: { alignSelf: 'stretch', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
    panelTitle: { textAlign: 'left', marginTop: 0 },
    panelMessage: { textAlign: 'left' },
    title: { fontSize: 20, fontWeight: '700', marginTop: 20, textAlign: 'center' },
    message: { fontSize: 15, marginTop: 12, textAlign: 'center', lineHeight: 22 },
    supportCode: { fontSize: 12, marginTop: 18, textAlign: 'center', lineHeight: 18 },
    actions: { marginTop: 28, gap: 12, alignSelf: 'stretch' },
    button: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center' },
    buttonLabel: { fontSize: 16, fontWeight: '600' },
});
