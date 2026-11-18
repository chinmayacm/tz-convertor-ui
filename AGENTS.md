# AGENTS.md — ZoneShift Developer & Agent Handover Guide

This file persists full architectural context, state schemas, and build invariants so any coding agent or developer in any editor/OS can resume work immediately without exploratory turns.

---

## 1. Project Summary & Core Philosophy

- **App Name:** ZoneShift — Cross-Platform Time Zone Converter, World Clock & Meeting Planner
- **Live URL:** `https://chinmayacm.github.io/tz-convertor-ui/`
- **Repository:** `https://github.com/chinmayacm/tz-convertor-ui`
- **Zero-Dependency Architecture:**
  - **No `node_modules` or external runtime packages.**
  - Uses native browser/OS `Intl.DateTimeFormat` and `Intl.supportedValuesOf('timeZone')` for IANA time zone math and automatic Daylight Saving Time (DST) transitions.
  - Uses Node.js built-in modules (`node:http`, `node:test`, `node:assert/strict`, `node:fs/promises`, `node:vm`) for the dev server, unit/build tests, and single-file bundler.

---

## 2. Quick Commands

```bash
npm start        # Starts zero-dependency local server on http://localhost:4173 (server.js)
npm test         # Runs Node built-in test runner (test/build.test.js + test/tz.test.js)
npm run build    # Builds PWA static site in dist/ AND single-file bundle dist/zoneshift-standalone.html
```

---

## 3. Repository File Map

| File | Responsibility |
| :--- | :--- |
| `index.html` | App shell, SEO `<head>` (canonical, Open Graph, Twitter cards, Schema.org `WebApplication` + `FAQPage` JSON-LD), sticky `.topbar`, `#moduleBar`, 4 main modules (`#module-quick`, `#module-oneToOne`, `#module-multi`, `#module-guide`), and modals (`#zonePickerModal`, `#installHelpModal`, `#uninstallHelpModal`, `#dataPolicyModal`). |
| `styles.css` | CSS variables for Dark (`[data-theme='dark']`) and Light (`[data-theme='light']`) themes, sticky header, module bar drag states, 1-to-1 cards, multi-zone rows, 24h color-coded `.hour-cell` strip, and responsive breakpoints. |
| `src/tz-data.js` | `ABBREVIATION_MAP` (`IST`, `EST`, `PST`, `GMT`, `UTC`, `JST`, etc.), `CITY_ALIASES` (curated cities & search keywords), and `DEFAULT_FAVORITE_ZONES`. |
| `src/tz-engine.js` | Core time zone math: `wallTimeToEpoch` (2-pass DST-safe wall-clock to UTC epoch conversion), `getZonedParts`, `getOffsetMinutes`, `getDayPeriodStatus` (supports custom work & wrap-around night hours), `getZoneSnapshot`, `searchTimeZones` (with `dtfCache`, `abbrevDtfCache`, and 15-min bucket cache), `resolveZoneToken`, and invite formatters (`formatOneToOneInvite`, `formatMultiZoneCompact`, `formatMultiZoneInviteBlock`). |
| `src/quick-parse.js` | Natural-language parser (`parseQuickQuery`) handling queries like `"3pm EST to IST"`, `"14:30 London in Tokyo, New York"`, `"tomorrow 9am PST to UTC"`, and `"5pm PST"`. |
| `src/app.js` | UI state, `localStorage` persistence (`zoneshift_prefs_v1`), DOM rendering, event delegation, drag-and-drop (both module pills and multi-zone rows), URL query parameter deep-linking (`?from=...&to=...`, `?q=...`), and PWA install/uninstall lifecycle. |
| `sw.js` | Offline-first Service Worker (`CACHE_NAME = 'zoneshift-v10'`). |
| `manifest.webmanifest` | PWA manifest (`standalone` + `window-controls-overlay`, icons `192x192`, `512x512`, `icon.svg`). |
| `scripts/build.js` | Production build script (`runBuild()`). Copies static PWA files to `dist/`, stamps `SITE_URL` across `index.html`/`robots.txt`/`sitemap.xml`, validates manifest & JSON-LD, and bundles CSS + JS + base64 SVG into `dist/zoneshift-standalone.html`. |
| `test/tz.test.js` | Unit tests for DST/non-DST conversions, 45-min offsets (`Asia/Kathmandu`), token resolution, natural-language parsing, invite formatting, and custom work/night hour ranges. |
| `test/build.test.js` | Build verification test that runs `runBuild()`, compiles `bundledJs` with `new vm.Script()` to catch syntax/identifier collisions, and asserts SEO/PWA outputs. |
| `.github/workflows/build.yml` | Runs tests + build on push/PR/tags, uploads `zoneshift-pwa-web` (`.zip`) and `zoneshift-standalone-html` artifacts, and publishes GitHub Releases on `v*` tags. |
| `.github/workflows/deploy-pages.yml` | Deploys `dist/` to GitHub Pages on push to `main`/`master` with `SITE_URL` stamped from `actions/configure-pages@v5`. |

