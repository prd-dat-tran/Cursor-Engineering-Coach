---
title: "Changelog"
weight: 25
description: "Cursor's official release notes, summarized in-IDE, with new-release notifications"
---

# Changelog

The Changelog page brings Cursor's official [changelog](https://cursor.com/changelog) into the dashboard, summarized for your team so everyone can keep up with new features, models, and pricing changes without leaving the editor.

## What it shows

Entries are pulled from Cursor's public changelog feed and rendered newest-first. Each release shows:

- **Date and title** of the release.
- **A short summary** of what shipped.
- **Highlights** — the section headings from the release, so you can scan what changed at a glance.
- **A "Read on cursor.com" link** that opens the full post in your browser.

Releases you haven't seen yet since you last opened the page are flagged with a **New** badge. Opening the page marks everything as read.

## Notifications

When Cursor publishes new entries, the extension shows a one-time notification (e.g. *"Cursor shipped 2 new updates — latest: …"*). Click **View Changelog** to jump straight to the page.

The check runs in the background, throttled to a few times a day, and only ever makes an **unauthenticated request to Cursor's public changelog feed** (`https://cursor.com/changelog/rss.xml`) — no token, no usage data, nothing about you is sent. Turn notifications (and the background check) off with the setting below; you can still open the Changelog page on demand.

| Setting | Default | Effect |
|---|---|---|
| `cursorEngineeringCoach.changelog.notifications` | `true` | Show new-release notifications and run the background feed check. |

You can also open the page anytime with the command **Cursor Engineering Coach: Open Cursor Changelog**.

## For maintainers: keeping the coach accurate

Cursor Engineering Coach keeps the volatile facts it reasons about — model request-cost multipliers, per-token rates, and plan credits — in a single bundled manifest, `src/core/data/cursor-facts.json`. **Fact sync is intentionally manual:** only a maintainer updates that file, so the numbers the coach quotes are always reviewed.

The Changelog page is the trigger. When a release changes models, pricing, or plans, a maintainer re-syncs the manifest:

```bash
npm run facts:refresh   # regenerate from Cursor's Models & Pricing docs
npm run check           # validate (schema + invariants) and lint/test
```

Then review the diff (especially new models and token rates), commit, and open a PR. You can also run the **Refresh Cursor Facts** GitHub Action manually instead of running the script locally. The bundled manifest ships in the next extension release — there is no runtime auto-refresh.
