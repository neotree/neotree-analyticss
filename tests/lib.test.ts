import assert from 'node:assert/strict';
import vm from 'node:vm';

import { createRemoteApi } from '../src/lib/api';
import { parseExportMessage } from '../src/lib/exportMessages';
import { createReporter, parseTelemetryUrl, scrubText, type TelemetryEvent } from '../src/lib/telemetryCore';
import { buildInjectedScript, isActivityMessage, isAnyPageReadyMessage, isFilterAppliedMessage, isPageReadyMessage, pageKey, pageKindFromUrl, readBusyLabel, readPageContext, readReadOnlyAddKind, readyPageUrl, shouldKeepDashboardVisible } from '../src/lib/injected';
import { parseCountryRegistry } from '../src/lib/registry';
import { resolveConfig, SyncError } from '../src/lib/sync';
import type { Country, StoredConfig } from '../src/lib/types';
import { buildLandingUrl, hostMatches, isAuthoringDestination, isNavigationAllowed, validateRemoteConfig } from '../src/lib/validation';

const strict = { allowInsecure: false };
const country: Country = { code: 'ZW', name: 'Zimbabwe', webeditorUrl: 'https://we.example.org', apiKey: 'k', landingPath: '/login/', allowedHosts: ['*.example.org'] };
const good = { supersetUrl: 'https://ss.example.org/', inactivityTimeoutMinutes: 15, versionNumber: 3 };

