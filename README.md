# ZoneShift — Cross-Platform Time Zone Converter (Web + Desktop PWA)

A lightweight, zero-dependency Time Zone Converter, World Clock, and Meeting Planner that runs in any browser and installs as an offline-ready standalone desktop window on **Windows, Linux, and macOS**.

🔗 **Live Web App:** https://chinmayacm.github.io/tz-convertor-ui/

## Features

1. **⚡ Quick Natural-Language Input** — Type expressions like `"3pm EST to IST"`, `"14:30 London in Tokyo, New York"`, `"tomorrow 9am PST to UTC"`, or `"5pm PST"` for instant live conversion.
2. **⇄ Bidirectional 1-to-1 Converter** — Pick any source and target time zones, swap with one click, and edit *either* side's time or date to convert forward or backward.
3. **🎚 Multi-Zone Timeline & Scrubber** — Pin 3+ time zones simultaneously, scrub across the day in 15-minute increments, or click any color-coded hour block (`Work`, `Morning/Evening`, `Night`) to preview meeting times.
4. **★ Favorites & One-Click Invite Copy** — Star favorite zones, save frequently used `From → To` pairs, and copy single-line summaries or multi-line meeting invite blocks for Slack, Teams, Email, or Calendar invites.
5. **🧩 Modular, Rearrangeable Layout** — Close sub-modules you don't need (`✕` or via the **Modules** bar) to keep a compact single-tool view, and rearrange modules by dragging pills (`⋮⋮`) or clicking `↑` / `↓` on any card.
6. **📌 Sticky Top Controls** — The **Live / Custom Time** badge, **`Now`** reset button, **`12h / 24h`** format switch, theme toggle, and privacy policy stay pinned at the top while scrolling.
7. **🔍 Shareable Links & SEO-Ready** — Deep-link directly to any pair or query (e.g. `?from=America/New_York&to=Asia/Kolkata` or `?q=3pm+EST+to+IST`), backed by Schema.org `WebApplication` + `FAQPage` JSON-LD, Open Graph / Twitter cards, `robots.txt`, and `sitemap.xml`.

## Quick Start

No `npm install` or external packages required (uses Node's built-in HTTP server and browser-native `Intl` IANA time zone database):

```bash
npm start
```

Then open **http://localhost:4173** in your browser.

### Installing as a Desktop App (Windows / Linux / macOS)

1. Open https://chinmayacm.github.io/tz-convertor-ui/ (or `http://localhost:4173`) in **Chrome, Edge, Brave**, or **Safari (macOS)**.
2. Click **⬇ Install App** in the top-right corner (or the browser address bar's install icon).
3. Launch **ZoneShift** directly from your Windows Start Menu / Taskbar, Linux App Launcher, or macOS Dock — works 100% offline once installed.

## Running Tests & Production Build

```bash
npm test
npm run build
```

`npm run build` produces two outputs inside `dist/`:
- **Full PWA web directory** (`dist/`) — includes `robots.txt`, `sitemap.xml`, validated Schema.org JSON-LD, and `.nojekyll` ready for GitHub Pages or any static host (set `SITE_URL` env var to stamp a custom canonical domain).
- **Portable Single-File Bundle** (`dist/zoneshift-standalone.html`) — all CSS, JS, and vector icons inlined into a single offline `.html` file you can open directly on any OS without a server.

## GitHub Actions CI/CD

Two GitHub Actions workflows are included under `.github/workflows/`:

1. **Build, Artifacts & Releases** (`.github/workflows/build.yml`):
   - Runs automatically on pushes/PRs to `main` or `master`, manual `workflow_dispatch`, and `v*` version tags.
   - Uploads two downloadable build artifacts on every run:
     - `zoneshift-pwa-web` (`zoneshift-pwa.zip`)
     - `zoneshift-standalone-html` (`zoneshift-standalone.html`)
   - Pushing a version tag (e.g. `git tag v1.0.0 && git push origin v1.0.0`) automatically creates a GitHub Release with both downloadable files attached.
2. **Live PWA Hosting via GitHub Pages** (`.github/workflows/deploy-pages.yml`):
   - In your GitHub repo, go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
   - Every push to `main` or `master` automatically stamps `SITE_URL` and publishes the live installable PWA.

## Keyboard Shortcuts

- `/` or `Ctrl+K` / `Cmd+K` — Focus Quick Parse input (automatically re-opens Quick Parse if closed)
- `N` — Reset clock back to live `Now`
- `S` — Swap `From` and `To` zones in the 1-to-1 converter
- `Esc` — Close modal / blur input

## Data & Privacy Policy

- **Zero Servers, Tracking, or Cookies:** All time zone conversions run locally on your device using the built-in IANA Time Zone Database. No personal data, queries, or usage analytics leave your browser.
- **Local Storage Only:** Saved zone pairs, ★ favorite zones, pinned multi-zone rows, module visibility/order (`visibleModules`, `moduleOrder`), `12h/24h` format, and theme preferences are stored strictly inside your browser's `localStorage` under `zoneshift_prefs_v1` (plus static assets in Service Worker Cache Storage for offline startup).
- **One-Click Reset:** Open **🔒 Data & Privacy Policy** in the app header or footer and click **🗑 Clear Saved Data & Reset** anytime to wipe local preferences.
