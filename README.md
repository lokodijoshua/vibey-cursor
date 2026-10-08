# VibeyCursor

**Stop describing designs to AI. Start copying them.**

VibeyCursor is a Chrome extension for vibe coders. Hover over any element on any website, click it, and the element is converted into a detailed, pixel-faithful prompt your AI coding assistant can recreate — in Cursor, v0, Bolt, Lovable, or ChatGPT.

## How it works

1. **Install** — download the latest release below, unzip it, open `chrome://extensions`, enable Developer mode, and click **Load unpacked**.
2. **Hover** — flip VibeyCursor ON and hover any element. It highlights with its tag, ready to capture.
3. **Click** — the element is scanned (layout, typography, colors, spacing, structure) and a detailed prompt lands on your clipboard.
4. **Instruct (optional)** — every prompt ends with an `Instruction: []` line. Type what you want changed before pasting.
5. **Paste** — drop it into your AI assistant. The prompt tells the AI to update the existing elements in place across your site — never to bolt on a random duplicate.

## Features

- **Element capture** — any button, link, form, heading, card, or section becomes an AI-ready prompt
- **Section mode (Pro)** — capture entire component trees with hierarchy preserved
- **Screenshots (Pro)** — visual context attached to every capture
- **AI Enhance (Pro)** — server-side prompt rewriting tuned for code generation
- **History (Pro)** — every capture saved with its screenshot; click any image to copy it straight to your clipboard
- **Hide/show shortcut** — `Ctrl+Shift+H` hides the whole interface; `Ctrl+Shift+V` toggles capture mode
- **Privacy-first telemetry** — anonymous, metadata-only product analytics. No page content, prompts, or URLs ever leave your browser

## Download

Get the latest build here: https://github.com/lokodijoshua/vibey-cursor/releases/latest

Or visit the landing page: https://vibey-cursor-landing-page.vercel.app/

## Project layout

- `Extensions/` — the Chrome extension (MV3: content script, background worker, popup, side panel)
- `backend/` — Vercel API (licensing, entitlements, quotas, AI enhance, analytics ingest)
- `landing-page/` — marketing site and install guide
- `supabase/` — database migrations
- `figma-plugin/` — Figma import flow
- `docs/` — architecture and analytics documentation

## Privacy

Prompts are built locally in your browser. Servers store license records, quota counters (hashed, 24h), and anonymous telemetry (hashed, 30 days) — nothing else. See `landing-page/privacy-policy.html` for the full policy.
