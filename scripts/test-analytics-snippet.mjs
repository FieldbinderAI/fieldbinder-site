// WEB-ANALYTICS-1 behaviour tests. Run:  node --test scripts/test-analytics-snippet.mjs
// Runs the canonical snippet in a fresh node:vm context per test against a minimal fake browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'assets/analytics-snippet.html'), 'utf8').replace(/\r\n/g, '\n');
const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

const URL_ = 'https://lrvvdmkzgrtkhihmozsz.supabase.co/functions/v1/track';
const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-4777-8666-555555555555';

// opts: pathname, search, hostname, referrer, nav (extra navigator fields),
// storage ('throw' | seed object), win (extra window fields), rawSearch (non-string location.search)
function run(opts = {}) {
  let beaconCalls = 0;
  const fetches = [];
  const listeners = {};
  const store = new Map(Object.entries(opts.storage && opts.storage !== 'throw' ? opts.storage : {}));
  const navigator = { doNotTrack: null, msDoNotTrack: undefined, globalPrivacyControl: undefined, ...(opts.nav || {}) };
  // present on purpose: the snippet must never use it (sendBeacon always sends credentials)
  navigator.sendBeacon = () => { beaconCalls += 1; return true; };
  const sessionStorage = opts.storage === 'throw'
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const document = {
    referrer: opts.referrer || '',
    addEventListener(type, fn, capture) { listeners[type] = { fn, capture }; },
    dispatchEvent(ev) { if (listeners[ev.type]) listeners[ev.type].fn(ev); return true; },
  };
  const location = {
    pathname: opts.pathname ?? '/',
    search: opts.rawSearch !== undefined ? opts.rawSearch : (opts.search ?? ''),
    hostname: opts.hostname ?? 'fieldbinder.ai',
  };
  const sandbox = {
    navigator, document, location, sessionStorage,
    crypto: { randomUUID: () => UUID },
    fetch: (url, init) => { fetches.push({ url, init, body: init && init.body }); return Promise.resolve({}); },
    URL, URLSearchParams, JSON, Promise, String,
    ...(opts.win || {}),
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  let thrown = null;
  try { vm.runInContext(code, ctx); } catch (e) { thrown = e; }
  return { fetches, beaconCalls: () => beaconCalls, listeners, thrown, sandbox, store, document };
}

const events = (r) => r.fetches.map((b) => JSON.parse(b.body).event);
// An <img>-like child: closest(sel) must be asked for exactly 'a[href]' and returns the anchor.
const child = (anchor) => ({
  closest(sel) {
    assert.equal(sel, 'a[href]');
    return anchor;
  },
});
const click = (r, anchor, type = 'click', button = 0) => r.listeners[type].fn({ type, button, target: child(anchor) });
const anchorTo = (hostname, href) => ({ hostname, href: href || `https://${hostname}/` });

test('pageview on load', () => {
  const r = run();
  assert.equal(r.thrown, null);
  assert.equal(r.fetches.length, 1);
  const o = JSON.parse(r.fetches[0].body);
  assert.deepEqual(Object.keys(o).sort(), ['event', 'path', 'referrer_host', 'session_id', 'utm_campaign', 'utm_medium', 'utm_source']);
  assert.equal(o.event, 'pageview');
  assert.equal(o.path, '/');
  assert.equal(o.session_id, UUID);
  assert.equal(o.utm_source, null);
  assert.equal(o.utm_medium, null);
  assert.equal(o.utm_campaign, null);
  assert.equal(o.referrer_host, null);
});

test('referrer host is lowercased; same-site and non-hostnames are dropped', () => {
  const a = run({ referrer: 'https://News.YCombinator.com/item?id=1' });
  assert.equal(JSON.parse(a.fetches[0].body).referrer_host, 'news.ycombinator.com');
  const b = run({ referrer: 'https://fieldbinder.ai/pricing', hostname: 'fieldbinder.ai' });
  assert.equal(JSON.parse(b.fetches[0].body).referrer_host, null);
  const c = run({ referrer: 'https://bad_host.example/' });
  assert.equal(JSON.parse(c.fetches[0].body).referrer_host, null);
  const d = run({ referrer: 'https://[::1]/' });
  assert.equal(JSON.parse(d.fetches[0].body).referrer_host, null);
});

test('utm values: kept, cut to 100, control chars stripped', () => {
  const r = run({ search: '?utm_source=hn&utm_medium=social&utm_campaign=' + 'x'.repeat(150) });
  const o = JSON.parse(r.fetches[0].body);
  assert.equal(o.utm_source, 'hn');
  assert.equal(o.utm_medium, 'social');
  assert.equal(o.utm_campaign.length, 100);
  const c = run({ search: '?utm_source=h%00n%0A&utm_medium=so%1Fcial' });
  const p = JSON.parse(c.fetches[0].body);
  assert.equal(p.utm_source, 'hn');
  assert.equal(p.utm_medium, 'social');
});

test('utm: C1 controls and U+2028/9 are stripped', () => {
  const r = run({ search: '?utm_source=a%C2%85b&utm_medium=c%E2%80%A8d&utm_campaign=e%E2%80%A9f%7Fg' });
  const o = JSON.parse(r.fetches[0].body);
  assert.equal(o.utm_source, 'ab');
  assert.equal(o.utm_medium, 'cd');
  assert.equal(o.utm_campaign, 'efg');
});

test('utm: a lone high surrogate left by the 100-char cut is removed', () => {
  const r = run({ search: '?utm_campaign=' + 'x'.repeat(99) + '😀' });
  const body = r.fetches[0].body;
  const v = JSON.parse(body).utm_campaign;
  assert.ok(v.length <= 100);
  assert.equal(/[\ud800-\udbff]$/.test(v), false);
  assert.equal(body.includes('\\ud83d'), false);
  assert.equal(v, 'x'.repeat(99));
});

test('pricing_view fires on /pricing, /pricing.html and /pricing/ only', () => {
  assert.deepEqual(events(run({ pathname: '/pricing' })), ['pageview', 'pricing_view']);
  assert.deepEqual(events(run({ pathname: '/pricing.html' })), ['pageview', 'pricing_view']);
  assert.deepEqual(events(run({ pathname: '/pricing/' })), ['pageview', 'pricing_view']);
  assert.deepEqual(events(run({ pathname: '/features' })), ['pageview']);
  assert.deepEqual(events(run({ pathname: '/pricing-faq' })), ['pageview']);
});

test('DNT and GPC send nothing and register no listeners', () => {
  for (const o of [
    { nav: { doNotTrack: '1' } },
    { win: { doNotTrack: '1' } },
    { nav: { msDoNotTrack: '1' } },
    { nav: { globalPrivacyControl: true } },
  ]) {
    const r = run(o);
    assert.equal(r.fetches.length, 0);
    assert.equal(r.beaconCalls(), 0);
    assert.equal(Object.keys(r.listeners).length, 0);
  }
  assert.equal(run({ nav: { doNotTrack: '0' } }).fetches.length, 1);
});

test('sessionStorage: throwing storage gives null id', () => {
  const a = run({ storage: 'throw' });
  assert.equal(a.fetches.length, 1);
  assert.equal(JSON.parse(a.fetches[0].body).session_id, null);
});

test('sessionStorage: a malformed stored id is regenerated; a valid uuid is reused', () => {
  const a = run({ storage: { fb_sid: 'existing-id' } });
  assert.equal(JSON.parse(a.fetches[0].body).session_id, UUID);
  assert.equal(a.store.get('fb_sid'), UUID);
  const b = run({ storage: { fb_sid: OTHER_UUID } });
  assert.equal(JSON.parse(b.fetches[0].body).session_id, OTHER_UUID);
  assert.equal(b.store.get('fb_sid'), OTHER_UUID);
});

test('click and auxclick listeners are capture-phase and map CTAs by exact hostname', () => {
  const r = run();
  assert.equal(r.listeners.click.capture, true);
  assert.equal(r.listeners.auxclick.capture, true);
  click(r, anchorTo('apps.apple.com', 'https://apps.apple.com/us/app/fieldbinder-ai/id6792522520'));
  click(r, anchorTo('play.google.com', 'https://play.google.com/store/apps/details?id=ai.fieldbinder.app'));
  click(r, anchorTo('app.fieldbinder.ai'));
  assert.deepEqual(events(r), ['pageview', 'cta_store_ios', 'cta_store_android', 'cta_portal_signup']);
  const before = r.fetches.length;
  click(r, anchorTo('fieldbinder.ai', 'https://fieldbinder.ai/features'));
  click(r, anchorTo('evil.com', 'https://evil.com/?x=apps.apple.com'));
  click(r, anchorTo('apps.apple.com.evil.com', 'https://apps.apple.com.evil.com/'));
  assert.equal(r.fetches.length, before);
  assert.doesNotThrow(() => r.listeners.click.fn({ type: 'click', target: {} }));
  assert.doesNotThrow(() => r.listeners.click.fn({ type: 'click', target: null }));
  assert.doesNotThrow(() => r.listeners.click.fn({ type: 'click', target: { closest: () => null } }));
  assert.equal(r.fetches.length, before);
});

test('auxclick: middle button counts, other buttons do not', () => {
  const r = run();
  click(r, anchorTo('apps.apple.com'), 'auxclick', 1);
  assert.deepEqual(events(r), ['pageview', 'cta_store_ios']);
  click(r, anchorTo('apps.apple.com'), 'auxclick', 2);
  click(r, anchorTo('play.google.com'), 'auxclick', 0);
  assert.deepEqual(events(r), ['pageview', 'cta_store_ios']);
});

test('contact_submit fires on fb-contact-sent, not on a raw submit', () => {
  const r = run();
  assert.equal(r.listeners.submit, undefined);
  r.document.dispatchEvent(new Event('submit'));
  assert.deepEqual(events(r), ['pageview']);
  r.document.dispatchEvent(new Event('fb-contact-sent'));
  assert.deepEqual(events(r), ['pageview', 'contact_submit']);
});

test('sends with fetch: POST, keepalive, credentials omit, no headers; never sendBeacon', () => {
  // credentials "omit": the browser ignores any Set-Cookie on the response (the host CDN sets one on every response)
  const a = run();
  assert.equal(a.beaconCalls(), 0);
  assert.equal(a.fetches.length, 1);
  assert.equal(a.fetches[0].url, URL_);
  assert.equal(a.fetches[0].init.method, 'POST');
  assert.equal(a.fetches[0].init.keepalive, true);
  assert.equal(a.fetches[0].init.credentials, 'omit');
  assert.equal(a.fetches[0].init.headers, undefined);
  assert.equal(typeof a.fetches[0].init.body, 'string');
  const b = run({ win: { fetch: undefined } });
  assert.equal(b.thrown, null);
  assert.equal(b.beaconCalls(), 0);
});

test('request URL is exact and body is a string', () => {
  const r = run();
  assert.equal(r.fetches[0].url, URL_);
  assert.equal(typeof r.fetches[0].body, 'string');
});

test('no exception escapes when the environment is hostile', () => {
  const r = run({ rawSearch: {} });
  assert.equal(r.thrown, null);
  const bad = run({ win: { URLSearchParams: function () { throw new Error('boom'); } } });
  assert.equal(bad.thrown, null);
});
