import * as SQLite from 'expo-sqlite';

import type { ConfigStore, RemoteConfig, StoredConfig } from '../lib/types';

/**
 * Configuration-only cache: one row per country plus the selected country. Nothing sensitive is
 * ever written here - no usernames, passwords, cookies, tokens, API keys or dashboard data.
 */
export async function openConfigStore(): Promise<ConfigStore> {
    const db = await SQLite.openDatabaseAsync('neotree-analytics.db');

    await db.execAsync(`
        CREATE TABLE IF NOT EXISTS country_config (
            country_code TEXT PRIMARY KEY NOT NULL,
            superset_url TEXT NOT NULL,
            inactivity_timeout_minutes INTEGER NOT NULL,
            version_number INTEGER NOT NULL,
            last_checked_at INTEGER,
            webeditor_url TEXT
        );
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT
        );
    `);

    // Existing installs have the original table without source tracking.
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(country_config)');
    if (!columns.some(column => column.name === 'webeditor_url')) {
        await db.execAsync('ALTER TABLE country_config ADD COLUMN webeditor_url TEXT');
    }

    return {
        async getConfig(countryCode) {
            const row = await db.getFirstAsync<{
                country_code: string;
                superset_url: string;
                inactivity_timeout_minutes: number;
                version_number: number;
                last_checked_at: number | null;
                webeditor_url: string | null;
            }>('SELECT * FROM country_config WHERE country_code = ?', countryCode);

            if (!row) return null;

            const config: StoredConfig = {
                countryCode: row.country_code,
                supersetUrl: row.superset_url,
                inactivityTimeoutMinutes: row.inactivity_timeout_minutes,
                versionNumber: row.version_number,
                lastCheckedAt: row.last_checked_at,
                webeditorUrl: row.webeditor_url,
            };
            return config;
        },

        async saveConfig(countryCode: string, config: RemoteConfig, checkedAt: number, webeditorUrl: string) {
            // One transaction: url, timeout and version are committed together or not at all.
            await db.withExclusiveTransactionAsync(async txn => {
                await txn.runAsync(
                    `INSERT INTO country_config (country_code, superset_url, inactivity_timeout_minutes, version_number, last_checked_at, webeditor_url)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(country_code) DO UPDATE SET
                        superset_url = excluded.superset_url,
                        inactivity_timeout_minutes = excluded.inactivity_timeout_minutes,
                        version_number = excluded.version_number,
                        last_checked_at = excluded.last_checked_at,
                        webeditor_url = excluded.webeditor_url`,
                    countryCode, config.supersetUrl, config.inactivityTimeoutMinutes, config.versionNumber, checkedAt, webeditorUrl,
                );
            });
        },

        async touchChecked(countryCode, checkedAt) {
            await db.runAsync('UPDATE country_config SET last_checked_at = ? WHERE country_code = ?', checkedAt, countryCode);
        },

        async getSelectedCountry() {
            const row = await db.getFirstAsync<{ value: string | null; }>('SELECT value FROM app_state WHERE key = ?', 'selected_country');
            return row?.value || null;
        },

        async setSelectedCountry(countryCode) {
            if (countryCode === null) {
                await db.runAsync('DELETE FROM app_state WHERE key = ?', 'selected_country');
            } else {
                await db.runAsync(
                    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                    'selected_country', countryCode,
                );
            }
        },
    };
}