---

## 4. Persisted State Schema (`localStorage` key: `'zoneshift_prefs_v1'`)

Managed by `createDefaultState()`, `loadPrefs()`, and `savePrefs()` in `src/app.js`:

```js
{
  theme: 'dark' | 'light',
  use24Hour: false,
  useSystemBase: true,          // When true, baseZone dynamically tracks device OS timezone (getLocalZoneId())
  baseZone: 'Asia/Kolkata',     // Primary conversion anchor across Quick Parse, 1-to-1, and Multi-Zone
  referenceZone: 'Asia/Kolkata',// Active reference zone in Multi-Zone Timeline (decoupled from row index)
  sourceZone: 'Asia/Kolkata',   // 1-to-1 FROM zone
  targetZone: 'America/New_York', // 1-to-1 TO zone
  boardZones: ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'],
  favoriteZones: [...],         // Starred zone IDs
  savedPairs: [{ from: '...', to: '...' }],
  hourRanges: {                 // Customizable Work & Night hours (0..23, supports midnight wrap-around)
    workStart: 9,
    workEnd: 18,
    nightStart: 22,
    nightEnd: 7
  },
  visibleModules: {             // Sub-module open/closed state (guide is closed by default)
    quick: true,
    oneToOne: true,
    multi: true,
    guide: false
  },
  guideDefaultClosedV1: true,   // Migration flag ensuring Guide & FAQ starts closed by default
  isAppInstalled: false,        // Switches header button between "⬇ Install App" and "🗑 Uninstall App"
  moduleOrder: ['quick', 'oneToOne', 'multi', 'guide']
}
```

---

## 5. Critical Invariants & Rules When Making Changes

1. **Single-File Bundler Compatibility (`scripts/build.js`):**
   - `scripts/build.js` concatenates `src/tz-data.js`, `src/tz-engine.js`, `src/quick-parse.js`, and `src/app.js` into a single IIFE by stripping `import ... from './...'` and `export ` keywords.
   - **Do NOT declare duplicate top-level variable/function names** across those four files.
   - Always run `npm test && npm run build` after any code change — `test/build.test.js` compiles the concatenated bundle via `new vm.Script()` and will immediately catch any duplicate identifier or syntax error.
2. **Service Worker Cache Version (`sw.js`):**
   - Whenever you modify `index.html`, `styles.css`, or `src/*.js`, increment `CACHE_NAME` in `sw.js` (e.g. `'zoneshift-v10'` → `'zoneshift-v11'`) so installed desktop PWAs pick up the new assets.
3. **Multi-Zone Row Vertical Alignment (`src/app.js` & `styles.css`):**
   - In `renderMultiBoard()`, every `.board-row` must render the exact same 6 fixed-width buttons inside `.row-actions` (`.row-ref-btn` `98px`, `.row-change-btn` `58px`, and four `.row-icon-btn` `28px`, using `disabled` rather than omitting buttons when at top/bottom or single row). This guarantees `.board-clock` times and dates stay vertically aligned across all rows.
4. **Reference Zone vs Row Order:**
   - Setting a row as Reference (`data-action="make-ref"`) sets `prefs.referenceZone` **in-place** without moving the row.
   - Once a row is Reference, its `.row-ref-btn` becomes `⤒ Move to Top` (`data-action="move-top"`, enabled when `rowIdx > 0`, or `✓ At Top` disabled when `rowIdx === 0`).
5. **SEO & JSON-LD Validation:**
   - `scripts/build.js` parses and validates `<script type="application/ld+json">` in `index.html`. Keep the JSON-LD valid JSON at all times.
