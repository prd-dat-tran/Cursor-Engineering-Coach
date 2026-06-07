---
title: "Models"
weight: 20
description: "See which models you use, how they map to request cost, and get best-fit recommendations balancing effectiveness and billing"
---

# Models

Choosing the right model for the work in front of you is one of the highest-leverage habits in Cursor -- it drives both the quality of the output and what you pay. The **Models** page collects every model you've actually used, scores how well each one fits the work you sent it, and gives best-fit recommendations tuned to *your* billing model.

It answers two questions your team keeps asking:

- *"Which model should I use for this task?"*
- *"Am I wasting requests (or tokens) on the wrong model?"*

## Model classes and request cost

Every model in Cursor maps to a **request-cost multiplier**. The Models page groups them into capability/cost classes derived from that multiplier:

| Class | Multiplier | What it means |
|---|---|---|
| **Frontier** | > 1x | Most capable, highest per-request cost (e.g. the largest Opus / GPT reasoning models) |
| **Standard** | 1x | The dependable everyday agentic workhorses (e.g. Claude Sonnet, GPT mid-tier) |
| **Light** | < 1x | Cheaper, faster, weaker reasoning -- good for lookups and small edits |
| **Free** | 0x | Included models that don't draw down premium requests |
| **Auto** | -- | Cursor picks the model for you |

How the multiplier translates into money depends entirely on your plan, which is why this page is **billing-aware**.

## Billing-aware recommendations

The headline and top pick change based on the billing model the coach has detected (or that you set in settings):

- **Request-based billing (per-request plans)** -- Every request costs the same flat amount no matter which model handles it. The economically *correct* move is to **default to the most capable model** and reduce the *number* of requests, not to downgrade the model. The page nudges you toward frontier/standard models and flags light/Auto usage as leaving capability on the table.
- **Usage-based billing (token plans)** -- Model choice directly affects cost, so the advice flips: reach for capable models on hard, multi-step work where rework would be expensive, let **Auto** or Cursor's own **Composer 2.5** handle everyday work from the cheaper included usage pool, and keep light models for lookups and small edits. The page flags expensive models used on trivial work.
- **Unknown** -- The page shows balanced guidance and links you to set your billing model so advice gets sharper.

> Set your plan under **Settings → Cursor Engineering Coach → Billing**, or let the coach auto-detect it from your Cursor membership.

## What the page shows

### Your model mix

A summary of how your model-bearing requests are distributed: the share running on frontier/standard models, the share on light/free models, the share routed to **Auto**, and your overall cancellation rate. This is the fastest way to spot a mismatch between your plan and your habits.

### Per-model table

Every model you've used in the selected range, most-used first, with:

- **Requests** and **share** of your model-bearing traffic
- **Avg AI lines of code** produced per request (an effectiveness proxy)
- **Cancel rate** -- how often you stopped that model mid-flight
- **Agentic share** -- how much of that model's work involved tools and real edits
- A **verdict** -- a one-line, billing-aware judgement (e.g. *"Strong choice"*, *"Underpowered for your plan"*, *"Pricey for light work"*)

### Task cheat-sheet

A task → model recommendation table -- complex feature/refactor/debugging, everyday coding, quick lookups, and so on -- with the recommended models and a short note explaining the trade-off for your plan.

### Model catalog

A curated reference of notable models available in Cursor, each with its class, request multiplier, and a "best for" description. Models you've already used are marked so you can see what you haven't tried yet.

## Coaching rules

Two anti-pattern rules back the Models page and surface in **Anti-Patterns** and the `@coach` chat:

- **Underpowered model on a per-request plan** -- On request-based billing, defaulting to a light model (or Auto) costs the same as a frontier model but delivers weaker results. Flagged so you switch your default up.
- **Light model on complex work** (usage-based) -- Routing long, multi-tool, multi-edit work to an under-powered model to "save tokens" usually backfires: weak reasoning causes rework that burns more tokens than a capable model would have.

Both rules are tuned to only fire when there's a meaningful sample, so they reflect a habit rather than a one-off.

## Why it matters

Most teams that run out of premium requests mid-cycle aren't using Cursor too much -- they're using the *wrong model* for the work, cancelling and retrying, or letting Auto pick when a deliberate choice would land it first try. The Models page turns "pick a good model" from a guess into a data-backed, plan-aware decision.
