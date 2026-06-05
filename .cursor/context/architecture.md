# Architecture

This document is the **mental model** every contributor (and every agent)
should load before touching `Cursor Engineering Coach`. It is intentionally
short on prose and long on names you can grep for.

## 30-second pitch

A VS Code / Cursor IDE extension that reads **local** Cursor session data
from two on-disk sources — the VS Code-format chat files under
`workspaceStorage/` and Cursor's native Composer/Agent SQLite database
(`globalStorage/state.vscdb`) — parses them into `Session[]` /
`SessionRequest[]`, runs them through a battery of analyzers and
DSL-driven detection rules, and surfaces:

- A **dashboard webview** with charts and pages (`src/webview/`).
- A **chat participant** `@coach` (`src/chat/`).
- A set of **Language Model tools** prefixed `coach_*` (`src/mcp/`).

Everything happens on the user's machine. No telemetry, no network for
analytics, no writes outside the extension's own cache directory at
`~/.cursor-engineering-coach/cache/`.

## Runtime topology

```
                ┌──────────────────────────────────────────────┐
                │           VS Code Extension Host             │
                │                                              │
   activate ──► │ src/extension.ts                             │
                │   ├─ installRuntimeDebugHooks()              │
                │   ├─ loadAllRuleLayersAsync (trust gate)     │
                │   ├─ loadAllMetricLayersAsync (trust gate)   │
                │   ├─ registerTools()        ──► src/mcp/     │
                │   ├─ registerChatParticipant ──► src/chat/   │
                │   └─ commands → DashboardPanel.createOrShow  │
                │                                              │
                │                ┌─────────────────────────┐   │
                │                │ src/core/  (pure TS)    │   │
                │                │   parser.ts             │   │
                │                │   analyzer*.ts          │   │
                │                │   cache.ts              │   │
                │                │   rule-engine.ts        │   │
                │                │   dsl/*                 │   │
                │                └─────────────────────────┘   │
                │                       │   ▲   │              │
                │                       ▼   │   ▼              │
                │   parse-worker.ts ────┘   │   └── cache-write-worker.ts
                │   warm-up-worker.ts ──────┘                  │
                │                                              │
                └─────────────────────────────┬────────────────┘
                                              │ postMessage RPC
                                              ▼
                ┌──────────────────────────────────────────────┐
                │       Webview (sandboxed browser)            │
                │                                              │
                │ src/webview/app.ts                           │
                │   ├─ page-dashboard.ts                       │
                │   ├─ page-patterns.ts                        │
                │   ├─ page-output.ts                          │
                │   ├─ page-burndown.ts                        │
                │   ├─ page-timeline.ts                        │
                │   ├─ page-antipatterns.ts                    │
                │   ├─ page-skills.ts                          │
                │   ├─ page-config.ts                          │
                │   ├─ page-experiments.ts                     │
                │   ├─ page-data-explorer.ts                   │
                │   ├─ page-rule-playground.ts                 │
                │   └─ page-image-gallery.ts                   │
                │                                              │
                │ render.ts  →  Preact + htm                   │
                │ shared.ts  →  rpc(), createChart(), helpers  │
                └──────────────────────────────────────────────┘
```

## Data flow

```
~/.../workspaceStorage/<workspaceId>/          ~/.../globalStorage/state.vscdb
   chatSessions/*.json                              cursorDiskKV table:
   chatEditingSessions/<sid>/state.json               composerData:*  bubbleId:*
                       │                                       │
                       ▼                                       ▼
   parser-vscode.ts (VS Code chat format)        parser-cursor.ts (Composer/Agent;
                       │                            reads via sqlite3 CLI, read-only)
                       │                                       │
                       ▼                                       │
   parse-worker.ts   (per-workspace, off main thread)         │
                       │                                       │
                       ▼                                       ▼
   parser.ts  →  ParseResult { sessions, workspaces, editLocIndex, sessionSourceIndex }
                       │   (Composer sessions re-collected every load; the dir-meta
                       │    cache only fingerprints workspaceStorage, not the DB)
                       │
                       ├──► cache.ts (memory + disk; key by dir mtime/size metas)
                       │
                       ▼
   Analyzer  ──► PanelRequestService / panel-rpc.ts ──► webview
                       │
                       └──► MCP tools (src/mcp/tools.ts) ──► @coach
```

### Key invariants

- `Session[]` is **immutable** after a parse. Analyzers may build derived
  indexes but must not mutate the originals.
- Every `SessionRequest` belongs to exactly one `Session` (see
  `AnalyzerBase.buildRequestSessionMap`).
