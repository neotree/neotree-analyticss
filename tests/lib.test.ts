import assert from 'node:assert/strict';
import vm from 'node:vm';

import { createRemoteApi } from '../src/lib/api';
import { buildInjectedScript, isActivityMessage, isAnyPageReadyMessage, isPageReadyMessage, pageKey, readBusyLabel, readyPageUrl } from '../src/lib/injected';
import { parseCountryRegistry } from '../src/lib/registry';
import { resolveConfig, SyncError } from '../src/lib/sync';
import type { Country, StoredConfig } from '../src/lib/types';
import { buildLandingUrl, hostMatches, isNavigationAllowed, validateRemoteConfig } from '../src/lib/validation';

const strict = { allowInsecure: false };
const country: Country = { code: 'ZW', name: 'Zimbabwe', webeditorUrl: 'https://we.example.org', apiKey: 'k', landingPath: '/login/', allowedHosts: [] };
const good = { supersetUrl: 'https://ss.example.org/', inactivityTimeoutMinutes: 15, versionNumber: 3 };

async function main() {
    // --- registry
    const reg = parseCountryRegistry({ countries: [{ code: 'zw', name: 'Zimbabwe', webeditorUrl: 'https://we.example.org/', allowedHosts: ['*.Example.org'] }] }, strict);
    assert.equal(reg[0].code, 'ZW');
    assert.equal(reg[0].webeditorUrl, 'https://we.example.org');
    assert.equal(reg[0].landingPath, '/login/');
    assert.deepEqual(reg[0].allowedHosts, ['*.example.org']);
    {
        const base = { code: 'zw', name: 'Zimbabwe', webeditorUrl: 'https://we.example.org' };
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        assert.equal(parseCountryRegistry({ countries: [{ ...base, flag: png }] }, strict)[0].flag, png);
        assert.equal(parseCountryRegistry({ countries: [{ ...base, flag: 'https://cdn.example.org/zw.png' }] }, strict)[0].flag, 'https://cdn.example.org/zw.png');
        assert.equal(parseCountryRegistry({ countries: [base] }, strict)[0].flag, undefined, 'flag is optional');
        for (const bad of ['http://x.org/zw.png', 'assets/flags/zw.png', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 42]) {
            assert.throws(() => parseCountryRegistry({ countries: [{ ...base, flag: bad }] }, strict), /flag must be/);
        }
    }
    assert.throws(() => parseCountryRegistry({ countries: [] }, strict));
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'http://x.org' }] }, strict), /HTTPS/);
    assert.doesNotThrow(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'http://10.0.2.2:3000' }] }, { allowInsecure: true }));
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://u:p@x.org' }] }, strict), /credentials/);
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org' }, { code: 'a', name: 'B', webeditorUrl: 'https://y.org' }] }, strict), /duplicated/);
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', landingPath: '//evil.org' }] }, strict));
    assert.throws(() => parseCountryRegistry({ countries: [{ code: 'A', name: 'A', webeditorUrl: 'https://x.org', allowedHosts: ['bad host'] }] }, strict));

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
    const pinned: Country = { ...country, allowedHosts: ['ss.example.org'] };
    assert.equal(validateRemoteConfig(good, pinned, strict).ok, true);
    assert.equal(validateRemoteConfig({ ...good, supersetUrl: 'https://evil.org' }, pinned, strict).ok, false);

    // --- hosts / navigation
    assert.equal(hostMatches('a.example.org', ['*.example.org']), true);
    assert.equal(hostMatches('example.org', ['*.example.org']), false);
    assert.equal(hostMatches('evilexample.org', ['*.example.org']), false);
    const nav = (u: string, hosts: string[] = []) => isNavigationAllowed(u, 'https://ss.example.org', hosts, strict);
    assert.equal(nav('https://ss.example.org/superset/welcome'), true);
    assert.equal(nav('https://SS.example.org/x'), true);
    assert.equal(nav('about:blank'), true);
    assert.equal(nav('https://evil.org/'), false);
    assert.equal(nav('http://ss.example.org/'), false);
    assert.equal(nav('intent://x#Intent;end'), false);
    assert.equal(nav('javascript:alert(1)'), false);
    assert.equal(nav('file:///etc/passwd'), false);
    assert.equal(nav('https://ss.example.org.evil.org/'), false);
    assert.equal(nav('https://sso.idp.org/', ['sso.idp.org']), true);
    assert.equal(buildLandingUrl('https://ss.example.org/sub/', '/login/'), 'https://ss.example.org/sub/login/');

    // --- version sync: cache vs fetch
    let configCalls = 0;
    const stored: StoredConfig = { ...good, supersetUrl: 'https://ss.example.org', countryCode: 'ZW', lastCheckedAt: 1 };
    const apiWith = (version: unknown, config: unknown = good) => ({
        fetchVersion: async () => ({ versionNumber: version }),
        fetchConfig: async () => { configCalls++; return config; },
    });

    let r = await resolveConfig(country, stored, apiWith(3), strict);
    assert.equal(r.fetched, false);
    assert.equal(r.verified, true);
    assert.equal(configCalls, 0, 'identical version must not trigger a full-config fetch');

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
    assert.ok(!script.includes('.dashboard-content'), 'do not override Superset dashboard layout');
    assert.deepEqual(bodyClasses, ['nt-login']);
    assert.equal(isPageReadyMessage(messages[0], 'https://ss.example.org/login/'), true);
    assert.equal(isPageReadyMessage(messages[0], 'https://ss.example.org/other/'), false);
    assert.equal(isPageReadyMessage('{"type":"activity"}', 'https://ss.example.org/login/'), false);
    assert.equal(isActivityMessage('{"type":"activity"}'), true);
    assert.equal(isActivityMessage('{"type":"other"}'), false);
    assert.equal(isActivityMessage('not json'), false);
    assert.ok(!script.includes('navigation-start'), 'in-app route changes must not trigger a native loading cover');
    const homeNodes: any[] = [];
    const homePage = { ...page, head: { appendChild: (node: any) => homeNodes.push(node) }, documentElement: { appendChild: (node: any) => homeNodes.push(node) } };
    vm.runInNewContext(script, { document: homePage, location: { origin: 'https://ss.example.org', pathname: '/superset/welcome/', href: 'https://ss.example.org/superset/welcome/' }, window: { ...webWindow, __ntInit: false }, Event: class {} });
    assert.ok(homeNodes.some(node => node.id === 'nt-filter-actions-style'));
    assert.ok(homeNodes.some(node => node.name === 'viewport' && node.content.includes('width=768') && !node.content.includes('initial-scale=1') && node.content.includes('user-scalable=yes')), 'app pages initially fit the screen and remain zoomable');
    assert.ok(!homeNodes.some(node => node.id === 'nt-mobile-style'), 'login-only styles stay off authenticated pages');
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
    assert.equal(readBusyLabel('nope'), null);

    // Wide content does not change the initial desktop viewport or force a zoom level.
    {
        const nodes3: any[] = [];
        const wideApp: any = { childElementCount: 1, querySelector: () => null, innerText: 'x', scrollWidth: 900, clientWidth: 768 };
        vm.runInNewContext(script, {
            document: { ...page, head: { appendChild: (n: any) => nodes3.push(n) }, documentElement: { ...page.documentElement, appendChild: (n: any) => nodes3.push(n) }, body: wideApp, getElementById: (id: string) => (id === 'app' ? wideApp : null), querySelector: () => null },
            location: { origin: 'https://ss.example.org', pathname: '/chart/list/', href: 'https://ss.example.org/chart/list/' },
            window: { ...webWindow, __ntInit: false }, Event: class {}, URL,
        });
        assert.ok(nodes3.some(n => n.name === 'viewport' && n.content.includes('width=768') && !n.content.includes('initial-scale=')), 'wide content does not force an initial zoom');
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

    console.log('neotree-reporting lib tests passed');
}

main().catch(e => { console.error(e); process.exit(1); });
