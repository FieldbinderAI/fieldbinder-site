# fieldbinder-site (CLAUDE.md)

## What this is
Static marketing site for fieldbinder.ai. Netlify project `fieldbinderai`. NO build
step: each page is a standalone `.html` file at the repo root, publish dir = repo
root. Clean URLs are served for `x.html` at `/x`; `_redirects` maps `x.html` → `/x`
with a 301.

## Production rule
A push to `main` IS a production deploy. Work on a branch; the Governor reads the
branch/preview deploy; the Founder says yes; then merge.

## Before committing page changes
`node scripts/gen-sitemap.mjs`

## New-page checklist
- Self-canonical `<link rel="canonical">`.
- OG meta: 8 tags (type, site_name, title, description, url, image, image:width,
  image:height). Twitter meta: 4 tags (card, title, description, image).
- Exactly one JSON-LD `@graph` block, reusing the existing `#organization`,
  `#founder`, `#website` nodes — don't redefine them.
- GA tag (`gtag.js`, id `G-9CFB4WC53K`) once.
- `alt` on every image.
- No `.html` in internal links — use root-relative clean paths (e.g. `/pricing`).
- Title ≤60 chars, description ≤155 chars.
- Any price shown must equal the invariant — Free $0 / Basic $9.99/mo / Pro $29/mo /
  Team $35/seat/mo or $29/seat/mo annual — copied from `/pricing`, never retyped.

## GA4 events
`store_badge_click{store,page_path}`, `pricing_cta_click{plan,page_path}`,
`lead_submit{form,page_path}` — fired by the SEO-2A inline script before `</body>`.
Key-event marking in GA4 Admin is a Governor step.
`page_path` is a gtag-reserved field name: gtag maps it to the standard Page path
dimension (`dp=`), not to a custom `ep.page_path` — by design (Governor ruling 2026-09-28).

## Resources hub
`/resources/` is live and indexable since SEO-2B (2026-09-28) with the first article
`resources/how-to-write-a-daily-field-report.html`. Articles are instantiated from
`resources/_template-article.html` ({{TITLE}} = the <title> with the brand suffix,
{{HEADLINE}} = the h1 / Article headline / breadcrumb; the template stays noindex,
is force-404'd in `_redirects` and disallowed in `robots.txt`). An article carries TWO
JSON-LD blocks (the @graph with Article + a FAQPage whose text equals the visible FAQ),
one Download block, and a `<article class="article">` WITHOUT the `reveal` class — a
tall reveal element never reaches the observer's 10% threshold on a phone and stays
invisible. Downloadable templates live in `resources/templates/` and are linked only
from their article. New article = add it to `scripts/gen-sitemap.mjs` PAGES, an
`_redirects` `.html → clean 301!` rule, and the hub card.

## Line endings
Working copies are CRLF (autocrlf); the git index is LF. Normalize before comparing
a working file to `git show`.

## Persona pages
`use-cases/<slug>.html`; hub = `use-cases.html`. Old in-page anchors are mapped by
the hub's inline hash script.