- The only `harness` values emitted by parsers are `'Cursor'` (stable) and
  `'Cursor Nightly'` (the Nightly edition's Composer sessions). There is **no
  harness filter**: `DateFilter` has no `harness` field, and the harness
  filter UI + per-harness breakdown RPCs (`getHarnesses`,
  `getHarnessBreakdown`) were removed because the product is Cursor-only.
  `harness` survives only as a per-session label used for internal grouping
  (token coverage, parser coverage, config-health context provision).
  Re-introducing a harness filter, a "by harness" breakdown chart, or a check
  for *non-Cursor* harness names (Copilot, Claude, etc.) is a code smell.
- The cache is keyed by per-directory mtime + size *metas* over
  `workspaceStorage` only. The Composer `state.vscdb` is **not**
  fingerprinted, so `parser.ts` re-collects Composer DB sessions on every
  load (and identifies/drops the prior batch via the `cursor-composer-db`
  `SessionSource` kind). A change to the on-disk cache format — including
  the `SessionSource` union shape — requires bumping the cache version
  constant in `cache.ts`.

## Workers (also documented in [AGENTS.md](../../AGENTS.md))

| Worker | Input | Output | Why |
|---|---|---|---|
| [`parse-worker.ts`](../../src/core/parse-worker.ts) | `logsDirs` | `progress` + `result`/`error` | Parsing JSON for hundreds of sessions blocks the host. |
| [`warm-up-worker.ts`](../../src/core/warm-up-worker.ts) | `sessions` + `billing` | `antiPatterns` + `configHealth` | Anti-pattern detection is CPU-bound. |
| [`cache-write-worker.ts`](../../src/core/cache-write-worker.ts) | `f`, `m`, `json`, `metaJson` | (writes to disk) | Avoid stalling the host on `fs.writeFileSync`. |

Worker entry points validate `workerData` with typeguards before doing
anything; new workers must follow that pattern.

## Persistence

- **Memory cache**: `getMemoryCache` / `setMemoryCache` in `cache.ts`.
- **Disk cache**: JSON under `~/.cursor-engineering-coach/cache/`. Includes
  parsed sessions, sidebar stats, and (separately) the runtime debug log
  at `runtime.log`. In-memory sessions have their text stripped
  (`stripSessionsForMemory`); the detail view reloads full text on demand
  via `loadSessionFromDisk`, which dispatches on the `SessionSource` kind —
  re-reading the chat file (`vscode-session-file`) or re-querying the
  Composer DB by `composerId` (`cursor-composer-db`).
- **Trust store**: `vscode.Memento` (global state). Approved file paths
  and content hashes for user-authored rules / metrics
  ([`src/core/rule-trust.ts`](../../src/core/rule-trust.ts)).
- **Catalog cache**: in-memory only, cleared on panel reload
  ([`src/webview/panel-catalog.ts`](../../src/webview/panel-catalog.ts)).

## Webview RPC

The webview talks to the host via `postMessage` envelopes:

```
{ type: 'request', id, method, params }   →  host
{ type: 'response', id, ok, result/error } ←  host
```

- Typed contract: `RpcMethodMap` in
  [`src/core/types/rpc-types.ts`](../../src/core/types/rpc-types.ts).
- Read-only / pure analytics calls: [`src/webview/panel-rpc.ts`](../../src/webview/panel-rpc.ts).
- Side-effectful or LLM-backed calls: [`src/webview/panel-request-service.ts`](../../src/webview/panel-request-service.ts).
- Webview-side helper: `rpc<T>('method', payload)` in
  [`src/webview/shared.ts`](../../src/webview/shared.ts).

## Chat participant + MCP

- Single participant id `cursorEngineeringCoach.coach` registered by
  [`src/chat/participant.ts`](../../src/chat/participant.ts).
- Slash commands: `summary`, `improve`, `compare`, `flow` (declared in
  both `package.json` and `participant.ts`).
- System prompt assembled by [`src/chat/system-prompt.ts`](../../src/chat/system-prompt.ts);
  contains the prompt-injection firewall.
- Tools registered via [`src/mcp/tools.ts`](../../src/mcp/tools.ts);
  each tool wraps an `Analyzer` method → `format*` → JSON text part.

## Billing-aware coaching

Coaching adapts to **how the user is charged**, because the optimal strategy
inverts between billing models:

- **Usage-based** (Cursor's credit default): cost ≈ tokens × model rate, so
  match model power to the task and lean on Auto/lighter models for routine work.
- **Request-based** (legacy request plans, many Enterprise contracts): every
  request is a flat charge regardless of model or tokens, so default to the
  **most capable** model and economize on the **number of requests**.

Wiring:

- [`src/core/billing.ts`](../../src/core/billing.ts) — pure, **no `vscode`
  import** (runs in the warm-up worker). Defines `BillingModel`,
  `BillingProfile`, `DEFAULT_BILLING_PROFILE`, and the messaging helpers
  `billingHeadline` (dashboard) + `billingCoachNote` (`@coach` system prompt).
- [`src/billing-vscode.ts`](../../src/billing-vscode.ts) — extension-host
  reader for the `cursorEngineeringCoach.billing.*` settings; returns a
  `BillingProfile`. `panel.ts` reloads (and re-tunes) when those settings change.
- The profile threads through `Analyzer` → `PatternsAnalyzer` (recommendation
  branching) and `Analyzer` → `warm-up-worker` payload. Exposed to the webview
  via the `getBillingProfile` RPC and to `@coach` via the summary formatter.
- **Rule gating**: `DetectionRule.billing?` (frontmatter `billing:`) scopes a
  rule to one model. `detector-registry.getActiveDetectors(skip, billingModel)`
  filters on it; untagged rules apply to both. Token-cost rules are tagged
  `billing: usage-based`; `underpowered-model.md` is `billing: request-based`.

### Plan auto-detection & live usage (3 tiers)

The user no longer *has* to configure billing — the setting is now an override:

- **Tier 1 — plan tier (local, no network).**
  `parser-cursor.readCursorMembershipType()` reads `cursorAuth/stripeMembershipType`
  from Cursor's global `state.vscdb` (read-only). `billing.mapMembershipToPlan()`
  maps it to a `CursorPlan`. `billing-vscode.readBillingProfile()` precedence:
  plan = explicit setting → detected → unknown; model = explicit setting →
  `defaultBillingModelForPlan` (always usage-based — request-based is a contract
  detail not present in local data). `BillingProfile.planDetected` records this.
- **One-time prompt.** `billing-vscode.maybePromptForBillingModel(context)` (wired
  in `extension.ts` activate) asks Teams/Enterprise users "per request or per
  token?" once (Memento `billing.promptedForModel.v1`), writes the setting, and
  is overridable in Settings.
- **Tier 2 — request economics (local).** `PatternsAnalyzer.getRequestEconomics()`
  quantifies frontier vs light/auto vs cancelled request counts; `coach_credits`
  uses it so request-based advice cites real numbers.
- **Tier 3 — live usage (opt-in network).** `src/billing-usage.ts` is the ONLY
  analytics network call, gated behind `billing.fetchLiveUsage` (default off). It
  reads `cursorAuth/accessToken` transiently and `GET`s
  `https://api2.cursor.sh/auth/usage` (Bearer) → `{ requestsUsed, requestsLimit,
  cycleStart }`. Token is never stored/logged; errors are swallowed. Surfaced via
  the `getLiveUsage` RPC (dashboard banner) and `coach_credits`.

## Rules pipeline

```
src/core/rules/*.md  ──── built-in, always loaded
~/.cursor-engineering-coach/rules/*.md  ── personal, trust-gated
<workspace>/.cursor/rules/*.md   ── project, trust-gated (analyzer-side)
                              │
                              ▼
                       rule-loader.ts
                              │
                              ▼
                   rule-parser.ts (frontmatter + ```detect```)
                              │
                              ▼
                       rule-engine.ts
                              │
                              ▼
                  detector-registry.ts
                              │
                              ▼
             analyzer-patterns.ts (anti-patterns)
                              │
                              ▼
                 page-antipatterns.ts (UI)
```

The DSL is parsed by `src/core/dsl/lexer.ts` + `parser.ts` and evaluated
by `interpreter.ts`. Available fields and helpers are listed in
`schema.ts` — that file is the source of truth for the Data Explorer and
the Rule Playground.

## Build, test, package

- **Build**: `npm run build` → `node esbuild.mjs` → `dist/`.
- **Watch**: `npm run watch`.
- **Test**: `npm test` (Vitest). Watch: `npm run test:watch`.
- **Lint**: `npm run lint` (ESLint).
- **Spellcheck**: `npm run spellcheck` (cspell).
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`).
- **Check all**: `npm run check` (typecheck + lint + spellcheck + knip + test).
- **Package**: `npm run package` → `.vsix`.
- **Build + install in Cursor**: `npm run deploy` (one-shot build →
  `.vsix` → `cursor --install-extension --force` → reload). Backed by
  `scripts/install-cursor.sh`, which also supports `deploy:update` (pull
  latest from GitHub) and a `curl … | bash` remote install.

## Keeping this document honest

This file is the **canonical mental model** for the codebase. When you
change the runtime topology, data flow, workers table, RPC contract,
persistence layout, or rules pipeline above, update the matching section
in the same PR. See [`flow.md`](flow.md) → *Keeping `.cursor/` in sync*
for the full checklist and a trigger matrix. A diagram that doesn't
match the code is worse than no diagram at all.
