---
title: "Context Health"
weight: 30
description: "Evaluate context quality and window management"
---

# Context Health

The Context Health page has two tabs: **Context Quality** and **Context Management**. Together, they evaluate how well your workspaces are configured for Cursor's agent and how efficiently your coding sessions use the context window.

## Context Quality

![Context Quality](/screenshots/screen-context-quality.png)

The Context Quality tab assesses your workspace readiness for Cursor's agent. It scores your setup across several dimensions:

### Agentic Readiness

Eight signals are checked to determine whether your projects are prepared for agentic Cursor workflows:

| Signal | What it checks |
|---|---|
| **Rules Files** | Whether workspaces have `.cursor/rules/*.mdc`, `AGENTS.md`, or a legacy `.cursorrules` file |
| **Custom Skills** | Whether any custom skill definitions exist under `.cursor/skills/` |
| **Custom Agents** | Whether custom agent definitions are configured |
| **Prompt Templates** | Whether `.prompt.md` files are present |
| **Hooks (Pre/Post)** | Whether `.cursor/hooks.json` defines hook scripts for automated workflows |
| **Dev Container** | Whether a `.devcontainer/devcontainer.json` exists for sandboxed execution |
| **MCP Servers** | Whether `.cursor/mcp.json` or a global Cursor MCP config is present |
| **Context Freshness** | Whether rules and context files are up to date |

Each signal contributes points to the overall score.

### Context Provision by Mode

A table shows how context is provided across each Cursor mode (agent vs ask), including:

- Request count
- File reference percentage
- Instruction attachment rate
- Skills and tools usage percentage
- Average context per request

### Workspace Context Map

A treemap visualization where tile size represents request volume and tile color represents the rules-file quality score. This lets you spot which workspaces get the most Cursor usage and which ones lack proper context configuration.

### Review Context Files (AI)

When an [AI provider](/getting-started/ai-provider/) is configured, **Review Context Files** reads each workspace's context files (`AGENTS.md`, `.cursor/rules/*.mdc`, and friends) and returns a graded report card per workspace:

- An **overall score** (0--100) and a matching **letter grade** -- the grade is derived directly from the score (≥90 = A, ≥80 = B, ≥70 = C, ≥60 = D, below = F), so the two always agree.
- Per-category scores (clarity, specificity, structure, completeness, staleness, redundancy, actionability).
- Findings flagged as good, warning, or critical, each with a concrete suggestion.

#### Auto-fix with AI

Any card with warnings or critical findings shows an **Auto-fix with AI** button. It asks your configured provider to draft ready-to-save content for the affected context file (for example a stronger `AGENTS.md`), shows you a preview, and then opens it in **Cursor Chat** so you can review and apply it. The extension never writes to your project files directly -- you stay in control of every change, mirroring the **Create Skill** flow in the [Skill Finder](/improve/skill-finder/).

## Context Management

![Context Management](/screenshots/screen-context-management.png)

The Context Management tab analyzes how efficiently your Cursor sessions use the available context window.

### Key Metrics

- **Context Score** -- Overall efficiency rating (0-100)
- **Compactions** -- Number of times the context window was auto-compacted because it ran out of space

### Context Utilization Trend

A weekly chart showing average context utilization percentage and compaction events over time. High utilization with frequent compactions suggests you need shorter, more focused sessions.

### Per-Workspace Context Session Health

A detailed table with per-session breakdowns for each workspace:

| Column | Meaning |
|---|---|
| Score | Overall session health score |
| Verdict | Optimal, Degraded, or Critical |
| Avg Tokens | Average context window token count |
| Avg Util | Average context utilization percentage |
| Saturation | How close the window gets to its limit |
| Cost Eff. | Ratio of output to context consumed |
| Compactions | Number of auto-compaction events |

Click a workspace row to expand inline session-level details with per-session verdicts, token curves, and event counts.

### Insights

Cursor Engineering Coach generates context-specific recommendations when it detects issues. These appear in an Insights box above the charts. Examples:

- "Context is running high in some workspaces. Start new sessions before auto-compaction kicks in."
- "58 compaction events detected. Manually compact at natural breakpoints."
