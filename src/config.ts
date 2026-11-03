import Constants from 'expo-constants';

import { parseCountryRegistry } from './lib/registry';

// Plain http is only tolerated in development builds (e.g. a local Webeditor); release builds are HTTPS-only.
export const ALLOW_INSECURE = __DEV__;

export function loadCountries() {
    const extra = Constants.expoConfig?.extra as { countryRegistry?: unknown; } | undefined;
    return parseCountryRegistry(extra?.countryRegistry, { allowInsecure: ALLOW_INSECURE });
}
