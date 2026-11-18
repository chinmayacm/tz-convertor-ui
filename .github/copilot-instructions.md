# GitHub Copilot Instructions — ZoneShift

Refer to [AGENTS.md](../AGENTS.md) at the repository root for the full project architecture, module map, `localStorage` state schema (`zoneshift_prefs_v1`), and build/test invariants.

## Key Rules
- **Zero External Dependencies:** Use native ES modules, `Intl.DateTimeFormat`, and built-in Node.js modules (`node:http`, `node:test`, `node:fs/promises`, `node:vm`) only.
- **Single-File Bundler Invariant:** `scripts/build.js` concatenates `src/tz-data.js`, `src/tz-engine.js`, `src/quick-parse.js`, and `src/app.js` into an IIFE for `dist/zoneshift-standalone.html`. Never introduce duplicate top-level identifier names across those four files.
- **Service Worker Cache Version:** Increment `CACHE_NAME` in `sw.js` whenever changing HTML, CSS, or JS assets.
- **Verification:** Always run `npm test && npm run build` after changes.
