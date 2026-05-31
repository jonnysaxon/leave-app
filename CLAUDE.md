# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

> A detailed product/spec document already exists in [`AGENTS.md`](./AGENTS.md). Read it
> for the full feature spec, data model, and security rules. This file focuses on the
> **actual current implementation** and the practical workflow for changing it.

## What this is

A single-user **leave tracker** PWA: a static HTML/CSS/vanilla-JS web app with **no build
step** and **no backend**. It is served as static files (GitHub Pages) and used mainly from
an iPhone home screen. Data lives in `localStorage` as one JSON document, with optional sync
to a private GitHub repo via the GitHub REST API.

Key constraints:

- **No build, no bundler, no framework.** Plain ES modules loaded directly by the browser.
  The site must work when served as static files from `/`.
- **No runtime dependencies** except SheetJS, which is vendored at
  `assets/vendor/xlsx.full.min.js` (not from a CDN) so Excel export works offline.
- Must work fully **offline** via the service worker; only `version.txt` and `api.github.com`
  bypass the cache.

## File map

```
index.html               App shell: all tabs/markup, registers the service worker
manifest.webmanifest     PWA manifest
service-worker.js        Offline app-shell cache + version-check messaging
version.txt              Single semver line (currently 0.1.4)
assets/
  app.js                 UI controller: DOM wiring, tab rendering, event handlers, calendar
  storage.js             localStorage load/save, normalize, balance recompute, backups,
                         JSON import/export, merge logic, formatting helpers
  accrual.js             Pure accrual scheduling math (applyAccruals, accrualDates, ...)
  github.js              GitHub sync (verifyPrivateRepo, syncData) via Contents API
  excel.js               Excel export (buildSummaryRows + SheetJS), month-range defaults
  styles.css             All styling (mobile-first, safe-area insets)
  vendor/xlsx.full.min.js  Vendored SheetJS for offline .xlsx generation
  icons/                 PWA icons (SVG: icon-192, icon-512, apple-touch-icon)
tests/
  logic.test.mjs         Node unit tests for the pure logic modules
```

## Architecture notes

- **`app.js` is the only module that touches the DOM.** `storage.js`, `accrual.js`,
  `github.js`, and `excel.js` are kept DOM-free and pure where possible so they can be unit
  tested in Node. Keep new business logic in those modules, not in `app.js`.
- **Single source of truth:** all state is one JSON document (`schemaVersion: 1`) stored
  under the `localStorage` key `leave-tracker:data`; backups live under
  `leave-tracker:backups`. `balance` is displayed; `transactions` are the audit trail.
  After any mutation, keep `balance` consistent (`recomputeBalances`) and bump `updatedAt`
  (`touch`).
- **Versioning:** `APP_VERSION` is a constant in `assets/app.js` and the `CACHE_NAME` in
  `service-worker.js` (`leave-tracker-v<version>`). Both must match `version.txt` on every
  release. The service worker fetches `version.txt` with `cache: "no-store"` and posts a
  `VERSION_AVAILABLE` message to the page when it differs.
- **Accrual** must stay idempotent — running the engine twice in a day must not double-apply.
  Accrual transactions use `kind: "accrual"`.
- **GitHub sync** only ever talks to `api.github.com`. The fine-grained PAT lives inside the
  data JSON at `settings.github.token`; never log it, always mask it in the UI, and warn if
  the configured repo is not private. See the Security section of `AGENTS.md`.

## Running and testing

No package manager is configured (there is no `package.json`).

- **Run the app locally:** serve the repo root with any static server and open it, e.g.
  `python3 -m http.server 8000` then visit `http://localhost:8000/`. A service worker needs
  a real origin (localhost is fine); opening `index.html` via `file://` will not work.
- **Run the unit tests:** `node --test tests/` (uses the built-in `node:test` runner; no
  install step).

After changing any pure-logic module, run the tests. After UI changes, hand-test the
affected tab — the spec lists the core flow: create leave type → take leave → edit a past
transaction → delete a transaction → verify the balance at each step.

## Conventions

- Vanilla ES modules, 2-space indent, Prettier defaults. No `eval`, no inline event handlers
  in HTML, no remote scripts (CSP-friendly).
- Use `crypto.randomUUID()` for transaction IDs.
- Keep modules small and single-purpose; keep logic testable without the DOM.
- Dates on transactions are local calendar strings (`YYYY-MM-DD`), no timezone.

## Releasing

When preparing a deploy, keep these three in lockstep and follow the release checklist in
`AGENTS.md`:

1. `APP_VERSION` in `assets/app.js`
2. `CACHE_NAME` in `service-worker.js`
3. `version.txt`
