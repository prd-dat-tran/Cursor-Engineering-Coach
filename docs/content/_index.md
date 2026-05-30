---
title: "Home"
---

## Privacy First

Cursor Engineering Coach is entirely **read-only** and ships with **zero telemetry**. It parses log files that already exist on your machine and never sends data anywhere. Your usage data stays local.

## Built for Cursor

Cursor Engineering Coach analyzes your Cursor IDE sessions — chat conversations, agent runs, generated code, rules files, and MCP server interactions — and turns them into actionable coaching feedback. See [Cursor Sources]({{< ref "getting-started/cursor-sources" >}}) for the exact files it reads.

## How It Works

Cursor Engineering Coach runs as a Cursor extension. On activation, it scans your local Cursor workspace storage, parses every session into structured data, and renders an interactive webview panel with dashboards, charts, and actionable findings. The analysis pipeline is organized around three areas: **Observe**, **Measure**, and **Improve**, plus a **Level Up** section that turns your data into a progression system.

## Editable Rule Engine

Anti-pattern detection is driven by an editable rule engine. Each detector is a markdown file with YAML frontmatter and a small DSL that you can inspect, tune, and extend. The [Rule Editor](/improve/rule-editor/) lets you live-test changes against your own data, and an AI builder can scaffold new rules from a natural-language description. The [Rule Playground](/improve/rule-playground/) is an interactive REPL for the DSL, and the [Data Explorer](/improve/data-explorer/) shows every field and distribution the rules can key off.