async function main() {
    // --- registry
    const reg = parseCountryRegistry({ countries: [{ code: 'zw', name: 'Zimbabwe', webeditorUrl: 'https://we.example.org/', allowedHosts: ['*.Example.org'] }] }, strict);
    assert.equal(reg[0].code, 'ZW');
    assert.equal(reg[0].webeditorUrl, 'https://we.example.org');
    assert.equal(reg[0].landingPath, '/login/');
    assert.deepEqual(reg[0].allowedHosts, ['*.example.org']);
    {
        const base = { code: 'zw', name: 'Zimbabwe', webeditorUrl: 'https://we.example.org', allowedHosts: ['ss.example.org'] };
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        assert.equal(parseCountryRegistry({ countries: [{ ...base, flag: png }] }, strict)[0].flag, png);
        assert.equal(parseCountryRegistry({ countries: [{ ...base, flag: 'https://cdn.example.org/zw.png' }] }, strict)[0].flag, 'https://cdn.example.org/zw.png');
        assert.equal(parseCountryRegistry({ countries: [base] }, strict)[0].flag, undefined, 'flag is optional');
        for (const bad of ['http://x.org/zw.png', 'assets/flags/zw.png', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 42]) {
            assert.throws(() => parseCountryRegistry({ countries: [{ ...base, flag: bad }] }, strict), /flag must be/);
        }
    }
    assert.throws(() => parseCountryRegistry({ countries: [] }, strict));
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'http://x.org', allowedHosts: ['x.org'] }] }, strict), /HTTPS/);
    assert.doesNotThrow(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'http://10.0.2.2:3000', allowedHosts: ['x.org'] }] }, { allowInsecure: true }));
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://u:p@x.org', allowedHosts: ['x.org'] }] }, strict), /credentials/);
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', allowedHosts: ['x.org'] }, { code: 'a', name: 'B', webeditorUrl: 'https://y.org', allowedHosts: ['x.org'] }] }, strict), /duplicated/);
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', landingPath: '//evil.org', allowedHosts: ['x.org'] }] }, strict));
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', allowedHosts: ['bad host'] }] }, strict));
    for (const hosts of [undefined, [], 'ss.example.org']) {
        assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', allowedHosts: hosts }] }, strict), /allowedHosts must list/, String(hosts));
    }

    // --- config validation
    const ok = validateRemoteConfig(good, country, strict);
    assert.ok(ok.ok && ok.value.supersetUrl === 'https://ss.example.org');
    for (const bad of [
        { ...good, supersetUrl: 'http://ss.example.org' },
        { ...good, supersetUrl: 'https://u:p@ss.example.org' },
        { ...good, supersetUrl: 'nope' },
        { ...good, inactivityTimeoutMinutes: 0 },
        { ...good, inactivityTimeoutMinutes: 1441 },
        { ...good, inactivityTimeoutMinutes: 1.5 },
        { ...good, versionNumber: 0 },
        { ...good, versionNumber: '3' },
        null,
    ]) assert.equal(validateRemoteConfig(bad, country, strict).ok, false, JSON.stringify(bad));
    assert.equal(validateRemoteConfig({ ...good, supersetUrl: 'http://ss.example.org' }, country, { allowInsecure: true }).ok, true);
    assert.equal(validateRemoteConfig(good, { ...country, allowedHosts: [] }, strict).ok, false, 'an empty allowlist approves nothing');
    assert.equal(validateRemoteConfig({ ...good, supersetUrl: 'https://phish.org' }, country, strict).ok, false);
    const pinned: Country = { ...country, allowedHosts: ['ss.example.org'] };
    assert.equal(validateRemoteConfig(good, pinned, strict).ok, true);
    assert.equal(validateRemoteConfig({ ...good, supersetUrl: 'https://evil.org' }, pinned, strict).ok, false);

    // --- hosts / navigation
    assert.equal(hostMatches(new URL('https://a.example.org'), ['*.example.org']), true);
    assert.equal(hostMatches(new URL('https://example.org'), ['*.example.org']), false);
    assert.equal(hostMatches(new URL('https://evilexample.org'), ['*.example.org']), false);
    // Ports: an entry without one approves the default port only; with one, that port only.
    assert.equal(hostMatches(new URL('https://ss.example.org:443/'), ['ss.example.org']), true);
    assert.equal(hostMatches(new URL('https://ss.example.org:10243/'), ['ss.example.org']), false);
    assert.equal(hostMatches(new URL('https://ss.example.org:10243/'), ['ss.example.org:10243']), true);
    assert.equal(hostMatches(new URL('https://ss.example.org/'), ['ss.example.org:10243']), false);
    assert.equal(hostMatches(new URL('https://ss.example.org:8443/'), ['ss.example.org:10243']), false);
    const ported: Country = { ...country, allowedHosts: ['ss.example.org:10243'] };
    const portedOk = validateRemoteConfig({ ...good, supersetUrl: 'https://ss.example.org:10243/' }, ported, strict);
    assert.ok(portedOk.ok && portedOk.value.supersetUrl === 'https://ss.example.org:10243', 'the port is kept in the Superset URL');
    assert.equal(validateRemoteConfig({ ...good, supersetUrl: 'https://ss.example.org:9999/' }, ported, strict).ok, false);
    assert.equal(validateRemoteConfig({ ...good, supersetUrl: 'https://ss.example.org:10243/' }, pinned, strict).ok, false, 'an unlisted port is refused');
    assert.deepEqual(parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', allowedHosts: ['X.org:10243'] }] }, strict)[0].allowedHosts, ['x.org:10243']);
    for (const bad of ['x.org:0', 'x.org:70000', 'x.org:443', 'x.org:', 'https://x.org', 'x.org/']) {
        assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', allowedHosts: [bad] }] }, strict), /invalid host/, bad);
    }
    const nav = (u: string, hosts: string[] = []) => isNavigationAllowed(u, 'https://ss.example.org', hosts, strict);
    assert.equal(nav('https://ss.example.org/superset/welcome'), true);
    assert.equal(nav('https://SS.example.org/x'), true);
    assert.equal(nav('https://ss.example.org:443/x'), true);
    assert.equal(nav('https://ss.example.org:8443/x'), false);
    assert.equal(nav('https://ss.example.org:8443/x', ['ss.example.org']), false);
    assert.equal(nav('about:blank'), true);
    assert.equal(nav('https://evil.org/'), false);
    assert.equal(nav('http://ss.example.org/'), false);
    assert.equal(nav('intent://x#Intent;end'), false);
    assert.equal(nav('javascript:alert(1)'), false);
    assert.equal(nav('file:///etc/passwd'), false);
    assert.equal(nav('https://ss.example.org.evil.org/'), false);
    assert.equal(nav('https://sso.idp.org/', ['sso.idp.org']), true);
    assert.equal(nav('https://sso.idp.org:8443/', ['sso.idp.org']), false);
    assert.equal(nav('https://sso.idp.org:8443/', ['sso.idp.org:8443']), true);
    assert.equal(isNavigationAllowed('https://zim.example.org:10243/superset/', 'https://zim.example.org:10243', ['zim.example.org:10243'], strict), true);
    assert.equal(isAuthoringDestination('https://ss.example.org/chart/add', good.supersetUrl), true);
    assert.equal(isAuthoringDestination('https://ss.example.org/dashboard/new/', good.supersetUrl), true);
    assert.equal(isAuthoringDestination('https://ss.example.org/dashboard/import/', good.supersetUrl), true);
    assert.equal(isAuthoringDestination('https://ss.example.org/superset/dashboard/5/', good.supersetUrl), false);
    assert.equal(isAuthoringDestination('https://other.example.org/dashboard/new/', good.supersetUrl), false);
    assert.equal(buildLandingUrl('https://ss.example.org/sub/', '/login/'), 'https://ss.example.org/sub/login/');

    // --- version sync: cache vs fetch
    let configCalls = 0;
    const stored: StoredConfig = { ...good, supersetUrl: 'https://ss.example.org', countryCode: 'ZW', lastCheckedAt: 1, webeditorUrl: country.webeditorUrl, fetchedAt: Date.now() };
    const apiWith = (version: unknown, config: unknown = good) => ({
        fetchVersion: async () => ({ versionNumber: version }),
        fetchConfig: async () => { configCalls++; return config; },
    });

    let r = await resolveConfig(country, stored, apiWith(3), strict);
    assert.equal(r.fetched, false);
    assert.equal(r.verified, true);
    assert.equal(configCalls, 0, 'identical version must not trigger a full-config fetch');
    {
        const day = 24 * 60 * 60 * 1000;
        const now = Date.now();
        const edited = { ...good, inactivityTimeoutMinutes: 45 };
        r = await resolveConfig(country, { ...stored, fetchedAt: now - day - 1 }, apiWith(3, edited), { ...strict, now });
        assert.equal(r.fetched, true, 'a day-old config is downloaded again even without a version bump');
        assert.equal(r.config.inactivityTimeoutMinutes, 45);
        r = await resolveConfig(country, { ...stored, fetchedAt: now - day + 60_000 }, apiWith(3, edited), { ...strict, now });
        assert.equal(r.fetched, false, 'a config younger than a day is kept');
        r = await resolveConfig(country, { ...stored, fetchedAt: null }, apiWith(3, edited), { ...strict, now });
        assert.equal(r.fetched, true, 'rows from before refresh tracking are downloaded once');
        r = await resolveConfig(country, { ...stored, fetchedAt: now + day }, apiWith(3, edited), { ...strict, now });
        assert.equal(r.fetched, true, 'a fetch time in the future (clock changed) is treated as stale');
        const offline = { fetchVersion: async () => ({ versionNumber: 3 }), fetchConfig: async () => { throw new SyncError('Webeditor offline', undefined, true); } };
        r = await resolveConfig(country, { ...stored, fetchedAt: now - day - 1 }, offline, { ...strict, now });
        assert.equal(r.config.supersetUrl, stored.supersetUrl, 'a failed refresh keeps the saved configuration');
    }

    const changedEditor = { ...country, webeditorUrl: 'https://other-we.example.org' };
    r = await resolveConfig(changedEditor, stored, apiWith(3, { ...good, supersetUrl: 'https://new-ss.example.org/' }), strict);
    assert.equal(r.fetched, true, 'a changed Webeditor must refetch even when the version matches');
    assert.equal(r.config.supersetUrl, 'https://new-ss.example.org');
    await assert.rejects(resolveConfig(changedEditor, stored, { fetchVersion: async () => { throw new SyncError('Webeditor offline', '502', true); }, fetchConfig: async () => good }, strict), /Webeditor offline/, 'a cache from another Webeditor must not be used during a 502');
    r = await resolveConfig(country, { ...stored, webeditorUrl: null }, apiWith(3), strict);
    assert.equal(r.fetched, true, 'legacy cache rows without a known Webeditor must be refreshed');

    r = await resolveConfig(country, stored, apiWith(4, { ...good, versionNumber: 4, inactivityTimeoutMinutes: 30 }), strict);
    assert.equal(r.fetched, true);
    assert.equal(r.config.versionNumber, 4);
    assert.equal(r.config.inactivityTimeoutMinutes, 30);

    r = await resolveConfig(country, stored, apiWith(2, { ...good, versionNumber: 2, supersetUrl: 'https://new-ss.example.org/' }), strict);
    assert.equal(r.fetched, true, 'a lower Webeditor version must also refresh the saved configuration');
    assert.equal(r.config.versionNumber, 2);
    assert.equal(r.config.supersetUrl, 'https://new-ss.example.org');

    r = await resolveConfig(country, null, apiWith(3), strict);
    assert.equal(r.fetched, true, 'missing cache must fetch');

    r = await resolveConfig(pinned, { ...stored, supersetUrl: 'https://evil.org' }, apiWith(3), strict);
    assert.equal(r.fetched, true, 'cache that no longer validates is refetched');

    await assert.rejects(resolveConfig(country, stored, apiWith('x'), strict), SyncError);
    await assert.rejects(resolveConfig(country, null, apiWith(3, { ...good, supersetUrl: 'http://x.org' }), strict), SyncError);
    const unavailable = { fetchVersion: async () => { throw new SyncError('Webeditor offline', undefined, true); }, fetchConfig: async () => good };
    r = await resolveConfig(country, stored, unavailable, strict);
    assert.equal(r.fetched, false);
    assert.equal(r.verified, false);
    assert.equal(r.config.supersetUrl, stored.supersetUrl);
    assert.match(r.warning || '', /Webeditor offline/);
    await assert.rejects(resolveConfig(country, null, unavailable, strict), /Webeditor offline/);
    await assert.rejects(resolveConfig(pinned, { ...stored, supersetUrl: 'https://evil.org' }, unavailable, strict), /Webeditor offline/);
    await assert.rejects(resolveConfig(country, stored, { fetchVersion: async () => { throw new SyncError('key rejected', '401'); }, fetchConfig: async () => good }, strict), /key rejected/);
    r = await resolveConfig(country, stored, { fetchVersion: async () => ({ versionNumber: 4 }), fetchConfig: async () => { throw new SyncError('Webeditor offline', undefined, true); } }, strict);
    assert.equal(r.verified, false, 'a failed config fetch keeps the saved URL');

    // --- remote api: key header, URL, status mapping, no secrets in errors
    const seen: { url?: string; headers?: any; } = {};
    const fakeFetch = (status: number, body: unknown = {}) => (async (url: any, init: any) => {
        seen.url = url; seen.headers = init.headers;
        return { status, ok: status >= 200 && status < 300, json: async () => body } as any;
    }) as typeof fetch;

    assert.deepEqual(await createRemoteApi(fakeFetch(200, { versionNumber: 2 })).fetchVersion(country), { versionNumber: 2 });
    assert.equal(seen.url, 'https://we.example.org/api/v1/mobile-analytics/version');
    assert.equal(seen.headers['x-api-key'], 'k');
    await createRemoteApi(fakeFetch(200, good)).fetchConfig(country);
    assert.equal(seen.url, 'https://we.example.org/api/v1/mobile-analytics/config');
    for (const status of [401, 404, 429, 500]) {
        await assert.rejects(createRemoteApi(fakeFetch(status)).fetchConfig(country), (e: any) =>
            e instanceof SyncError && e.message.includes('Webeditor') && !e.message.includes('k"'));
    }
    {
        let called = false;
        const spy = (async () => { called = true; return { status: 200, ok: true, json: async () => ({}) } as any; }) as typeof fetch;
        const placeholder = { ...country, apiKey: 'nta_REPLACE_WITH_KEY_FROM_REPORTING_CONFIGURATIONS_PAGE' };
        for (const call of [(a: ReturnType<typeof createRemoteApi>) => a.fetchVersion(placeholder), (a: ReturnType<typeof createRemoteApi>) => a.fetchConfig(placeholder)]) {
            await assert.rejects(call(createRemoteApi(spy)), (e: any) =>
                e instanceof SyncError && !e.recoverable && e.message === 'Superset not yet configured on Webeditor. Contact your administrator for assistance');
        }
        assert.equal(called, false, 'the placeholder key is never sent to the Webeditor');
    }
    await assert.rejects(createRemoteApi(fakeFetch(502)).fetchVersion(country), (e: any) =>
        e instanceof SyncError && e.recoverable && e.supportCode === '502' && e.message.includes('Webeditor is having a problem') && !e.message.includes('502'));
    await assert.rejects(createRemoteApi((async () => { throw new TypeError('Network request failed'); }) as any).fetchVersion(country), /cannot reach the Webeditor/i);
    await assert.rejects(createRemoteApi((async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }) as any).fetchConfig(country), /Webeditor did not respond in time/i);

    // --- injected script: login viewport, native Superset layout elsewhere, narrow message contract
    const script = buildInjectedScript({ landingPathname: '/login/', supersetOrigin: 'https://ss.example.org' });
    assert.doesNotThrow(() => new Function(script), 'injected script must be syntactically valid');
    assert.ok(script.includes('"/login"'));
    assert.ok(script.includes('width=device-width'));
    const nodes: any[] = [];
    const brandChildren: any[] = [];
    const brand = { appendChild: (node: any) => brandChildren.push(node) };
    const bodyClasses: string[] = [];
    const page: any = {
        readyState: 'complete',
        head: { appendChild: (node: any) => nodes.push(node) },
        body: {},
        documentElement: { appendChild: (node: any) => nodes.push(node), classList: { add: (name: string) => bodyClasses.push(name), remove() {} } },
        querySelector: (selector: string) => selector === '.navbar-brand' ? brand : null,
        getElementById: (id: string) => brandChildren.find(node => node.id === id) || null,
        createElement: (tag: string) => ({ tag }),
    };
    const messages: string[] = [];
    const listeners: Record<string, ((event: any) => void)[]> = {};
    const webWindow: any = {
        addEventListener: (name: string, listener: (event: any) => void) => { (listeners[name] ||= []).push(listener); },
        requestAnimationFrame: (callback: () => void) => callback(),
        dispatchEvent: () => {},
        ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
    };
    vm.runInNewContext(script, { document: page, location: { origin: 'https://ss.example.org', pathname: '/login/', search: '', href: 'https://ss.example.org/login/' }, window: webWindow, Event: class {}, URL });
    assert.ok(nodes.some(node => node.name === 'viewport' && node.content.includes('width=device-width')));
    assert.ok(nodes.some(node => node.id === 'nt-filter-actions-style' && node.textContent.includes('filterbar-action-buttons')));
    assert.ok(nodes.some(node => node.id === 'nt-mobile-style' && node.textContent.includes('.nt-login')));
    assert.ok(nodes.some(node => node.id === 'nt-mobile-style' && node.textContent.includes('.navbar-brand img')));
    assert.equal(brandChildren.length, 1);
    assert.equal(brandChildren[0].id, 'nt-login-logo');
    assert.ok(brandChildren[0].src.startsWith('data:image/png;base64,'));
    assert.ok(!script.includes('.react-grid-layout'), 'do not override Superset chart geometry');
    assert.deepEqual(bodyClasses, ['nt-login']);
    const loginReady = messages.find(message => isAnyPageReadyMessage(message))!;
    assert.deepEqual(readPageContext(messages[0]), { kind: 'sign-in', url: 'https://ss.example.org/login/' });
    assert.deepEqual(readPageContext(loginReady), { kind: 'sign-in', url: 'https://ss.example.org/login/' });
    assert.equal(isPageReadyMessage(loginReady, 'https://ss.example.org/login/'), true);
    assert.equal(isPageReadyMessage(loginReady, 'https://ss.example.org/other/'), false);
    assert.equal(isPageReadyMessage('{"type":"activity"}', 'https://ss.example.org/login/'), false);
    assert.equal(isActivityMessage('{"type":"activity"}'), true);
    assert.equal(isActivityMessage('{"type":"other"}'), false);
    assert.equal(isActivityMessage('not json'), false);
    assert.equal(pageKindFromUrl('https://ss.example.org/login/', '/login/'), 'sign-in');
    assert.equal(pageKindFromUrl('https://ss.example.org/custom-auth/', '/custom-auth/'), 'sign-in');
    assert.equal(pageKindFromUrl('https://ss.example.org/superset/dashboard/5/', '/login/'), 'dashboard');
    assert.equal(pageKindFromUrl('https://ss.example.org/superset/welcome/', '/login/'), 'other');
    assert.equal(readPageContext('{"type":"page-context","kind":"dashboard","url":"https://ss.example.org/superset/dashboard/5/"}')?.kind, 'dashboard');
    assert.equal(readPageContext('{"type":"page-context","kind":"bogus","url":"https://ss.example.org/"}'), null);
    assert.equal(shouldKeepDashboardVisible('https://ss.example.org/superset/dashboard/5', 'https://ss.example.org/superset/dashboard/5/?native_filters_key=abc'), true);
    assert.equal(shouldKeepDashboardVisible('https://ss.example.org/superset/dashboard/5', 'https://ss.example.org/superset/dashboard/6/'), true);
    assert.equal(shouldKeepDashboardVisible('https://ss.example.org/login', 'https://ss.example.org/superset/dashboard/5/'), false);
    assert.equal(shouldKeepDashboardVisible('https://ss.example.org/superset/dashboard/5', 'https://ss.example.org/login/'), false);
    assert.equal(shouldKeepDashboardVisible('https://ss.example.org/superset/dashboard/5', 'https://other.example.org/superset/dashboard/5/'), false);
    assert.ok(!script.includes('navigation-start'), 'in-app route changes must not trigger a native loading cover');
    const homeNodes: any[] = [];
    const homePage = { ...page, head: { appendChild: (node: any) => homeNodes.push(node) }, documentElement: { appendChild: (node: any) => homeNodes.push(node) } };
    vm.runInNewContext(script, { document: homePage, location: { origin: 'https://ss.example.org', pathname: '/superset/welcome/', href: 'https://ss.example.org/superset/welcome/' }, window: { ...webWindow, screen: { width: 360 }, __ntInit: false }, Event: class {} });
    assert.ok(homeNodes.some(node => node.id === 'nt-filter-actions-style'));
    assert.ok(homeNodes.some(node => node.name === 'viewport' && node.content.includes('width=768') && !node.content.includes('initial-scale=1') && node.content.includes('user-scalable=yes')), 'phones fit a 768px layout and remain zoomable');
    assert.ok(!homeNodes.some(node => node.id === 'nt-mobile-style'), 'login-only styles stay off authenticated pages');
    // The phone dashboard should start with filters collapsed; users can still
    // reopen them, and an explicit Superset preference must not be overwritten.
    {
        const route = 'https://ss.example.org/superset/dashboard/5/';
        const calls: string[] = [];
        const history = {
            state: null,
            replaceState: (_state: unknown, _title: string, url: string) => { calls.push(url); },
            pushState: (_state: unknown, _title: string, url: string) => { calls.push(url); },
        };
        vm.runInNewContext(script, {
            document: { ...page, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} } },
            location: { origin: 'https://ss.example.org', pathname: '/superset/dashboard/5/', href: route },
            window: { ...webWindow, screen: { width: 360 }, __ntInit: false },
            history, Event: class {}, URL,
        });
        assert.equal(new URL(calls[0]).searchParams.get('expand_filters'), '0');
        history.pushState(null, '', '/superset/dashboard/6/');
        assert.equal(new URL(calls[1]).searchParams.get('expand_filters'), '0');
        history.pushState(null, '', '/superset/dashboard/6/?expand_filters=1');
        assert.equal(new URL(calls[2], route).searchParams.get('expand_filters'), '1');
        const navigationsBeforeAdd = calls.length;
        history.pushState(null, '', '/chart/add');
        assert.equal(calls.length, navigationsBeforeAdd, 'chart creation must not mount through SPA history');
        assert.equal(readReadOnlyAddKind(messages[messages.length - 1]), 'Chart');
    }
    {
        const clickHandlers: ((event: any) => void)[] = [];
        const windowClicks: ((event: any) => void)[] = [];
        const blocked: string[] = [];
        const rootClasses = new Set<string>();
        const styled = (textContent: string, display = ''): any => ({
            textContent,
            style: { display, setProperty(_name: string, value: string) { this.display = value; }, removeProperty() { this.display = ''; } },
            parentElement: null,
        });
        const security = styled('Security');
        const logout = styled('Logout', 'none');
        const info = styled('Info');
        const about = styled('About');
        const user = styled('User Info Logout');
        const settingsPopup: any = {
            textContent: 'Security User Info Logout About',
            classList: { add() {} },
            querySelectorAll: (selector: string) => selector === 'li' ? [security, user, info, logout, about]
                : selector.includes('a, button') ? [info, logout, about] : [],
        };
        for (const item of [security, user, info, logout, about]) item.parentElement = settingsPopup;
        const menuItem: any = {
            textContent: 'Chart',
            getAttribute: () => null,
            closest: () => null,
            matches: (selector: string) => selector.includes('button'),
            querySelector: (selector: string) => selector === 'svg' ? {} : null,
        };
        const fakeDocument: any = {
            ...page,
            body: { childElementCount: 0 },
            documentElement: { ...page.documentElement, classList: { add: (name: string) => rootClasses.add(name), remove: (name: string) => rootClasses.delete(name), contains: (name: string) => rootClasses.has(name) } },
            head: { appendChild() {} },
            querySelector: () => null,
            querySelectorAll: (selector: string) => selector.includes('.ant-menu-submenu-popup ul') ? [settingsPopup] : [],
            addEventListener: (name: string, listener: (event: any) => void) => { if (name === 'click') clickHandlers.push(listener); },
        };
        vm.runInNewContext(script, {
            document: fakeDocument,
            location: { origin: 'https://ss.example.org', pathname: '/chart/list/', href: 'https://ss.example.org/chart/list/' },
            window: { ...webWindow, __ntInit: false, addEventListener: (name: string, listener: (event: any) => void) => { if (name === 'click') windowClicks.push(listener); }, ReactNativeWebView: { postMessage: (message: string) => blocked.push(message) } },
            Event: class {}, URL,
        });
        let prevented = false;
        let stopped = false;
        const click = {
            target: { closest: (selector: string) => selector.includes('[role="menuitem"]') ? menuItem : null },
            preventDefault: () => { prevented = true; },
            stopImmediatePropagation: () => { stopped = true; },
        };
        for (const listener of windowClicks) { listener(click); if (stopped) break; }
        if (!stopped) for (const listener of clickHandlers) listener(click);
        assert.equal(prevented, true, '+Chart menu clicks must be prevented before navigation');
        assert.equal(stopped, true, '+Chart menu clicks must not reach Superset navigation handlers');
        assert.equal(blocked.some(message => readReadOnlyAddKind(message) === 'Chart'), true);
        assert.equal(rootClasses.has('nt-resource-list'), true, 'chart list gets larger tap targets');
        assert.equal(security.style.display, 'none', 'administrative Settings rows stay hidden');
        assert.equal(logout.style.display, '', 'Logout remains visible even if an earlier pass hid it');
    }
    const tabletNodes: any[] = [];
    const tabletPage = { ...page, head: { appendChild: (node: any) => tabletNodes.push(node) }, documentElement: { appendChild: (node: any) => tabletNodes.push(node) } };
    vm.runInNewContext(script, { document: tabletPage, location: { origin: 'https://ss.example.org', pathname: '/superset/welcome/', href: 'https://ss.example.org/superset/welcome/' }, window: { ...webWindow, screen: { width: 820 }, __ntInit: false }, Event: class {} });
    assert.ok(tabletNodes.some(node => node.name === 'viewport' && node.content.includes('width=1024') && node.content.includes('user-scalable=yes')), 'portrait tablets keep horizontal Superset navigation');
    {
        const redirected: string[] = [];
        const notices: string[] = [];
        vm.runInNewContext(script, {
            document: { ...page, head: { appendChild() {} }, documentElement: { appendChild() {} } },
            location: { origin: 'https://ss.example.org', pathname: '/chart/add', href: 'https://ss.example.org/chart/add', replace: (url: string) => redirected.push(url) },
            window: { ...webWindow, __ntInit: false, ReactNativeWebView: { postMessage: (message: string) => notices.push(message) } },
            Event: class {}, URL,
        });
        assert.equal(redirected[0], 'https://ss.example.org/chart/list/', 'a chart creation page must redirect back to the read-only list');
        assert.equal(readReadOnlyAddKind(notices[0]), 'Chart');
    }
    // dashboards: not ready while the React root is empty (blank page); ready as soon as the shell/skeleton renders
    {
        const timers: (() => void)[] = [];
        let rendered = false;
        const out: string[] = [];
        const app: any = { get childElementCount() { return rendered ? 1 : 0; }, querySelector: () => (rendered ? {} : null), innerText: '', scrollWidth: 768, clientWidth: 768 };
        const doc: any = { ...page, body: app, getElementById: (id: string) => (id === 'app' ? app : null), querySelector: () => null };
        const listeners2: Record<string, (() => void)[]> = {};
        vm.runInNewContext(script, {
            document: doc,
            location: { origin: 'https://ss.example.org', pathname: '/superset/welcome/', href: 'https://ss.example.org/superset/welcome/' },
            window: { ...webWindow, __ntInit: false, addEventListener: (n: string, f: () => void) => { (listeners2[n] ||= []).push(f); }, ReactNativeWebView: { postMessage: (m: string) => out.push(m) } },
            Event: class {}, URL, setTimeout: (fn: () => void) => { timers.push(fn); return 0; },
        });
        for (let i = 0; i < 5; i++) timers.shift()!();
        assert.equal(out.filter(m => isAnyPageReadyMessage(m)).length, 0, 'blank React root is not ready');
        rendered = true;
        for (let i = 0; i < 6 && timers.length; i++) timers.shift()!();
        assert.equal(out.filter(m => isAnyPageReadyMessage(m)).length, 1, 'ready once Superset renders its shell/skeleton, without waiting for charts');

        // a submitted form that starts navigating reports "busy"; unloads without a submit report nothing
        listeners2.beforeunload.forEach(f => f());
        assert.equal(out.filter(m => readBusyLabel(m)).length, 0);
        listeners2.submit.forEach(f => f());
        listeners2.beforeunload.forEach(f => f());
        assert.equal(readBusyLabel(out[out.length - 1]), 'Loading…');
    }
    assert.equal(readBusyLabel('{"type":"busy","label":"Signing in…"}'), 'Signing in…');
    assert.equal(readBusyLabel('{"type":"activity"}'), null);
    assert.equal(readReadOnlyAddKind('{"type":"read-only-add","kind":"Chart"}'), 'Chart');
    assert.equal(readReadOnlyAddKind('{"type":"read-only-add","kind":"Dashboard"}'), 'Dashboard');
    assert.equal(readReadOnlyAddKind('{"type":"read-only-add","kind":"Import"}'), null);
    assert.equal(isFilterAppliedMessage('{"type":"filter-applied"}'), true);
    assert.equal(readBusyLabel('nope'), null);

    // Wide content does not change the fitted viewport or force a zoom level.
    {
        const nodes3: any[] = [];
        const wideApp: any = { childElementCount: 1, querySelector: () => null, innerText: 'x', scrollWidth: 900, clientWidth: 768 };
        vm.runInNewContext(script, {
            document: { ...page, head: { appendChild: (n: any) => nodes3.push(n) }, documentElement: { ...page.documentElement, appendChild: (n: any) => nodes3.push(n) }, body: wideApp, getElementById: (id: string) => (id === 'app' ? wideApp : null), querySelector: () => null },
            location: { origin: 'https://ss.example.org', pathname: '/chart/list/', href: 'https://ss.example.org/chart/list/' },
            window: { ...webWindow, __ntInit: false }, Event: class {}, URL,
        });
        assert.ok(nodes3.some(n => n.name === 'viewport' && n.content.includes('width=768') && !n.content.includes('initial-scale=')), 'wide content keeps the fitted viewport');
    }
    // login detected even when it is not exactly the landing path (prefix / redirect)
    const prefixNodes: any[] = [];
    vm.runInNewContext(script, {
        document: { ...page, head: { appendChild: (n: any) => prefixNodes.push(n) }, documentElement: { appendChild: (n: any) => prefixNodes.push(n) } },
        location: { origin: 'https://ss.example.org', pathname: '/analytics/login/', href: 'https://ss.example.org/analytics/login/' },
        window: { ...webWindow, __ntInit: false }, Event: class {}, URL,
    });
    assert.ok(prefixNodes.some(n => n.name === 'viewport' && n.content.includes('width=device-width')), 'any /login path gets the phone layout');
    // hostile path/origin strings cannot break out of the script
    assert.equal(pageKey('https://ss.example.org/superset/dashboard/5/?native_filters_key=abc#x'), pageKey('https://ss.example.org/superset/dashboard/5'));
    assert.notEqual(pageKey('https://ss.example.org/superset/dashboard/5/'), pageKey('https://ss.example.org/superset/dashboard/6/'));
    assert.equal(readyPageUrl('{"type":"page-ready","url":"https://a.b/c"}'), 'https://a.b/c');
    assert.equal(readyPageUrl('{"type":"activity"}'), null);
    assert.doesNotThrow(() => new Function(buildInjectedScript({ landingPathname: '/a"b', supersetOrigin: 'https://ss.example.org";alert(1);//' })));

    // --- export menu labels (Superset 6.1.0, English): one table drives every export decision
    {
        const block = /var NT_LABELS = (\{[\s\S]*?\n\s*\});/.exec(script);
        assert.ok(block, 'NT_LABELS table is present in the injected script');
        const labels = vm.runInNewContext(`(${block![1]})`) as Record<'pdf' | 'image' | 'file', RegExp>;
        for (const label of ['Export to PDF', 'export as pdf', 'Export to .PDF']) assert.ok(labels.pdf.test(label), label);
        for (const label of ['Download as Image', 'Download as an image']) assert.ok(labels.image.test(label), label);
        for (const label of ['Export to .CSV', 'Export to full .CSV', 'Export to Excel', 'Download as CSV', 'Export to .XLSX', 'Export screenshot (jpeg)', 'Export YAML', 'Export to PDF', 'Download as Image'])
            assert.ok(labels.file.test(label), label);
        for (const label of ['Export', 'Edit dashboard', 'Share', 'Download', 'PDF settings', 'View as table']) {
            assert.equal(labels.file.test(label), false, label);
            assert.equal(labels.pdf.test(label), false, label);
        }
    }

    // --- iOS attachment downloads: the app asks the page to re-fetch the URL and send it over the export bridge
    {
        const sent: any[] = [];
        const fetched: string[] = [];
        const bridgeWindow: any = {
            ...webWindow,
            __ntInit: false,
            HTMLAnchorElement: { prototype: { click() {} } },
            URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
            ReactNativeWebView: {
                postMessage: (raw: string) => {
                    const message = JSON.parse(raw);
                    sent.push(message);
                    // Acknowledge every sequenced message the way AnalyticsScreen does.
                    if (message.sequence) setTimeout(() => bridgeWindow.__ntDownloadAck(message.id, message.sequence, true), 0);
                },
            },
        };
        const csv = new Blob(['a,b\n1,2\n'], { type: 'text/csv; charset=utf-8' });
        vm.runInNewContext(script, {
            document: { ...page, addEventListener() {} },
            location: { origin: 'https://ss.example.org', pathname: '/superset/dashboard/5/', href: 'https://ss.example.org/superset/dashboard/5/' },
            window: bridgeWindow, Event: class {}, URL, Blob, setTimeout, clearTimeout,
            atob, history: undefined,
            fetch: async (url: string) => { fetched.push(url); return { ok: true, blob: async () => csv, headers: { get: () => null } }; },
            FileReader: class {
                result: string | null = null; onload: null | (() => void) = null; onerror: null | (() => void) = null;
                readAsDataURL(piece: Blob) { piece.arrayBuffer().then(buffer => { this.result = `data:;base64,${Buffer.from(buffer).toString('base64')}`; this.onload?.(); }); }
            },
        });
        assert.equal(typeof bridgeWindow.__ntTransferExport, 'function');
        assert.equal(bridgeWindow.__ntTransferExport('https://evil.org/steal.csv'), false, 'cross-origin downloads are refused');
        assert.equal(bridgeWindow.__ntTransferExport('https://ss.example.org/api/v1/chart/7/data/?format=csv'), true);
        for (let i = 0; i < 50 && !sent.some(m => m.type === 'export-finish' || m.type === 'export-abort'); i++) await new Promise(r => setTimeout(r, 5));
        assert.deepEqual(fetched, ['https://ss.example.org/api/v1/chart/7/data/?format=csv']);
        const start = sent.find(m => m.type === 'export-start');
        assert.equal(start?.name, 'data.csv', 'a CSV without a file name gets a .csv extension');
        assert.equal(start?.size, csv.size);
        assert.ok(sent.some(m => m.type === 'export-finish'), JSON.stringify(sent));
        assert.equal(Buffer.from(sent.find(m => m.type === 'export-chunk').data, 'base64').toString(), 'a,b\n1,2\n');
        for (const message of sent) {
            if (/^export-(start|chunk|finish)$/.test(message.type)) assert.ok(parseExportMessage(JSON.stringify(message)), `bridge message passes app validation: ${message.type}`);
        }
    }

    // --- diagnostics: scrubbing, volume limits, endpoint validation
    {
        const scrubbed = scrubText('GET https://ss.example.org/superset/dashboard/5/?native_filters_key=abc&patient=Jane#x failed for jane.doe@clinic.org with nta_SECRETKEY123, Bearer abc.def, record 12345678');
        assert.ok(scrubbed.includes('https://ss.example.org/superset/dashboard/5/'), scrubbed);
        for (const leaked of ['native_filters_key', 'patient=Jane', 'jane.doe', 'nta_SECRET', 'abc.def', '12345678']) assert.ok(!scrubbed.includes(leaked), `${leaked} leaked: ${scrubbed}`);
        assert.ok(scrubText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl').includes('[token]'));
        assert.ok(scrubText('x'.repeat(2000)).length <= 500);
        assert.equal(scrubText('HTTP 502 from Webeditor'), 'HTTP 502 from Webeditor', 'short status numbers stay readable');

        const queued: TelemetryEvent[] = [];
        let clock = 1_000_000;
        const reporter = createReporter({ app: { version: '1.0.1', build: '1', platform: 'android', os: '34' }, enqueue: e => queued.push(e), now: () => clock, maxPerSession: 3, dedupeWindowMs: 60_000 });
        reporter.setCountry('ZW');
        const first = reporter.report('page-error', new TypeError('Failed at https://ss.example.org/x?token=1'), { status: 502, url: 'https://ss.example.org/y?q=secret', 'bad key!': 'dropped' });
        assert.ok(first);
        assert.equal(first!.message, 'TypeError: Failed at https://ss.example.org/x');
        assert.deepEqual(first!.detail, { status: 502, url: 'https://ss.example.org/y' });
        assert.equal(first!.country, 'ZW');
        assert.ok(first!.stack && !first!.stack.includes('token=1'));
        assert.equal(reporter.report('page-error', new TypeError('Failed at https://ss.example.org/x?token=2')), null, 'same message within the window is deduplicated');
        clock += 61_000;
        assert.ok(reporter.report('page-error', new TypeError('Failed at https://ss.example.org/x')), 'reported again after the window');
        assert.ok(reporter.report('config-error', 'Webeditor offline'));
        assert.equal(reporter.report('crash', 'one too many'), null, 'per-session cap');
        assert.equal(queued.length, 3);
        assert.ok(queued.every(e => e.session === queued[0].session));

        assert.equal(parseTelemetryUrl('https://we.example.org/api/v1/mobile-diagnostics', false), 'https://we.example.org/api/v1/mobile-diagnostics');
        for (const bad of ['http://we.example.org/x', 'https://u:p@we.example.org/x', 'nope', '', undefined]) assert.equal(parseTelemetryUrl(bad, false), null, String(bad));
        assert.equal(parseTelemetryUrl('http://10.0.2.2:3000/x', true), 'http://10.0.2.2:3000/x');
    }

    console.log('neotree-reporting lib tests passed');
}

main().catch(e => { console.error(e); process.exit(1); });
