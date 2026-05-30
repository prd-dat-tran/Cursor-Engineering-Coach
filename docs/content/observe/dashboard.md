---
title: "Dashboard"
weight: 10
description: "Your Cursor IDE overview at a glance"
---

# Dashboard

The Dashboard is the landing page of Cursor Engineering Coach. It brings together the most important metrics and recommendations into a single view.

![Cursor Engineering Coach Dashboard](/screenshots/screen-dashboard.png)

## Practice Scores

Five score cards are displayed at the top of the dashboard, each computed from the anti-pattern detection system:

| Score | What it measures |
|---|---|
| **Prompt Quality** | How well you provide context to Cursor (file references, open editors, specificity) |
| **Session Hygiene** | Whether you start fresh sessions, avoid overly long conversations, and use devcontainers |
| **Code Review** | How carefully you review, validate, and sandbox Cursor's generated output |
| **Tool Mastery** | How broadly you use available Cursor features (modes, slash commands, model selection) |
| **Context Management** | How efficiently your sessions use the available context window |

Each score ranges from 0 to 100 and includes week-over-week and month-over-month trend indicators. Clicking a card navigates to the detailed Anti-Patterns view for that category.

## Skill Finder

The dashboard includes an inline preview of the Skill Finder. It scans your prompt history for repeated patterns and surfaces two types of findings:

- **Custom Opportunities** -- Repeated prompts that could be turned into reusable Cursor rules or skills
- **Community Matches** -- Matching picks from the community-maintained Cursor rules catalog

## Daily Activity

A bar chart shows requests, sessions, lines of code, and active workspaces over the selected time range. Tabs let you switch between these metrics. Below the chart, donut charts break down activity by workspace and by agent mode (agent vs. ask).
