import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import { bestEffortLogout } from './logout';

type NativeSession = { clearWebSession?: () => Promise<void> };

const native = Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeSession>('NeotreeDownloads')
    : null;

/**
 * Removes this device's WebView cookies and DOM storage (Android). Never throws.
 * iOS needs no call: the `incognito` WebView uses a non-persistent data store that is discarded with it.
 */
export async function clearWebSession(): Promise<void> {
    try {
        if (native && typeof native.clearWebSession === 'function') await native.clearWebSession();
    } catch {
        // The next WebView mount still wipes cookies (`incognito`); never block sign-out on this.
    }
}

/**
 * Sign-out order matters: the server logout runs first because, on Android, React Native's fetch
 * shares the WebView's cookie store, so the request can still carry the Superset session cookie.
 * The local cookies are cleared afterwards, whether or not the server answered.
 */
export async function endWebSession(supersetUrl: string | null | undefined): Promise<void> {
    if (supersetUrl) await bestEffortLogout(supersetUrl);
    await clearWebSession();
}
