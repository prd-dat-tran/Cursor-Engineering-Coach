<h1 align="center">Cursor Engineering Coach</h1>

<p align="center">
<strong>better agentic engineering — for Cursor.</strong><br>
Analyze your Cursor IDE usage and turn it into an actionable coaching dashboard.
</p>

<p align="center">
<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
<img alt="Cursor IDE" src="https://img.shields.io/badge/Cursor-IDE-000000">
</p>

<br>

---

## What it does

Cursor Engineering Coach reads your local Cursor session logs and turns them into actionable insights — no data leaves your machine.

- **Track progress** — practice scores, weekly trends, daily activity charts
- **Detect anti-patterns** — 45 rules across prompt quality, session hygiene, code review, tool mastery, and context management
- **Measure output** — generated code volume by language, workspace, and model
- **Discover skills** — find repeated prompts and turn them into reusable Cursor rules and skills
- **Score context health** — agentic readiness checks, rules-file audits, workspace context maps

<details>
<summary><strong>Screenshots</strong></summary>
<br>
<p align="center"><img src="assets/screen-timeline.png" alt="Timeline" width="820"></p>
<p align="center"><img src="assets/screen-output.png" alt="Code Output" width="820"></p>
<p align="center"><img src="assets/screen-consumption.png" alt="Premium Request Consumption" width="820"></p>
<p align="center"><img src="assets/screen-patterns-projects.png" alt="Activity Patterns - Projects" width="820"></p>
<p align="center"><img src="assets/screen-patterns-workhours.png" alt="Activity Patterns - Work Hours" width="820"></p>
<p align="center"><img src="assets/screen-antipatterns.png" alt="Anti-Patterns" width="820"></p>
<p align="center"><img src="assets/screen-skill-finder.png" alt="Skill Finder" width="820"></p>
<p align="center"><img src="assets/screen-context-quality.png" alt="Context Quality" width="820"></p>
<p align="center"><img src="assets/screen-context-management.png" alt="Context Management" width="820"></p>
<p align="center"><img src="assets/screen-learning.png" alt="Learning Center" width="820"></p>
<p align="center"><img src="assets/screen-achievements.png" alt="Achievements" width="820"></p>
<p align="center"><img src="assets/screen-sdlc.png" alt="Agentic SDLC" width="820"></p>
<p align="center"><img src="assets/screen-share.png" alt="Share Your Stats" width="820"></p>
</details>

---

## Installation

Cursor Engineering Coach ships as a Cursor extension. Choose one of these paths.

### Path 1 — Prebuilt VSIX (easiest)

Prerequisites:

- Cursor IDE
- Access to the repository Releases page

Steps:

1. Download the latest `cursor-engineering-coach-*.vsix` from Releases.
2. Install it in Cursor:

**macOS / Linux**

```bash
cursor --install-extension cursor-engineering-coach-*.vsix
```

**Windows / PowerShell**

```powershell
cursor --install-extension (Get-ChildItem . -Filter 'cursor-engineering-coach-*.vsix' | Select-Object -First 1).FullName
```

### Path 2 — Dev Container build (no local Node.js/npm)

Prerequisites:

- Cursor IDE
- Dev Containers extension
- Docker or Podman

Steps:

1. Clone the repo and open it in Cursor.
2. Reopen in container.
3. Run:

```bash
npm ci
npm run package
```

4. Install the generated `.vsix` using one of the commands above.

### Path 3 — Local build

Prerequisites:

- Cursor IDE
- Node.js and npm

Steps:

```bash
git clone https://github.com/prd-dat-tran/Cursor-Engineering-Coach.git
cd Cursor-Engineering-Coach
npm ci
npm run package
```

Then install the generated `.vsix` using one of the commands above.

### Release permissions and contribution path

If you do not have permission to publish a Release artifact, open a PR with your changes and ask a maintainer to publish the `.vsix` in Releases.

After install:

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **Cursor Engineering Coach: Open Dashboard**
3. Navigate pages from the sidebar, filter by workspace at the bottom

---

## Pages

### Observe

| Page               | Description                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Dashboard**      | Practice scores with week-over-week trends, daily activity chart, top workspace stats |
| **Timeline**       | Gantt-style session timeline with per-day drill-down and overlap detection            |
| **Coding Moments** | Screenshot gallery from your Cursor sessions with story reels and workspace filtering |

### Measure

| Page         | Description                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------- |
| **Output**   | Generated code volume by language, model usage table _(token breakdown temporarily hidden)_ |
| **Burndown** | Monthly AI usage budget progress with projections _(temporarily disabled)_                  |
| **Patterns** | 7×24 activity heatmap and work-life balance signals                                         |

### Improve

| Page                | Description                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anti-Patterns**   | Five practice score cards with severity ratings, concrete actions, and example prompts. 45 editable markdown rules plus a coverage heatmap |
| **Rule Editor**     | Create, edit, and tune detection rules visually or as raw markdown. Live-test against your data                                            |
| **Rule Playground** | Interactive REPL for the rule DSL with field browser, function catalog, and metric list                                                    |
| **Data Explorer**   | Browse session fields, view distributions, run ad-hoc filters                                                                              |
| **Skill Finder**    | Discover repeated prompt patterns and matching community Cursor rules and skills                                                           |
| **Context Health**  | Overall context score, agentic readiness checklist, workspace context map, AI-powered rules-file review                                    |

### Level Up

| Page                | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| **Learning Center** | Personalized quizzes and code-comparison rounds generated from your actual usage |
| **Achievements**    | XP-based progression with Bronze → Silver → Gold → Diamond tiers                 |
| **Agentic SDLC**    | How you use Cursor across the full software-development lifecycle                |
| **Share**           | Generate a shareable stat card and export Markdown/JSON summaries                |

---

## Privacy

- **Read-only** — the extension never modifies your Cursor session files
- **Local analysis** — all parsing and analytics run entirely on your machine
- **No telemetry** — the extension does not phone home or collect usage data
- **Optional AI features** — some features (rule compiler, skill finder, context review) use Cursor's built-in language model API when explicitly invoked by the user

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, and [docs/AUTHORING_RULES.md](docs/AUTHORING_RULES.md) if you want to add new detection rules or metrics.

## License

[MIT](LICENSE)

## Disclaimer

This project is an open-source community fork of [microsoft/AI-Engineering-Coach](https://github.com/microsoft/AI-Engineering-Coach), retargeted to work exclusively with Cursor IDE. It is **not** an official Cursor product and is not affiliated with Anysphere or Microsoft. It is provided as-is with no warranties or guarantees.
