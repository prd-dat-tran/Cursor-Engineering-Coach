## Workers

- [warm-up-worker.ts](src/core/warm-up-worker.ts): `sessions` -> `antiPatterns` + `configHealth`.
- [parse-worker.ts](src/core/parse-worker.ts): `logsDirs` -> `progress` + `result`/`error`.
- [cache-write-worker.ts](src/core/cache-write-worker.ts): writes cache payload.

## Local Rule Trust Flow

Rules move pending→review→approve→reload; edits revoke trust. See [anti-patterns](docs/content/improve/anti-patterns.md) and [rule editor](docs/content/improve/rule-editor.md).

## Skills

- `add-coaching-rule` ([.cursor/skills/add-coaching-rule/SKILL.md](.cursor/skills/add-coaching-rule/SKILL.md)): step-by-step pattern for adding a new built-in coaching rule / anti-pattern (`src/core/rules/*.md`).
- `add-coaching-page` ([.cursor/skills/add-coaching-page/SKILL.md](.cursor/skills/add-coaching-page/SKILL.md)): step-by-step pattern for adding a new dashboard page/view (analyzer → RPC → webview page → nav → docs).

## Agent Team

Every chat in this repo runs as a 4-persona pod — auto-routed, with in-reply handoffs and proactive QA — defined in the always-on rule [.cursor/rules/agent-team.mdc](.cursor/rules/agent-team.mdc):

- **[Product Manager]** — user value, scope, user stories (anchors to [.cursor/context/prd.md](.cursor/context/prd.md)).
- **[Lead Developer]** — implementation, fixes, performance (follows [.cursor/context/flow.md](.cursor/context/flow.md) + the skills above).
- **[Technical Researcher]** — tech / API discovery + recommendations (anchors to [.cursor/context/architecture.md](.cursor/context/architecture.md)).
- **[QA & UX Engineer]** — tests, edge cases, UX ([.cursor/rules/testing.mdc](.cursor/rules/testing.mdc)).

Summon one explicitly with the slash commands in [.cursor/commands/](.cursor/commands/) — `/pm`, `/dev`, `/research`, `/qa`, or `/team` (full round-table).

## Documentation Index

This is a quick map of the docs tree so readers and agents can see the available pages at a glance.

- [Features](/features/)
- [Getting Started](/getting-started/)
  - [Installation](/getting-started/installation/)
  - [Cursor Sources](/getting-started/cursor-sources/)
  - [AI Provider](/getting-started/ai-provider/)
- [Improve](/improve/)
  - [Anti-Patterns](/improve/anti-patterns/)
  - [Context Health](/improve/context-health/)
  - [Data Explorer](/improve/data-explorer/)
  - [Rule Editor](/improve/rule-editor/)
  - [Rule Playground](/improve/rule-playground/)
  - [Skill Finder](/improve/skill-finder/)
- [Level Up](/level-up/)
  - [Achievements](/level-up/achievements/)
  - [Learning Center](/level-up/learning/)
  - [Agentic SDLC](/level-up/sdlc/)
  - [Share](/level-up/share/)
- [Measure](/measure/)
  - [Burndown](/measure/burndown/)
  - [Output](/measure/output/)
  - [Activity Patterns](/measure/patterns/)
- [Observe](/observe/)
  - [Dashboard](/observe/dashboard/)
  - [Request Usage](/observe/usage/)
  - [Models](/observe/models/)
  - [Changelog](/observe/changelog/)
