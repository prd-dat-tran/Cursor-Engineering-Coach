<h1 align="center">Cursor Engineering Coach</h1>

<p align="center">
Analyze your Cursor IDE usage — chat sessions, agent runs, generated code, and context health.
</p>

<p align="center">
<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
<img alt="Cursor IDE" src="https://img.shields.io/badge/Cursor-IDE-000000">
</p>

## Highlights

The extension is organized into four sections: **Observe**, **Measure**, **Improve**, and **Level Up**.

### Observe

| Page | What it shows |
| --- | --- |
| **Dashboard** | Practice scores with week-over-week and month-over-month trends, skill finder summary, daily activity chart, and top workspace stats |
| **Timeline** | Gantt-style session timeline with per-day drill-down, session overlap detection, and a searchable list view |
| **Coding Moments** | Screenshot gallery from your Cursor sessions with story reels, workspace filtering, and progressive image loading |

### Measure

| Page | What it shows |
| --- | --- |
| **Output** | Two tabs -- **Code Output** (generated code volume by language and workspace) and **Token Usage** (model usage table with per-model token breakdown) *(Token Usage temporarily hidden)* |
| **Burndown** | Monthly usage budget progress with projection *(temporarily disabled)* |
| **Patterns** | 7x24 activity heatmap and work-life balance signals |

### Improve

| Page | What it shows |
| --- | --- |
| **Anti-Patterns** | Five practice score cards (Prompt Quality, Session Hygiene, Code Review, Tool Mastery, Context Management) with detailed findings, severity ratings, concrete actions, and example prompts |
| **Skill Finder** | Analysis of repeated prompts to discover custom Cursor rule and skill opportunities, plus matching community entries from the open-source catalog |
| **Context Health** | Overall context score, agentic readiness checklist, workspace context map (treemap colored by rules-file quality), and AI-powered rules-file review |
| **Rule Editor** | Create, edit, and live-test detection rules as markdown with form-based or raw-source editing and AI-assisted drafting |
| **Rule Playground** | Interactive REPL for the rule DSL with field browser, function catalog, and metric list |
| **Data Explorer** | Browse request and session fields, view distributions, and run ad-hoc filters |

### Level Up

| Page | What it shows |
| --- | --- |
| **Learning Center** | Personalized quizzes and code-comparison rounds generated from your actual usage |
| **Achievements** | XP-based progression with Bronze, Silver, Gold, and Diamond tiers |
| **Agentic SDLC** | Track how you use Cursor across the full software-development lifecycle |
| **Share** | Generate a shareable stat card and export Markdown/JSON summaries |

## Cursor Session Sources

Cursor Engineering Coach reads the following data from your local machine. No network requests are made.

| Source | Default location |
| --- | --- |
| **Cursor IDE** | macOS: `~/Library/Application Support/Cursor/User/workspaceStorage/`<br>Linux: `~/.config/Cursor/User/workspaceStorage/`<br>Windows: `%APPDATA%\Cursor\User\workspaceStorage\` |
| **Cursor Rules** | `<workspace>/.cursor/rules/*.md` and `<workspace>/AGENTS.md` |
| **MCP Servers** | `<workspace>/.cursor/mcp.json` and the global Cursor MCP config |

## Getting Started

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Run **Cursor Engineering Coach: Open Dashboard**.
3. Use the sidebar to navigate pages. Filter by workspace at the bottom.
4. Run **Cursor Engineering Coach: Reload Data** to re-parse after new sessions.

## License

[MIT](LICENSE)

## Disclaimer

This project is an open-source community fork of [microsoft/AI-Engineering-Coach](https://github.com/microsoft/AI-Engineering-Coach), retargeted to work exclusively with Cursor IDE. It is **not** an official Cursor product and is not affiliated with Anysphere or Microsoft. It is provided as-is with no warranties or guarantees.
