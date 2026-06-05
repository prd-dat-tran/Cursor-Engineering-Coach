# Product Requirements (current milestone)

> Treat this file as the **scope contract** for the active milestone. If a
> request contradicts what's here, say so before you change code.

## Project identity

**Cursor Engineering Coach** is a Cursor-IDE-only fork of
[`microsoft/AI-Engineering-Coach`](https://github.com/microsoft/AI-Engineering-Coach).
It is a privacy-first, read-only analytics extension that mentors
developers on how they use Cursor.

- **Audience.** Individual developers who want to get more out of Cursor
  IDE. Not teams, not orgs (yet), not enterprise admins.
- **Distribution.** VS Code extension (`.vsix`), installable in Cursor.
- **License.** MIT. Microsoft copyright headers stay; new files use the
  same header.

## Milestone — "Cursor-native"

The current milestone (completed in this branch) is to **finish the
rebrand and harden Cursor-native behavior**. Concretely:

### In scope

- [x] All identifiers use the `cursorEngineeringCoach.*` /
      `coach_*` / `@coach` namespace.
- [x] Parser reads `Cursor` and `Cursor Nightly` VS Code-format chat files
      under `workspaceStorage/` (`parser-vscode.ts`).
- [x] Parser reads Cursor's native Composer/Agent sessions from the
      `globalStorage/state.vscdb` SQLite DB (`parser-cursor.ts`). This is the
      primary source for real Cursor usage — Cursor does **not** write its
      Composer/Agent chats to the VS Code `chatSessions/*.jsonl` format.
- [x] Custom-instruction detection covers `AGENTS.md`, `.cursorrules`,
      `.cursor/rules/*.md`.
- [x] Config health analyzer reads `.cursor/hooks.json`, `.cursor/mcp.json`,
      `.cursor/skills/`.
- [x] Catalog installer pulls from
      [`PatrickJS/awesome-cursorrules`](https://github.com/PatrickJS/awesome-cursorrules)
      and installs into `~/.cursor/rules` or `~/.cursor/skills`.
- [x] Multi-harness UI affordances are removed: no harness picker/filter
      (sidebar + per-page) and no per-harness breakdowns (dashboard "Requests
      by Harness" + hero harness pills, Output "Output/Tokens by Harness",
      Context "Context Provision by Harness"). `DateFilter` has no `harness`
      field. The only harness values are `'Cursor'` and `'Cursor Nightly'`.
- [x] `.cursor/` scaffolding for agents (rules + context + ignore) — **this file**.

### Out of scope (do not regress)

- ❌ Any code path that re-introduces Copilot / Claude Code / Codex /
  OpenCode / Xcode / Copilot CLI parsing or UI.
- ❌ Telemetry of any kind.
- ❌ Network requests for analytics **by default** (LLM calls inside the
  panel are allowed because they use the user's own `vscode.lm` provider).
  The single exception is the **opt-in** live-usage fetch behind
  `cursorEngineeringCoach.billing.fetchLiveUsage` (default off), which calls
  only Cursor's own backend — see the billing milestone below.
- ❌ Writing to the user's source tree. The extension only writes to its
  cache directory at `~/.cursor-engineering-coach/cache/` and (when
  explicitly invoked) to summary export targets the user picks.
- ❌ Enterprise / team aggregation features. This is a single-user tool.

### Carry-overs (known small inconsistencies)

These are intentional follow-ups, not bugs to fix in unrelated PRs:

- The `harness` field is a **free-form string**, but the product only emits
  Cursor flavors: `'Cursor'` and `'Cursor Nightly'`. `parser-vscode.ts`
  hard-codes `'Cursor'` (`harnessFromPath` always returns `'Cursor'`);
  `parser-cursor.ts` emits `'Cursor'` or `'Cursor Nightly'` per edition.
  Tests that need multiple distinct surfaces use the real Cursor flavors
  `'Cursor Nightly'` / `'Cursor CLI'` (see
  [`testing.mdc`](../rules/testing.mdc)). The old multi-harness names
  (`'Local Agent'`, `'Xcode'`, `'GitHub Copilot CLI'`, `'Claude Code'`,
  `'Codex'`, `'OpenCode'`, `'VS Code'`) have been purged from `src/` — both
  shipping code (`schema.ts` field description, `analyzer-context.ts`
  comments) and test fixtures. A reappearance is drift; see the drift recipe
  in [`flow.md`](flow.md).
- `agentName: 'Copilot'` default appears in test fixtures and in
  `analyzer-insights.ts`. It is the internal default agent id used to
  distinguish sub-agents from the main turn — **keep it**. (This is the
  one brand string that is load-bearing, not cosmetic.)
- Cache-dir compatibility: a stale `~/.copilot-analytics-cache/`
  directory may exist on user machines that ran the upstream extension.
  We do not migrate or read from it; the rename is intentional.
- Composer DB reads shell out to the `sqlite3` CLI (read-only,
  `immutable=1`) rather than bundling a native SQLite binding — this keeps
  the `.vsix` portable. The global `state.vscdb` is read fresh on every
  parse (it is not covered by the dir-meta cache fingerprint); per-workspace
  `state.vscdb` files may be locked while Cursor is running, so failed reads
  are caught and logged at debug level, not surfaced as errors.

## Milestone — "Billing-aware coaching"

Cursor bills agent usage two very different ways, and the *correct*
optimization advice inverts between them. Coaching must respect the user's
plan instead of always assuming token-cost matters.

### In scope

- [x] User sets their plan via VS Code settings
      `cursorEngineeringCoach.billing.model` (`usage-based` | `request-based`)
      and optional `cursorEngineeringCoach.billing.plan` (tier label).
- [x] A pure, worker-safe [`src/core/billing.ts`](../../src/core/billing.ts)
      defines the `BillingProfile` and the plan-specific messaging; the
      extension-host reader is [`src/billing-vscode.ts`](../../src/billing-vscode.ts).
- [x] The profile threads through `Analyzer` → `PatternsAnalyzer` + warm-up
      worker, and is exposed to the webview via the `getBillingProfile` RPC.
- [x] **Request-based** users are coached to use the **most capable** model on
      every request and to economize on *request count*; token/credit-saving
      rules (`premium-waste`, `auto-avoidance`, `model-overreliance`,
      `reasoning-effort-overuse`, `premium-for-lookup-questions`,
      `cache-hit-starvation`) are tagged `billing: usage-based` and stay
      silent. A new `underpowered-model` rule (`billing: request-based`) flags
      over-reliance on lightweight/auto models.
- [x] **Tier 1 — plan auto-detection (local, no network).**
      `parser-cursor.readCursorMembershipType()` reads
      `cursorAuth/stripeMembershipType` from Cursor's global DB and
      `mapMembershipToPlan()` maps it to a tier; the setting becomes an
      override (`BillingProfile.planDetected`).
- [x] **One-time prompt** (`maybePromptForBillingModel`) asks Teams/Enterprise
      users "per request or per token?" once, writes the setting, stays
      overridable.
- [x] **Tier 2 — request economics.** `PatternsAnalyzer.getRequestEconomics()`
      makes request-based coaching quantitative (counts/% of weak-model and
      cancelled requests) in `coach_credits`.
- [x] **Tier 3 — live usage (opt-in network).** `src/billing-usage.ts` calls
      `api2.cursor.sh/auth/usage` with the local token when
      `billing.fetchLiveUsage` is on; surfaced via the `getLiveUsage` RPC in
      the dashboard banner and `coach_credits`.
- [x] Dashboard shows a billing chip + tailored headline; `@coach` system
      prompt and `coach_summary` / `coach_credits` are billing-aware.

### Out of scope (do not regress)

- ❌ Auto-detecting the *billing model* (request vs token). The plan **tier**
      is auto-detected locally, but request-vs-token is a per-contract detail
      absent from local data — it stays a setting (defaulted + prompted).
- ❌ Fetching live usage **by default**. The live fetch is strictly opt-in,
      hits only Cursor's backend, and never stores/logs the token.
- ❌ Per-request dollar estimates. We coach on *behavior* (model choice,
      request count), not invoice reconstruction.

## Quality bars (non-negotiable)

| Bar | Threshold | Measured by |
|---|---|---|
| Type safety | `tsc --noEmit` clean, strict mode | `npm run typecheck` |
| Lint | Zero ESLint warnings on touched files | `npm run lint` |
| Spell | cspell clean over `src/**/*.ts` and `docs/**/*.md` | `npm run spellcheck` |
| Tests | All Vitest tests pass | `npm test` |
| Bundle | Extension `dist/` stays under the size budget | `npm run check-size` |
| Privacy | No network calls for analytics, no writes outside cache | code review |

`npm run check` runs typecheck + lint + spellcheck + knip + test in one
shot. If any of these fail locally, they fail in CI.

## North-star user flows

These are the "happy paths" the product is optimized for. New work
should pull weight toward one of them; if it doesn't, that's a strong
signal it belongs in a different milestone.

1. **First-run dashboard.** User installs the extension, opens the
   dashboard, and within ~10 seconds sees real numbers from their last
   30 days of Cursor usage.
2. **`@coach` chat.** User opens Cursor's chat panel, types `@coach how
   am I doing this week?`, and gets a concise, data-backed summary with
   a couple of concrete suggestions.
3. **Anti-patterns triage.** User clicks an anti-pattern card on the
   dashboard, lands on the Anti-Patterns page, and can read the rule
   that fired, drill into example sessions, and tweak thresholds in the
   Rule Playground.
4. **Skill / rule install.** User browses community catalogs (Cursor
   rules and skills), picks one, and the extension drops it into
   `~/.cursor/rules/` or `~/.cursor/skills/` with provenance.

## Roadmap notes (informational, not binding)

Likely next milestones (no commitments):

- **Team-friendly export.** A "share" view that produces a redacted,
  copy-pasteable summary without leaking session contents.
- **Hooks templating.** A library of starter `.cursor/hooks.json`
  snippets you can install with one click.
- **Mode-aware coaching.** Cursor's Plan / Agent / Ask modes already
  show up in `agentMode`; the dashboard could surface mode-specific
  patterns ("you use Ask for tasks that would benefit from Plan").

Any of these moving into scope should produce a new section in this PRD.
