import { Dimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Same threshold the injected script uses for its tablet layout (CSS px equal dp), so the app and the
 * page always agree on what a tablet is.
 */
export const TABLET_MIN_DP = 600;

/** Uses the physical screen, not the window, so a tablet in split-screen still counts as a tablet. */
export function isTabletScreen(size: { width: number; height: number; } = Dimensions.get('screen')): boolean {
    return Math.min(size.width, size.height) >= TABLET_MIN_DP;
}

/**
 * Tablets rotate freely so wide dashboards can use landscape; phones stay in portrait, where Superset's
 * fitted layout is designed to be read. The app config allows every orientation; this narrows it at launch.
 */
export async function applyOrientationPolicy(): Promise<void> {
    try {
        if (isTabletScreen()) await ScreenOrientation.unlockAsync();
        else await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {
        // Orientation is a comfort feature; never block the app on it.
    }
}
