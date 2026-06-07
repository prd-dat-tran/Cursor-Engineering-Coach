---
title: "Request Usage"
weight: 15
description: "Track how many requests you make, where they go, and whether you're on pace to run out before the cycle ends"
---

# Request Usage

Many teams on request-based plans run out of premium requests before the billing cycle ends. The **Request Usage** page exists to prevent that: it shows where your requests go, flags waste, projects when you'll run out, and gives concrete advice on stretching your allowance further.

It pairs with a **status bar gauge** (bottom-right of the IDE) so your remaining quota is always one glance away.

## Live request quota (opt-in)

By default, all analytics are computed from your local Cursor history with **no network calls**. The live quota is the one exception and is strictly opt-in.

When enabled, the page hero and the status bar show your real cycle usage pulled from Cursor's usage API using your local access token:

- **Used / limit** -- e.g. `34 / 500` requests this cycle
- **Days left** in the billing cycle
- **Per day** -- your current burn rate
- **Projected** -- where you'll land at this pace
- **Pace line** -- a plain-language verdict, e.g. *"On pace to run out ~8 days early (projected 520/500)"*

Enable it from the page's **Enable usage tracking** button, the `Enable Request Usage Tracking` command, or the `cursorEngineeringCoach.billing.fetchLiveUsage` setting. The token is used transiently for the request and never stored.

### Status bar gauge

A status bar item shows your live quota and refreshes automatically:

| State | Display |
|---|---|
| Healthy | `$(pulse) 34/500` |
| Approaching limit | `$(warning) 460/500` (yellow background) |
| At/over limit | `$(error) 500/500` (red background) |
| Not enabled | `$(pulse) Cursor usage` (click to enable) |

- **Refreshes** on startup, every 10 minutes, on window focus, and whenever billing/usage settings change. The `Refresh Request Usage` command forces an immediate update.
- **Tooltip** shows used/limit with percent, days left, burn rate, and the pace summary. Click it to open this page.
- **Notifications** fire at most once per cycle: when you cross **90%** used, or when you're projected to run out **2+ days early**. Toggle with `cursorEngineeringCoach.usage.notify`.
- **Visibility** is controlled by `cursorEngineeringCoach.usage.statusBar` (`auto` | `always` | `off`). `auto` shows it on request-based plans or once live usage is enabled.

## Where your requests go

### Waste cards

Three cards surface the requests that are easiest to recover:

| Card | What it means |
|---|---|
| **Cancelled requests** | Stopped mid-flight -- still counts as spend |
| **Lightweight / auto model** | On flat-rate billing a weaker model costs the same as the best one |
| **Frontier model** | Requests using a top-tier model -- what you should default to on request-based plans |

### Breakdowns

- **Requests per day** -- a bar chart of request volume across the selected range, so spikes are obvious.
- **By model** -- every model you used, its tier (Frontier / Lightweight / Auto), and request count.
- **By workspace** -- which projects consume your allowance (top 12).

### How to make requests go further

A tailored advice list adapts to your billing model and behavior. Typical tips:

- Pace warnings when you're projected to run over (or comfortably under).
- Cut cancellations -- scope the task with **Plan mode** before sending.
- On request-based billing: stop using lightweight/Auto models -- the strongest model is the same price, so reduce the *number* of requests, not the model.
- On usage-based billing: keep frontier models for hard work; light models for lookups.
- Batch related changes into one well-specified request instead of many one-line follow-ups; attach context with `@file` so the agent lands it first try.

## Settings & commands

| Setting | Default | Purpose |
|---|---|---|
| `cursorEngineeringCoach.billing.model` | `usage-based` | Your billing model (`usage-based` or `request-based`) |
| `cursorEngineeringCoach.billing.fetchLiveUsage` | `false` | Opt in to the live quota API call |
| `cursorEngineeringCoach.usage.statusBar` | `auto` | Status bar gauge visibility (`auto` / `always` / `off`) |
| `cursorEngineeringCoach.usage.notify` | `true` | One-time-per-cycle usage warnings |

| Command | What it does |
|---|---|
| `Cursor Engineering Coach: Open Request Usage` | Opens this page |
| `Cursor Engineering Coach: Enable Request Usage Tracking` | Opts in to live usage |
| `Cursor Engineering Coach: Refresh Request Usage` | Forces a live refresh |

## Privacy

The live quota is the only feature that makes a network call, it is off until you enable it, and it reuses the access token Cursor already stores locally. Everything else on this page is derived entirely from your local session history.
