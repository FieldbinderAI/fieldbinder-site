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

// opts: pathname, search, hostname, referrer, nav (extra navigator fields), noBeacon, beaconResult,
// storage ('throw' | Map-seed object), win (extra window fields), rawSearch (non-string location.search)
function run(opts = {}) {
  const beacons = [];
  const fetches = [];
  const listeners = {};
  const store = new Map(Object.entries(opts.storage && opts.storage !== 'throw' ? opts.storage : {}));
  const navigator = { doNotTrack: null, msDoNotTrack: undefined, globalPrivacyControl: undefined, ...(opts.nav || {}) };
  if (!opts.noBeacon) {
    navigator.sendBeacon = (url, body) => {
      beacons.push({ url, body });
      return opts.beaconResult === false ? false : true;
    };
  }
  const sessionStorage = opts.storage === 'throw'
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const document = {
    referrer: opts.referrer || '',
    addEventListener(type, fn, capture) { listeners[type] = { fn, capture }; },
  };
  const location = {
    pathname: opts.pathname ?? '/',
    search: opts.rawSearch !== undefined ? opts.rawSearch : (opts.search ?? ''),
    hostname: opts.hostname ?? 'fieldbinder.ai',
  };
  const sandbox = {
    navigator, document, location, sessionStorage,
    crypto: { randomUUID: () => UUID },
    fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve({}); },
    URL, URLSearchParams, JSON, Promise, String,
    ...(opts.win || {}),
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  let thrown = null;
  try { vm.runInContext(code, ctx); } catch (e) { thrown = e; }
  return { beacons, fetches, listeners, thrown, sandbox };
}

const events = (r) => r.beacons.map((b) => JSON.parse(b.body).event);
const click = (r, anchor) => r.listeners.click.fn({ target: { closest: () => anchor } });

test('pageview on load', () => {
  const r = run();
  assert.equal(r.thrown, null);
  assert.equal(r.beacons.length, 1);
  const o = JSON.parse(r.beacons[0].body);
  assert.deepEqual(Object.keys(o).sort(), ['event', 'path', 'referrer_host', 'session_id', 'utm_campaign', 'utm_medium', 'utm_source']);
  assert.equal(o.event, 'pageview');
  assert.equal(o.path, '/');
  assert.equal(o.session_id, UUID);
  assert.equal(o.utm_source, null);
  assert.equal(o.utm_medium, null);
  assert.equal(o.utm_campaign, null);
  assert.equal(o.referrer_host, null);
});

test('referrer host is lowercased and same-site is dropped', () => {
  const a = run({ referrer: 'https://News.YCombinator.com/item?id=1' });
  assert.equal(JSON.parse(a.beacons[0].body).referrer_host, 'news.ycombinator.com');
  const b = run({ referrer: 'https://fieldbinder.ai/pricing', hostname: 'fieldbinder.ai' });
  assert.equal(JSON.parse(b.beacons[0].body).referrer_host, null);
});

test('utm values: kept, cut to 100, control chars stripped', () => {
  const r = run({ search: '?utm_source=hn&utm_medium=social&utm_campaign=' + 'x'.repeat(150) });
  const o = JSON.parse(r.beacons[0].body);
  assert.equal(o.utm_source, 'hn');
  assert.equal(o.utm_medium, 'social');
  assert.equal(o.utm_campaign.length, 100);
  const c = run({ search: '?utm_source=h%00n%0A&utm_medium=so%1Fcial' });
  const p = JSON.parse(c.beacons[0].body);
  assert.equal(p.utm_source, 'hn');
  assert.equal(p.utm_medium, 'social');
});

test('pricing_view fires on /pricing and /pricing.html only', () => {
  const a = run({ pathname: '/pricing' });
  assert.deepEqual(events(a), ['pageview', 'pricing_view']);
  const b = run({ pathname: '/pricing.html' });
  assert.deepEqual(events(b), ['pageview', 'pricing_view']);
  const c = run({ pathname: '/features' });
  assert.deepEqual(events(c), ['pageview']);
});

test('DNT and GPC send nothing', () => {
  assert.equal(run({ nav: { doNotTrack: '1' } }).beacons.length, 0);
  assert.equal(run({ win: { doNotTrack: '1' } }).beacons.length, 0);
  assert.equal(run({ nav: { globalPrivacyControl: true } }).beacons.length, 0);
  assert.equal(run({ nav: { doNotTrack: '0' } }).beacons.length, 1);
});

test('sessionStorage: throwing storage gives null id; existing id reused', () => {
  const a = run({ storage: 'throw' });
  assert.equal(a.beacons.length, 1);
  assert.equal(JSON.parse(a.beacons[0].body).session_id, null);
  const b = run({ storage: { fb_sid: 'existing-id' } });
  assert.equal(JSON.parse(b.beacons[0].body).session_id, 'existing-id');
});

test('click listener is capture-phase and maps CTAs', () => {
  const r = run();
  assert.equal(r.listeners.click.capture, true);
  click(r, { href: 'https://apps.apple.com/us/app/fieldbinder-ai/id6792522520' });
  click(r, { href: 'https://play.google.com/store/apps/details?id=ai.fieldbinder.app' });
  click(r, { href: 'https://app.fieldbinder.ai' });
  assert.deepEqual(events(r), ['pageview', 'cta_store_ios', 'cta_store_android', 'cta_portal_signup']);
  const before = r.beacons.length;
  click(r, { href: 'https://fieldbinder.ai/features' });
  assert.equal(r.beacons.length, before);
  assert.doesNotThrow(() => r.listeners.click.fn({ target: {} }));
  assert.doesNotThrow(() => r.listeners.click.fn({ target: null }));
  assert.equal(r.beacons.length, before);
});

test('submit listener fires contact_submit only for the contact form', () => {
  const r = run();
  assert.equal(r.listeners.submit.capture, true);
  r.listeners.submit.fn({ target: { getAttribute: (k) => (k === 'name' ? 'contact' : null) } });
  assert.deepEqual(events(r), ['pageview', 'contact_submit']);
  r.listeners.submit.fn({ target: { getAttribute: () => 'other' } });
  assert.equal(r.beacons.length, 2);
});

test('fetch fallback when sendBeacon returns false or is missing', () => {
  const a = run({ beaconResult: false });
  assert.equal(a.beacons.length, 1);
  assert.equal(a.fetches.length, 1);
  assert.equal(a.fetches[0].url, URL_);
  assert.equal(a.fetches[0].init.method, 'POST');
  assert.equal(a.fetches[0].init.keepalive, true);
  assert.equal(a.fetches[0].init.body, a.beacons[0].body);
  const b = run({ noBeacon: true });
  assert.equal(b.beacons.length, 0);
  assert.equal(b.fetches.length, 1);
  assert.equal(typeof b.fetches[0].init.body, 'string');
});

test('beacon URL is exact and body is a string', () => {
  const r = run();
  assert.equal(r.beacons[0].url, URL_);
  assert.equal(typeof r.beacons[0].body, 'string');
});

test('no exception escapes when URLSearchParams input is hostile', () => {
  const r = run({ rawSearch: {} });
  assert.equal(r.thrown, null);
  const bad = run({ win: { URLSearchParams: function () { throw new Error('boom'); } } });
  assert.equal(bad.thrown, null);
});
