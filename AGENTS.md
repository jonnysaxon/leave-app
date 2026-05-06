# AGENTS.md

Guidance for AI coding agents working on this repository.

## Project overview

A single-user **leave tracker** delivered as a static HTML/JS/CSS web app, hosted on **GitHub Pages**, and used primarily from an iPhone (added to the home screen as a PWA). It replaces a spreadsheet for tracking annual leave, sick leave, time-in-lieu (TOIL), etc.

The app is **client-only**. There is no backend. Data lives on the device, with optional sync to a private GitHub repo via the GitHub REST API.

## Goals

- Record balances for one or more leave types.
- Increment / decrement balances with a note and a date.
- Auto-accrue balances on a schedule defined per leave type (e.g. annual leave +X at the start of every month).
- Keep a full history of transactions, editable and deletable.
- Work offline, install to home screen, and prompt to update when a new version is deployed.
- Optionally sync the data file to a GitHub repo so the user can move between devices.

## Non-goals

- No multi-user support, no auth server, no backend database.
- No payroll/HR integrations.
- No native iOS app — this is a PWA only.

## Tech stack

- Plain **HTML + CSS + vanilla JavaScript** (or a very lightweight framework if it stays buildless — prefer no build step). No bundler is required; the site must work when served as static files from `/` on GitHub Pages.
- A **Service Worker** for offline caching and version checks.
- A **Web App Manifest** so it installs cleanly to the iOS home screen.
- No external runtime dependencies unless strictly necessary. If a small library is added, justify it in the PR description.

## Repository layout (target)

```
/
├── index.html              # App shell
├── manifest.webmanifest    # PWA manifest
├── service-worker.js       # SW: offline cache + version check
├── version.txt             # Plain text, single line: e.g. "1.4.2"
├── /assets/                # Icons, CSS, JS modules
│   ├── app.js
│   ├── styles.css
│   ├── storage.js          # localStorage + JSON import/export
│   ├── github.js           # GitHub sync (push/pull)
│   ├── accrual.js          # Accrual scheduling logic
│   ├── excel.js            # Excel export (uses SheetJS)
│   └── icons/              # PWA icons (incl. apple-touch-icon)
└── AGENTS.md
```

## Data model

