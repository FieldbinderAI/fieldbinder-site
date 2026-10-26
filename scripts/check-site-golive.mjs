#!/usr/bin/env node
// WEB-ANALYTICS-1 + tracker-removal go-live gate (one site deploy). Run from the repo root:
//   node scripts/check-site-golive.mjs                         prep mode: every check, and SHIP-DATE reports PENDING (exit 1)
//   node scripts/check-site-golive.mjs --ship-date 2026-11-02  ship mode: also asserts both privacy "Last updated" lines and every
//                                                              sitemap lastmod carry that date, and no SHIP-DATE placeholder is left
// Optional: --base <git ref> (default origin/main) for the per-page JSON-LD comparison.
// Netlify publishes this repo root as-is (no build step), so the tree IS the built site; every file except .git, node_modules,
// _headers and _redirects is publicly served. That is why the removed vendor's name and its CDN host are assembled from parts
// below: this file is served too and must not match its own scan.
// Exit 1 on any failure (and in prep mode, by design, so the PR cannot ship with the placeholder dates).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = new RegExp('hey' + 'catch', 'gi');
const VENDOR_CDN = 'esm' + '.sh';
const VENDOR_EVENTS = 'in.' + 'hey' + 'catch.ai';
const ENDPOINT = 'https://lrvvdmkzgrtkhihmozsz.supabase.co';
const GA_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-9CFB4WC53K';
const GA_CONFIG = "gtag('config', 'G-9CFB4WC53K')";
const EXPECTED_PAGES = 24;
const EXPECTED_SITEMAP_URLS = 22;
const PLACEHOLDER = 'SHIP-DATE';
const GA_SENTENCE = 'The marketing website fieldbinder.ai uses Google Analytics, which sets cookies to measure site traffic; this applies to the website only, not to the FieldBinder AI app or portal.';
const REMOVED_SENTENCE = 'The website also uses ' + 'Hey' + 'Catch analytics, which sets a cookie to measure page views and clicks; this applies to the website only.';
// Counsel-approved (privacy-redline-web-analytics-1.md §3, Founder relay 2026-10-21); the apostrophe in "browser’s" is U+2019,
// the policy page's typographic convention (as in the next sentence's "browser’s IP address").
const FIRST_PARTY = 'The website also uses our own first-party analytics to count page views and clicks on download, sign-in and contact links. It uses no cookies and stores nothing on your device beyond a temporary session identifier that disappears when you close the tab. Our server does not store your IP address or your browser’s user-agent string; it combines them with a random value that changes every day to produce a one-way code that cannot be reversed and cannot be linked from one day to the next. We keep these event records for up to 400 days, and we record your country and device type (phone, tablet or computer) only in that aggregated form. If your browser sends a Do Not Track or Global Privacy Control signal, our first-party analytics collects nothing at all.';

const argv = process.argv.slice(2);
let shipDate = null;
let base = 'origin/main';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ship-date') shipDate = argv[++i];
  else if (argv[i] === '--base') base = argv[++i];
  else { console.error(`unknown argument: ${argv[i]}`); process.exit(2); }
}

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root).sort();
const pages = files.filter((p) => p.endsWith('.html') && !rel(p).startsWith('assets/'));
check(pages.length === EXPECTED_PAGES, `page count ${pages.length} === ${EXPECTED_PAGES}`);

// 1. The removed vendor: no file in the published tree names it; its module is gone.
const TEXT = /\.(html|js|mjs|css|txt|md|xml|json|svg|webmanifest)$|^_headers$|^_redirects$/;
const vendorHits = [];
for (const f of files) {
  if (!TEXT.test(path.basename(f))) continue;
  const s = read(f);
  const n = (s.match(VENDOR) || []).length + count(s, VENDOR_CDN);
  if (n) vendorHits.push(`${rel(f)} x${n}`);
}
check(vendorHits.length === 0, `removed vendor or its CDN named in 0 files${vendorHits.length ? ` (found: ${vendorHits.join(', ')})` : ''}`);
check(!existsSync(path.join(root, 'assets', 'hey' + 'catch.js')), 'the vendor module file is deleted');

// 2. CSP (report-only): one line, vendor hosts gone, the beacon endpoint allowed in connect-src.
const headers = read(path.join(root, '_headers'));
const cspLines = headers.split('\n').filter((l) => /^\s*Content-Security-Policy/i.test(l));
check(cspLines.length === 1 && /^\s*Content-Security-Policy-Report-Only:/.test(cspLines[0]), '_headers has exactly one CSP line (Report-Only)');
const csp = cspLines[0] || '';
check(!csp.includes(VENDOR_EVENTS) && !csp.includes(VENDOR_CDN), 'CSP names neither removed host');
const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '').split(/\s+/);
check(directive('connect-src').includes(ENDPOINT), `CSP connect-src contains ${ENDPOINT}`);

