# fieldbinder-site

Static marketing site for https://fieldbinder.ai (Netlify project `fieldbinderai`). No build step: each page is a standalone `.html` file at the repo root; `_redirects` maps the `.html` forms to the clean URLs.

`node scripts/gen-sitemap.mjs` regenerates `sitemap.xml` with `lastmod` from git — run before committing page changes.