All data is stored as a **single JSON document**. Same shape in localStorage, in exported files, and in the GitHub repo file.

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-06T08:30:00Z",
  "leaveTypes": [
    {
      "id": "annual",
      "name": "Annual Leave",
      "unit": "hours",            // "hours" | "days"
      "balance": 112.5,
      "accrual": {
        "enabled": true,
        "amount": 12.67,
        "frequency": "monthly",   // "monthly" | "weekly" | "fortnightly" | "yearly"
        "anchorDate": "2026-01-01", // first accrual date
        "lastAppliedDate": "2026-05-01"
      },
      "allowNegative": true
    }
  ],
  "transactions": [
    {
      "id": "uuid",
      "leaveTypeId": "annual",
      "date": "2026-04-22",       // date the leave was taken / added
      "delta": -7.5,              // negative = taken, positive = added
      "note": "Dentist appointment",
      "kind": "manual",           // "manual" | "accrual"
      "createdAt": "2026-04-22T18:00:00Z"
    }
  ],
  "settings": {
    "github": {
      "repo": "user/leave-data",  // owner/repo, must be private
      "branch": "main",
      "path": "leave.json",
      "token": "github_pat_..."   // fine-grained PAT, Contents: read/write on this repo only
    }
  }
}
```

Rules:
- `unit` is set when a leave type is created and is **immutable** thereafter (changing units mid-history would break balances).
- `balance` is the source of truth for display. Transactions are the audit trail. On any mutation, recompute or update `balance` consistently, and always bump `updatedAt`.
- Negative balances are allowed.

## Features

### Tabs

1. **Balances** — list of leave types with current balance and unit. Tap a type to see its history and accrual settings.
2. **Add / Adjust** — form to add or subtract from a leave type, with date (defaults to today), amount, and note.
3. **History** — chronological log of all transactions across all types, filterable by type. Each entry can be edited or deleted; edits and deletes recompute the balance.
4. **Settings** — manage leave types (create/edit/archive), GitHub sync config, version info, manual update check, manual JSON import/export, and **Excel export** (see below).

A **Sync** button is fixed at the bottom of the screen on all tabs. Tapping it pushes/pulls against the configured GitHub repo (see "GitHub sync"). Next to it sits an **Export to Excel** button (see "Excel export").

### Creating a leave type

Fields: name, unit (hours/days), starting balance, allow-negative toggle, and optional accrual config (enabled, amount, frequency, anchor date).

### Accrual

- Each leave type defines its own accrual schedule. Annual leave might be `+12.67 hours monthly` anchored to the 1st; TOIL might have no accrual.
- On app open (and after a successful pull), run the accrual engine: for each leave type with `accrual.enabled`, compute every accrual date strictly after `lastAppliedDate` and up to today, append one `kind: "accrual"` transaction per missed period, update `balance`, and set `lastAppliedDate` to the most recent applied date.
- Accrual transactions must be idempotent — running the engine twice on the same day must not double-apply.
- Show accrual transactions in History with a clear label so they can be distinguished from manual entries.

### GitHub sync

- Settings stores: `repo` (owner/repo), `branch`, `path` (default `leave.json`), and a **fine-grained personal access token** with `Contents: Read and write` scoped to that single private repo.
- The token lives **inside the JSON data file** at `settings.github.token`. This is acceptable because the file lives in a private repo only the user can read, and the token's scope is limited to that same repo (closed loop).
- The repo **must be private**. The app should warn loudly in Settings if the configured repo is public (call `GET /repos/{owner}/{repo}` and check `private: true` after the user enters config).
- Mask the token in the UI after entry (show last 4 chars only).
- Sync uses the GitHub Contents API (`GET/PUT /repos/{owner}/{repo}/contents/{path}`).
- The bottom-of-screen Sync button performs: pull remote → compare `updatedAt` → if remote is newer, replace local; if local is newer, push local (including the remote `sha`); if equal, no-op. Show a toast on success/failure.
- Always Base64-encode/decode the JSON content for the Contents API. Always send the current file `sha` on PUT to avoid clobbering.
- If no GitHub config is set, the Sync button is disabled with a tooltip pointing to Settings.
- On a 401 response, surface a clear "Token expired or invalid — update in Settings" message rather than a generic sync failure.

### Excel export

A bottom-of-screen **Export to Excel** button generates an `.xlsx` file the user can save or share via the iOS share sheet.

**Workflow:**
1. Tapping the button opens a small dialog asking for a **start month** and **end month** (default: earliest transaction month → current month).
2. App generates the file in-memory and triggers a download / share.

**Sheet layout (single sheet named `Leave Summary`):**

- **Column A:** `Month` — one row per month in the selected range, formatted `YYYY-MM` (e.g. `2026-04`), oldest at top.
- **Columns B onward:** two columns per leave type, in the order leave types are listed in the app:
  - `<Leave name> — Net (<unit>)` — sum of all transaction deltas in that month for that leave type. Blank if no activity.
  - `<Leave name> — Balance (<unit>)` — end-of-month balance for that leave type, computed by replaying transactions in date order from the beginning of history up to and including the last day of that month. Always populated, even for months with no activity.
- **Final column:** `Comments` — concatenated notes for every transaction in that month, across all leave types, formatted as:
  `2026-04-22 · Annual Leave · −7.5h · Dentist appointment; 2026-04-28 · Sick · −4h · Migraine`
  (date · leave type · signed delta with unit suffix · note). Semicolon-separated. Blank if no transactions in that month.

**Header row:** bold, frozen (freeze pane at row 2, column B). Column widths auto-sized to content where possible.

**Number formatting:**
- Hours → 2 decimal places.
- Days → 2 decimal places.
- Negative numbers shown with a leading minus, not parentheses.
- date format must be YYYY-MM-DD

**Implementation:**
- Use [SheetJS (`xlsx`)](https://www.npmjs.com/package/xlsx) loaded as a single ES module from a CDN, or vendored into `/assets/vendor/`. It's the lightest viable option for client-side `.xlsx` generation with no build step.
- Generate with `XLSX.utils.aoa_to_sheet` for full control over cell types, then `XLSX.writeFile` (or `XLSX.write` + Blob + `<a download>` for iOS Safari compatibility — `writeFile` doesn't always trigger the share sheet on iOS).
- File name: `leave-export-<startMonth>-to-<endMonth>.xlsx` (e.g. `leave-export-2026-01-to-2026-05.xlsx`).
- Archived leave types: include them as columns **only if** they had activity in the selected range.
- This feature must work fully offline (the SheetJS module is part of the cached app shell).
- The month selection for excel export must be a calendar selector.

### Versioning and updates

- The repo contains a top-level `version.txt` with a single semver line, e.g. `1.4.2`. Bump it on every deploy.
- The app embeds its build version as a constant `APP_VERSION` injected at build/deploy time (or hand-edited in `app.js` — keep it consistent with `version.txt` at release).
- The service worker periodically (and on app open) fetches `version.txt` with `cache: "no-store"`. If the remote version differs from `APP_VERSION`, post a message to the page; the page shows a non-blocking banner: "A new version is available — Update". Tapping Update unregisters the service worker, clears its caches, and reloads.
- Settings also has a manual **"Check for updates"** button that does the same check on demand, and a **"Force refresh"** button that always unregisters the SW and reloads.
- Display the current version in Settings.

### Offline behaviour

- The service worker pre-caches the app shell (HTML, CSS, JS, icons, manifest) so the app loads offline.
- `version.txt` and GitHub API calls are **never** cached — always network, fail gracefully when offline.
- All user data operations work fully offline; sync just becomes unavailable until connectivity returns.

### iOS / PWA polish

- Provide `apple-touch-icon` (180×180) and standard PWA icons (192, 512, maskable).
- Set `apple-mobile-web-app-capable`, status bar style, and a sensible theme color.
- Layout must work on iPhone widths down to 375px, respect safe-area insets (notch, home indicator), and keep the bottom Sync button above the home indicator using `env(safe-area-inset-bottom)`.
- All inputs must be tappable and usable one-handed; date pickers should use the native input.

## Coding conventions

- Vanilla JS, ES modules, no build step preferred. If you introduce one, document why.
- Keep modules small and single-purpose: `storage.js`, `github.js`, `accrual.js`, `ui/*.js`.
- Pure functions for accrual math and balance recomputation — they must be unit-testable without the DOM.
- No `eval`, no inline event handlers in HTML, no remote scripts (CSP-friendly).
- Format with Prettier defaults if a formatter is used. 2-space indent.
- Use `crypto.randomUUID()` for transaction IDs.

## Testing

- At minimum, hand-test on iOS Safari (installed to home screen) before each release.
- Pure logic (accrual scheduling, balance recomputation, GitHub merge decision) should have lightweight unit tests runnable in Node — even a single `test.html` page that imports the modules and asserts is acceptable given the no-build constraint.
- Always test: create leave type → take leave → edit a past transaction → delete a transaction → verify balance is correct at each step.

## Security and privacy

- The GitHub PAT lives inside the JSON data file at `settings.github.token`. This is acceptable **only because**:
  - The token is a fine-grained PAT scoped to a single private repo (`Contents: Read and write` on that repo only — no other permissions).
  - The repo it syncs to is private and owned by the user.
  - The token's blast radius is the same repo it lives in (closed loop).
- The app must **verify the repo is private** when the user saves GitHub settings, and warn loudly otherwise.
- **Manual JSON export** includes the token by design (so the user can bootstrap a new device by pasting one blob). Make this explicit in the export dialog: "This file contains your GitHub token. Treat it like a password."
- Recommend (in Settings UI copy) setting an expiry on the token (e.g. 1 year) and regenerating if the repo is ever accidentally made public.
- Never send data to any host other than `api.github.com` and the GitHub Pages origin itself.
- Never log the token. Mask it in the UI after entry (show last 4 chars only).

## Release checklist (for agents preparing a deploy)

1. Bump `APP_VERSION` in code **and** `version.txt` to the same value.
2. Update the service worker cache name (e.g. `leave-tracker-v1.4.2`) so old caches are evicted.
3. Verify `manifest.webmanifest` icon paths still resolve.
4. Open the deployed Pages URL on iPhone, hard-reload, confirm the update banner appears for users on the previous version.
5. Confirm Sync still round-trips against the configured repo.

## Open questions for the human

- Should archived/deleted leave types be hidden but kept in history, or fully removed? (Current assumption: hidden, history preserved.)
- Should accrual ever be capped (e.g. annual leave can't exceed N days)? Not currently modelled — add a `cap` field to `accrual` if needed.
- Time zone handling for `date` on transactions: currently treated as a local calendar date string (`YYYY-MM-DD`) with no TZ. Confirm before changing.
