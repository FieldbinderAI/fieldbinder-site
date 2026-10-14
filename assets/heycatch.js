// HeyCatch analytics on the marketing site — HEYCATCH-TRACKER-1 (2026-10-14).
// One shared module, loaded from <head> on every page that carries the GA tag. Autocapture only (page views, clicks):
// no setIdentity, no custom events — the site has no signed-in users. Install guide: https://heycatch.ai/agents.md
// Version pinned to the npm `latest` dist-tag resolved on 2026-10-14 (https://registry.npmjs.org/@heycatch/sdk/latest → 0.8.3);
// never an unpinned URL, never a -dev.N build. The project key is a publishable key (fine in page source).
import { analytics } from 'https://esm.sh/@heycatch/sdk@0.8.3';

analytics.init({
  projectKey: 'hck_pk_ifQR3p49Oh6LYbhyXcXBeTrqZxVxe0ur',
  install: { framework: 'web', agent: 'claude-code' },
  requestBatching: false, // multi-page site: every navigation is a full page load
});
