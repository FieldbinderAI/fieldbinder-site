#!/usr/bin/env node
// WEB-ANALYTICS-1 placement check. Run:  node scripts/check-analytics-snippet.mjs
// Asserts the canonical snippet (assets/analytics-snippet.html) is small and cookie-free, that every
// page holds exactly one byte-identical copy before the SEO-2A block and </body>, and that _headers
// allows the beacon endpoint in connect-src on a single CSP line. Exit 1 on any failure.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 1536;
const EXPECTED_PAGES = 24;
const ENDPOINT = 'https://lrvvdmkzgrtkhihmozsz.supabase.co';
let failures = 0;

function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'assets' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const snippet = read(path.join(root, 'assets/analytics-snippet.html'));
const bytes = Buffer.byteLength(snippet, 'utf8');
check(bytes <= MAX_BYTES, `snippet size ${bytes} <= ${MAX_BYTES} bytes`);
for (const bad of ['localStorage', 'document.cookie', 'sendBeacon', 'credentials:"include"']) {
  // The header comment names localStorage in a negative ("no localStorage"); strip comments first.
  const code = snippet.replace(/\/\*[\s\S]*?\*\//g, '');
  check(!code.includes(bad), `snippet code does not contain ${bad}`);
}
// fetch with credentials "omit": the browser ignores the host CDN's Set-Cookie on the beacon response
check(snippet.replace(/\/\*[\s\S]*?\*\//g, '').includes('credentials:"omit"'), 'snippet sends with credentials:"omit"');

const pages = walk(root).sort();
check(pages.length === EXPECTED_PAGES, `page count ${pages.length} === ${EXPECTED_PAGES}`);
for (const f of pages) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const s = read(f);
  const occ = count(s, snippet);
  const at = s.indexOf(snippet);
  const seo = s.indexOf('/* SEO-2A: GA4 key events');
  const body = s.indexOf('</body>');
  const ok = occ === 1 && at < seo && seo >= 0 && at < body && body >= 0;
  check(ok, `${rel}: snippet x${occ}, before SEO-2A and </body>`);
}

check(snippet.includes('fb-contact-sent'), 'snippet listens for fb-contact-sent');
const contact = read(path.join(root, 'contact.html'));
check(count(contact, "dispatchEvent(new CustomEvent('fb-contact-sent'))") === 1, 'contact.html dispatches fb-contact-sent exactly once');

const headers = read(path.join(root, '_headers'));
const cspLines = headers.split('\n').filter((l) => /^\s*Content-Security-Policy/i.test(l));
check(cspLines.length === 1 && /^\s*Content-Security-Policy-Report-Only:/.test(cspLines[0]), '_headers has exactly one CSP line (Report-Only)');
const connect = (cspLines[0] || '').split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src')) || '';
check(connect.split(/\s+/).includes(ENDPOINT), `_headers connect-src contains ${ENDPOINT}`);

if (failures) {
  console.log(`FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log(`OK ${pages.length} pages, snippet ${bytes} bytes`);
