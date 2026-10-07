# VibeyCursor — Behavior Analytics (product intelligence)

> Metadata only. No prompts, HTML, input values, keystrokes, or raw URLs
> ever leave the device. Identifiers are hashes/ids. Retention: 30 days.

## Pipeline

Extension (`Extensions/analytics.js`: in-memory + `chrome.storage.local`
queue, cap 200, drop-oldest) → background SW flush (every 5 min via
`analytics-flush` alarm + 5s-debounced hint when queue ≥ activity,
batch ≤ 50, exponential backoff 1m→30m, max 3 retries, offline stays
queued) → `POST /api/analytics` (`backend/api/analytics.js`, returns
202, never blocks product) → `analytics_events`
(`supabase/migrations/20261007000001_analytics_events.sql`).

Client calls are fire-and-forget (`vcTrack` / `spTrack`): the capture,
copy, and enhance paths never `await` analytics. If analytics fails,
the product keeps working.

## Event catalog (allowlisted server-side)

`inspector_toggled`, `element_highlighted` (sampled 1:50 client-side —
never a request per hover), `vibey_shown`, `vibey_hidden`,
`capture_started`, `capture_completed`, `capture_denied`,
`capture_failed`, `prompt_generated`, `prompt_copied`, `json_copied`,
`json_locked`, `enhance_requested`, `enhance_completed`,
`enhance_failed`, `history_opened`, `history_item_copied`,
`history_item_deleted`, `upsell_shown`, `upsell_clicked`,
`license_activated`, `license_deactivated`, `shortcut_used`,
`tool_deactivated`.

Funnel: `capture_started → capture_completed → prompt_copied →
enhance_requested → enhance_completed`, with abandonment visible at
each step (`capture_denied`, missing downstream events).
`inspector_toggled` on without `capture_started` = activation with no
capture.

## Element taxonomy (13 values, allowlisted)

`button`, `link`, `media`, `heading`, `text`, `form-field`, `form`,
`navigation`, `section`, `component`, `list-table`, `modal`, `other`.
Classifier: `elementTypeFromTag()` in `Extensions/content.js`
(informational only — server never trusts it for billing/security).

## Heatmap-ready metadata (per event, best-effort)

`viewport_w/h`, normalized center `norm_x/y`, `el_w/h`, `tag`, `mode`,
`prompt_chars` (length only), `hostname_hash` (sha256 of hostname;
raw hostname is hashed server-side and never stored), `session_id`,
`installation_hash` (sha256), `license_id` + authoritative `plan`
(resolved server-side via `findLicense` — client plan never trusted).

## Privacy rules

- `installationId` → `installation_hash` (sha256); raw never stored.
- Hostname → `hostname_hash`; raw dropped. No full URLs, no page HTML.
- `ANALYTICS_MAX_BATCH = 50`, `ANALYTICS_DAILY_CAP = 1000` per
  installation per rolling 24h (`backend/lib/config.js`).
- No admin panel yet — data foundation only; visualization is a
  separate decision once event flow is confirmed.

## Keyboard shortcut (related)

`Ctrl+Shift+H` (`toggle-vibey-ui` in `Extensions/manifest.json`) is a
visibility-only toggle (`setUIVisible()` in `Extensions/content.js`):
hides/shows overlay + controls, persists `vcUIVisible`, never touches
capture mode, license, history, or session. If the suggested key
collides with another extension, Chrome leaves it unbound — remap at
`chrome://extensions/shortcuts`.

## Icon system (related)

Single inline-SVG set (`Extensions/icons.js`, 16px viewBox, 1.8px
stroke, `currentColor`): history, spark, lock, check, checkCircle, box,
frame, copy, code, trash, chevL, chevR, arrowR. No emoji/unicode
symbols remain in `Extensions/` UI. No dependency added.