// 3. Per page: analytics snippet once, GA4 tag once, JSON-LD unchanged vs the base ref.
const snippet = read(path.join(root, 'assets/analytics-snippet.html'));
const ldHash = (s) => {
  const blocks = [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return { n: blocks.length, h: createHash('sha256').update(blocks.join('\n<<>>\n')).digest('hex').slice(0, 16) };
};
for (const f of pages) {
  const r = rel(f);
  const s = read(f);
  check(count(s, snippet) === 1, `${r}: analytics snippet x${count(s, snippet)}`);
  check(count(s, GA_SRC) === 1 && count(s, GA_CONFIG) === 1, `${r}: GA4 tag x${count(s, GA_SRC)}, config x${count(s, GA_CONFIG)}`);
  let baseText = null;
  try {
    baseText = execFileSync('git', ['show', `${base}:${r}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch { /* missing on base */ }
  const now = ldHash(s);
  const was = baseText === null ? null : ldHash(baseText);
  check(was !== null && was.h === now.h && was.n === now.n, `${r}: JSON-LD x${now.n} sha256 ${now.h} === ${base} ${was ? was.h : '(file missing on base)'}`);
}

// 4. Sitemap: still 22 URLs, each one a real page.
const sitemap = read(path.join(root, 'sitemap.xml'));
const locs = [...sitemap.matchAll(/<loc>https:\/\/fieldbinder\.ai\/([^<]*)<\/loc>/g)].map((m) => m[1]);
check(count(sitemap, '<url>') === EXPECTED_SITEMAP_URLS && locs.length === EXPECTED_SITEMAP_URLS, `sitemap <url> x${count(sitemap, '<url>')}, <loc> x${locs.length} === ${EXPECTED_SITEMAP_URLS}`);
const missing = locs.filter((l) => !existsSync(path.join(root, l === '' ? 'index.html' : l.endsWith('/') ? `${l}index.html` : `${l}.html`)));
check(missing.length === 0, `every sitemap URL maps to a page${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);

// 5. privacy.html §2.4: the vendor sentence is gone; the first-party paragraph follows the GA sentence directly, once.
const privacy = read(path.join(root, 'privacy.html'));
check(count(privacy, REMOVED_SENTENCE) === 0, 'privacy §2.4: the removed vendor sentence is absent');
check(count(privacy, FIRST_PARTY) === 1, 'privacy §2.4: the first-party paragraph appears exactly once, verbatim');
check(count(privacy, `${GA_SENTENCE} ${FIRST_PARTY}`) === 1, 'privacy §2.4: the first-party paragraph directly follows the Google Analytics sentence');

// 6. SHIP-DATE: both "Last updated" lines and every sitemap lastmod carry the ship date; no placeholder left on any page.
const placeholderPages = pages.filter((f) => read(f).includes(PLACEHOLDER)).map(rel);
if (!shipDate) {
  console.log(`INFO placeholder ${PLACEHOLDER} on: ${placeholderPages.join(', ') || '(none)'} (privacy x${count(privacy, PLACEHOLDER)})`);
  check(false, `${PLACEHOLDER} PENDING: bump both privacy "Last updated" lines and the sitemap lastmods on ship day, then re-run with --ship-date YYYY-MM-DD`);
} else {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(shipDate);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  const valid = !!d && d.toISOString().slice(0, 10) === shipDate;
  check(valid, `--ship-date ${shipDate} is a real YYYY-MM-DD date`);
  const long = valid ? `${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : '?';
  check(placeholderPages.length === 0, `no ${PLACEHOLDER} placeholder on any page${placeholderPages.length ? ` (found: ${placeholderPages.join(', ')})` : ''}`);
  check(count(privacy, `· Last updated: ${long}</p>`) === 1, `privacy header line reads "Last updated: ${long}"`);
  check(count(privacy, `<b>Last updated: ${long} (added website analytics)</b>`) === 1, `privacy title block reads "Last updated: ${long} (added website analytics)"`);
  const lastmods = [...sitemap.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((x) => x[1]);
  const off = lastmods.filter((x) => x !== shipDate).length;
  check(lastmods.length === EXPECTED_SITEMAP_URLS && off === 0, `sitemap: ${lastmods.length - off} of ${EXPECTED_SITEMAP_URLS} lastmod === ${shipDate}`);
}

if (failures) {
  console.log(`FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log(`OK ${pages.length} pages, sitemap ${locs.length}, ship date ${shipDate}`);
