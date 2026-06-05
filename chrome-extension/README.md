# VibeMeGood Sync — Chrome Extension

Auto-syncs your PrizePicks lines to the VibeMeGood Workstation on a schedule.
No server-side fetching, no PerimeterX fights — runs inside your logged-in Chrome
browser where your PP session already exists.

## How it works

When the alarm fires, the extension finds an open `prizepicks.com` tab in your
browser, runs the sync fetch inside that tab (using your real PP cookies), and
POSTs the lines directly to your Workstation API. Identical to the bookmarklet —
just automatic.

## Install (one time)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this `chrome-extension` folder
5. The ⚡ VibeMeGood icon will appear in your Chrome toolbar

> **Tip:** Pin it to your toolbar by clicking the puzzle-piece icon → pin ⚡

## Setup

1. Click the ⚡ extension icon
2. In the **Workstation URL** field, paste the URL of your VibeMeGood app
   - Example: `https://yourname.replit.app`
   - Find it by opening the app in Chrome and copying the address bar URL (just the origin — no `/api/` path)
3. Choose an auto-sync interval (default: every 15 min)
4. Click **Save Settings**
5. Click **⚡ Sync Now** to test it

## Requirements

- Chrome must be open and you must have a `prizepicks.com` tab open for syncing to work
- You must be logged into PrizePicks in that tab
- The Workstation app must be running (Replit workflow active)

## Badge meanings

| Badge | Meaning |
|-------|---------|
| ✓ (green) | Last sync succeeded |
| ! (red) | Last sync failed — click to see error |
| PP? (yellow) | No prizepicks.com tab found — open PP in Chrome |
| SET (yellow) | Workstation URL not configured yet |
| ... (purple) | Sync in progress |
| OFF (gray) | Auto-sync disabled |

## Safari on iPhone

Use the **bookmarklet** built into the VibeMeGood app:

1. Open VibeMeGood → **Settings** page
2. Find the "PrizePicks Browser Import" section
3. Drag the **Sync Workstation** link to your Safari bookmarks bar
   (or long-press it on mobile and tap Add to Bookmarks)
4. When you want to sync from your iPhone: open `app.prizepicks.com`,
   then tap the bookmark — it syncs in one tap

The bookmarklet is the phone-equivalent of this extension.

## Troubleshooting

**"PrizePicks returned 403"** — You're not logged in to PrizePicks. Log in first.

**"Workstation returned 500"** — The Workstation API hit an error processing the
feed. Check the Workstation's Settings → Data Health page for details.

**"Script injection failed"** — Rare. Try reloading the prizepicks.com tab and
clicking Sync Now again.

**PP tab is open but still shows "PP?"** — Make sure the tab is fully loaded
(not a login redirect). The extension matches `*.prizepicks.com/*`.
