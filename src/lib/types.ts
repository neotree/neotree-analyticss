export type Country = {
    code: string;
    name: string;
    /** Optional flag image (data: URI embedded at build time, or an https URL). Falls back to the country code badge. */
    flag?: string;
    /** Base URL of the country's Webeditor. */
    webeditorUrl: string;
    /** Analytics-only, read-only key. Recoverable from the APK, so it must never be a privileged key. */
    apiKey?: string;
    /** Landing path opened inside Superset. Owned by the app, never by the Webeditor. */
    landingPath: string;
    /** Extra hosts the WebView may visit (e.g. an SSO provider). The Superset host is always allowed. */
    allowedHosts: string[];
};

/** The Webeditor's /config response. */
export type RemoteConfig = {
    supersetUrl: string;
    inactivityTimeoutMinutes: number;
    versionNumber: number;
};

export type StoredConfig = RemoteConfig & {
    countryCode: string;
    lastCheckedAt: number | null;
    /** Webeditor that supplied this record. Null means a cache row from before source tracking. */
    webeditorUrl: string | null;
};

/** Local, configuration-only cache. It must never hold credentials, cookies, tokens or dashboard data. */
export interface ConfigStore {
    getConfig(countryCode: string): Promise<StoredConfig | null>;
    /** Atomically replaces the country's record (url, timeout and version together). */
    saveConfig(countryCode: string, config: RemoteConfig, checkedAt: number, webeditorUrl: string): Promise<void>;
    touchChecked(countryCode: string, checkedAt: number): Promise<void>;
    getSelectedCountry(): Promise<string | null>;
    setSelectedCountry(countryCode: string | null): Promise<void>;
}
