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
// Pages in the sitemap (thank-you.html is a form landing page and the noindex
// resources/_template-article.html scaffold stay out; a trailing slash marks a directory index).
const PAGES = [
  'index', 'about', 'contact', 'delete-account', 'dmca', 'features', 'login',
  'pricing', 'privacy', 'security', 'terms', 'use-cases',
  'use-cases/project-managers', 'use-cases/engineering-consultants',
  'use-cases/contractors', 'use-cases/owners-reps', 'use-cases/facility-maintenance',
  'resources/', 'resources/how-to-write-a-daily-field-report', 'resources/punch-list-template',
];

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const today = new Date().toISOString().slice(0, 10);

const entries = PAGES.map((slug) => {
  // A trailing slash marks a directory index: 'resources/' → resources/index.html, loc …/resources/
  const file = slug.endsWith('/') ? `${slug}index.html` : `${slug}.html`;
  const dirty = git('status', '--porcelain', '--', file) !== '';
  // %ct = committer date as a unix timestamp → formatted in UTC, so committed and dirty
  // pages share one clock (%cs used the commit's local offset and could lag UTC by a day).
  const committedUnix = git('log', '-1', '--format=%ct', '--', file);
  const committed = committedUnix ? new Date(Number(committedUnix) * 1000).toISOString().slice(0, 10) : '';
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
