#!/usr/bin/env node
// Regenerates sitemap.xml. lastmod = the page's last git commit date (YYYY-MM-DD);
// a page with uncommitted changes gets today's date (UTC).
// Run before committing page changes:  node scripts/gen-sitemap.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://fieldbinder.ai';
// Pages in the sitemap (thank-you.html is a form landing page and stays out).
const PAGES = ['index', 'about', 'contact', 'delete-account', 'dmca', 'features', 'login', 'pricing', 'privacy', 'security', 'terms', 'use-cases'];

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const today = new Date().toISOString().slice(0, 10);

const entries = PAGES.map((slug) => {
  const file = `${slug}.html`;
  const dirty = git('status', '--porcelain', '--', file) !== '';
  const committed = git('log', '-1', '--format=%cs', '--', file);
  const lastmod = dirty || !committed ? today : committed;
  const loc = slug === 'index' ? `${SITE}/` : `${SITE}/${slug}`;
  return { loc, lastmod };
});

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...entries.map((e) => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`),
  '</urlset>',
  '',
].join('\n');
writeFileSync(path.join(root, 'sitemap.xml'), xml);
for (const e of entries) console.log(`${e.lastmod}  ${e.loc}`);
