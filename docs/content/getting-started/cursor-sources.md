---
title: "Cursor Sources"
weight: 20
description: "What Cursor Engineering Coach reads from your local machine"
---

# Cursor Sources

Cursor Engineering Coach reads local files written by Cursor IDE. No network requests are made; all data stays on your machine.

## Cursor IDE Sessions

The primary data source. Cursor Engineering Coach parses chat panel and agent logs that Cursor writes to its workspace storage directory. This captures every request, response, model used, token counts, tool calls, file references, and terminal commands.

**Default locations:**

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Cursor/User/workspaceStorage/` |
| Linux | `~/.config/Cursor/User/workspaceStorage/` |
| Windows | `%APPDATA%\Cursor\User\workspaceStorage\` |

**What is tracked:**

- Requests and responses with timestamps
- Model selection (e.g., `claude-sonnet-4`, `gpt-5`, `auto`)
- Tool calls and slash commands used
- File context references (`@file`, open editor tabs)
- Terminal command execution
- Turn-by-turn conversation structure
- Agent mode versus ask mode

## Cursor Rules

Cursor Engineering Coach inspects rules files in each workspace to score context quality and agentic readiness:

- `<workspace>/.cursor/rules/*.mdc` — modern Cursor project rules (plain `.md` here is ignored by Cursor)
- `<workspace>/AGENTS.md` — universal agent instruction file
- `<workspace>/.cursorrules` — legacy single-file rules

## MCP Configuration

To score MCP server adoption, the following config locations are read:

- `<workspace>/.cursor/mcp.json` — workspace MCP servers
- Global Cursor MCP config — system-wide MCP servers

## Hooks and Skills

If present, the following files contribute to the agentic readiness checklist:

- `<workspace>/.cursor/hooks.json` — Cursor hooks configuration
- `<workspace>/.cursor/skills/` — workspace-scoped Cursor skills

## Workspace Filtering

You can filter analytics to a single workspace or view aggregated data across all workspaces. The bottom-left panel in the UI provides a workspace selector.
