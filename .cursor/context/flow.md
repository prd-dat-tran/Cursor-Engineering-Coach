# Development Flow

How features get built, tested, packaged, and shipped in this repo. Every
recipe below assumes you're at the repo root with Node 22+, npm, and (for
local install) Cursor IDE on `PATH` (`Cmd+Shift+P → Shell Command: Install
'cursor' command`).

## First-time setup

```bash
npm ci                 # installs the exact lockfile versions
npm run typecheck      # confirm tsc is wired
npm test               # confirm vitest is wired
```

If `tsc: command not found`, you skipped `npm ci`. Don't `npm install -g`
anything — everything the repo needs is a devDependency.

## The inner loop

Pick the smallest matching recipe.

### Run tests fast

```bash
npx vitest                            # watch mode
npx vitest run src/core/foo.test.ts   # one file, one-shot
npx vitest run -t "deep flow"         # filter by test name
```

### Typecheck only

```bash
npm run typecheck
```

`tsc --noEmit`. Fix every error before moving on; the strict config means
even one error blocks lint cleanly.

### Lint only

```bash
npm run lint           # eslint src/
```

Treat warnings as errors during agent edits — review reads warnings as
bugs even though CI is lenient.

### Spellcheck only

```bash
npm run spellcheck
```

New product names / proper nouns go in [`cspell.json`](../../cspell.json)
`words` array. See the `docs-and-cspell.mdc` rule for the decision tree.

### The full gate (mirror of CI's `npm run check`)

```bash
npm run check          # typecheck + lint + spellcheck + knip + test
```

Run this **before** declaring a change done. If it passes here, it passes
in CI.

## Add a feature, end-to-end

The order below avoids backtracking. Each step adds one observable
behavior.

> Every recipe below ends with **"Sync `.cursor/`"** — don't skip it.
> See [Keeping `.cursor/` in sync](#keeping-cursor-in-sync) for the why.

### Adding a new analyzer + RPC method + webview page

1. **Type the result.** Open the closest match in
   [`src/core/types/`](../../src/core/types/) and add the new shape
   (e.g. into `analytics-types.ts`). Export it from `src/core/types/index.ts`
   if other modules need it.
2. **Implement the analyzer.** Create `src/core/analyzer-<topic>.ts`
   extending `AnalyzerBase`. Read sessions / requests off `this.sessions`,
   filter through the helpers from the base, return your new shape.
3. **Wire it into `Analyzer`.** In [`src/core/analyzer.ts`](../../src/core/analyzer.ts)
   compose your new analyzer alongside the existing ones (look at how
   `FlowAnalyzer` or `PatternsAnalyzer` are exposed).
4. **Add the RPC entry.** In
   [`src/core/types/rpc-types.ts`](../../src/core/types/rpc-types.ts)
   add `getMyTopic: { params: DateFilter; result: MyTopicData }` to
   `RpcMethodMap`.
5. **Implement the RPC handler.** In
   [`src/webview/panel-rpc.ts`](../../src/webview/panel-rpc.ts) — validate
   the payload with the `isString` / `isNumber` / `isRecord` helpers from
   `panel-shared.ts` and call `analyzer.<yourMethod>(filter)`.
6. **Write the page.** `src/webview/page-<topic>.ts` exporting
   `renderMyTopic(container, filter)`. Use `html` / `render` from
   [`./render.ts`](../../src/webview/render.ts). Wrap in
   `withErrorBoundary`.
7. **Register the page.** Import and dispatch in
   [`src/webview/app.ts`](../../src/webview/app.ts). Add the nav entry
   in [`src/webview/panel-html.ts`](../../src/webview/panel-html.ts) if
   it should show in the sidebar.
8. **Test the analyzer.** Colocate `analyzer-<topic>.test.ts` with a
   small `makeSession` / `makeRequest` factory. Cover at least one happy
   path and one empty-input case.
9. **Update docs.** Add `docs/content/<section>/<topic>.md` with
   frontmatter (`title`, `weight`, `description`). Update
   [`AGENTS.md`](../../AGENTS.md) documentation index.
10. **Sync `.cursor/`.** If you added a new page, RPC method, analyzer
    family, or workflow concept, update
    [`.cursor/context/architecture.md`](architecture.md) (data flow /
    module map / RPC contract) and revisit
    [`.cursor/rules/webview-and-rpc.mdc`](../rules/webview-and-rpc.mdc)
    or [`.cursor/rules/core-analyzers-and-parsers.mdc`](../rules/core-analyzers-and-parsers.mdc)
    if the patterns described there shifted.
11. **Run the gate.** `npm run check`.

### Adding a new MCP tool

1. Add `coach_<topic>` to `package.json` →
   `contributes.languageModelTools` (with `tags: ["cursor-engineering-coach"]`).
2. Add an entry to `TOOL_DEFS` in
   [`src/mcp/tools.ts`](../../src/mcp/tools.ts).
3. Add a `format<Topic>` formatter to
   [`src/mcp/formatters.ts`](../../src/mcp/formatters.ts).
4. Append the tool to the `Strategy:` list in
   [`src/chat/system-prompt.ts`](../../src/chat/system-prompt.ts) so the
   model knows when to pick it.
5. **Sync `.cursor/`.** The tool inventory in
   [`.cursor/rules/chat-and-mcp.mdc`](../rules/chat-and-mcp.mdc) lists
   every `coach_*` tool by name — add yours there too.
6. `npm run check`.

### Adding a built-in detection rule

1. Create `src/core/rules/<kebab-id>.md` following the shape in the
   built-in-rules rule (frontmatter + `# Description` / `# When
   Triggered` / `# How to Improve` / `# Examples` / ` ```detect ` block).
2. Reference fields and functions present in
   [`src/core/dsl/schema.ts`](../../src/core/dsl/schema.ts). Use
   `thresholds.<name>` for tunable numbers — never hardcode.
3. If you need a new helper, extend the DSL (see the
   `built-in-rules-and-dsl` rule for the gates).
4. Add a small fixture-level test in
   [`src/core/antipatterns-e2e.test.ts`](../../src/core/antipatterns-e2e.test.ts)
   showing the rule firing.
5. **Sync `.cursor/`.** If you extended the DSL (new field, helper, or
   syntax), update the field / function listing in
   [`.cursor/rules/built-in-rules-and-dsl.mdc`](../rules/built-in-rules-and-dsl.mdc)
   so future authors know what's available.
6. `npm run check`.

### Fixing a bug

1. **Reproduce in a test first.** Add a failing case to the closest
   existing `*.test.ts`. If no test exists yet, create one.
2. Implement the smallest fix that turns the test green.
3. Run `npm run check`.
4. If the bug touched a public surface (commands, RPC method names, MCP
   tool names, on-disk cache layout, rule schema), call it out in the PR
   description — it may be a breaking change.
5. **Sync `.cursor/`.** If the fix changes an invariant the rules /
   context docs assert (e.g. "the only harness is `'Cursor'`",
   "cache lives at `~/.cursor-engineering-coach/cache/`", a workflow
   step in `flow.md`), update the relevant `.cursor/` file in the same
   commit. A bug fix that contradicts an `.mdc` rule and doesn't update
   that rule will mislead the next agent.

## Keeping `.cursor/` in sync

The files under [`.cursor/`](../) are **living documents** that every
future agent (and human reviewer) reads as ground truth. A change that
makes them stale is a change that silently mis-trains the next ten edits
in this repo.

Before you call any task done, run through these **four questions**:

1. **Did I change a public surface?**
   - New / renamed VS Code command, view, setting, or activation event.
   - New / renamed chat slash command, MCP tool (`coach_*`), or chat
     participant id.
   - New / renamed RPC method (`RpcMethodMap`).
   - New / renamed on-disk path (cache dir, rule dir, hook config).

   If yes → update [`prd.md`](prd.md) (identifier conventions),
   [`architecture.md`](architecture.md) (module map / data flow), and
   the matching scoped `.mdc` rule.

2. **Did I change a workflow, script, or gate?**
   - New / renamed `npm run *` script.
   - Different lint / typecheck / spellcheck / test invocation.
   - New required env var or first-time-setup step.
   - Change to `scripts/dev-install.sh`, `scripts/test-local.sh`, CI.

   If yes → update [`flow.md`](flow.md) recipes and the **Run the
   gates** bullets in [`always.mdc`](../rules/always.mdc).

3. **Did I change an invariant or pattern the rules assert?**
   - "The only harness is `'Cursor'`."
   - "Webview uses Preact + htm, no `innerHTML`."
   - "`src/core/` is runtime-agnostic — no `import * as vscode`."
   - "MCP tools are read-only data accessors."
   - "Custom-instruction detection covers `AGENTS.md`, `.cursorrules`,
     `.cursor/rules/*.md`."
   - Any "Don't" list bullet in a scoped rule.

   If yes → update the matching scoped rule under
   [`.cursor/rules/`](../rules/). If you *intentionally* loosened an
   invariant, the corresponding rule must reflect the new constraint
   (or be removed). If you *intentionally* tightened one, add the new
   rule.

4. **Did I change scope?**
   - A new milestone item shipped or got cut.
   - The product target moved (e.g. added a new IDE, dropped a feature).
   - A "carry-over" listed in `prd.md` got resolved.

   If yes → update [`prd.md`](prd.md) — move items between
   *In scope* / *Out of scope* / *Carry-overs*, and add new sections if
   the milestone itself changed.

### Trigger matrix (quick reference)

| You changed… | Touch these files |
|---|---|
| `package.json` `contributes.commands` / `views` / `chatParticipants` / `languageModelTools` | [`prd.md`](prd.md), [`architecture.md`](architecture.md), [`chat-and-mcp.mdc`](../rules/chat-and-mcp.mdc), [`always.mdc`](../rules/always.mdc) (identifiers) |
| `src/core/types/rpc-types.ts` (RPC contract) | [`architecture.md`](architecture.md), [`webview-and-rpc.mdc`](../rules/webview-and-rpc.mdc) |
| Anything in `src/core/parser*.ts` (data sources, harness logic) | [`architecture.md`](architecture.md), [`core-analyzers-and-parsers.mdc`](../rules/core-analyzers-and-parsers.mdc), [`prd.md`](prd.md) |
| A new analyzer family in `src/core/analyzer-*.ts` | [`architecture.md`](architecture.md) module map, [`core-analyzers-and-parsers.mdc`](../rules/core-analyzers-and-parsers.mdc) |
| A new webview `page-*.ts` | [`architecture.md`](architecture.md), [`docs/content/...`](../../docs/content), `webview-and-rpc.mdc` page-module pattern if it shifts |
| `src/core/dsl/schema.ts`, `interpreter.ts`, or `rules/*.md` library | [`built-in-rules-and-dsl.mdc`](../rules/built-in-rules-and-dsl.mdc) |
| Worker contract (`*-worker.ts`) | [`AGENTS.md`](../../AGENTS.md), [`architecture.md`](architecture.md) workers table |
| `package.json` `scripts.*` | [`flow.md`](flow.md), [`always.mdc`](../rules/always.mdc) gate list |
| `.gitignore`, `.vscodeignore` | [`.cursorignore`](../../.cursorignore) — check the exclusion list still makes sense |
| `cspell.json` `words` | nothing further — that *is* the source of truth |

### How to spot drift in code review

When you review a PR, run this two-step check:

1. Open the diff. For each file changed, ask: "Does any `.cursor/`
   file mention this file or this concept?" If yes, confirm the
   `.cursor/` file is updated (or that the change is purely
   implementation-level).
2. Grep the **source tree** for identifiers the rebrand removed. Note:
   do **not** grep `.cursor/` for these — the rules and this file name
   the forbidden terms on purpose (in "Don't" lists), so a grep there
   always matches and tells you nothing.

   **Hard-fail tier** — these were fully renamed; any hit in source,
   config, or scripts is real drift and must be fixed:

   ```bash
   rg -n 'aiEngineerCoach|@aicoach|copilot-analytics-cache' \
     src/ package.json scripts/ esbuild.mjs eslint.config.mjs
   ```

   Expected: **no output** (`rg` exits 1). Any line is a bug.

   **Advisory tier** — harness labels the product no longer emits. These
   were fully purged from both shipping code *and* test fixtures, so the
   scan covers everything (no `-g` exclusion needed):

   ```bash
   rg -n "Local Agent|'Xcode'|GitHub Copilot CLI|Claude Code|'OpenCode'|'Codex'|'VS Code'" src/
   ```

   Expected: **no output**. A hit means a feature (or a test) reintroduced
   a multi-harness concept — push back. The only harness label the parser
   emits is `'Cursor'`; tests that need multiple distinct surfaces use the
   real Cursor flavors `'Cursor Nightly'` / `'Cursor CLI'` (see
   [`testing.mdc`](../rules/testing.mdc)). `agentName: 'Copilot'` is the
   one sanctioned brand string (sub-agent sentinel) — do not flag it.

## Manual smoke test inside Cursor

```bash
scripts/dev-install.sh
```

This packages a `.vsix`, installs it into Cursor via the `cursor` CLI,
and reloads the Cursor window. Then:

1. `Cmd+Shift+P → Cursor Engineering Coach: Open Dashboard`.
2. Verify the dashboard loads with your real session data.
3. `Cmd+Shift+P → Cursor Engineering Coach: Reload Data` after the first
   run to confirm the cache path works.
4. Open Cursor's chat, type `@coach summary` and confirm the response
   uses real numbers.
5. If anything looks off, tail
   `~/.cursor-engineering-coach/cache/runtime.log` for
   `runtimeDebug` events.

## Branching, commits, PRs

- Branch from `main`. Names like `fix/parser-mtime-edge-case` or
  `feat/coach-mode-comparison`.
- Commit messages: conventional-ish, but flexible. Imperative mood
  (`Fix parser mtime overflow`, not `Fixed`).
- Keep PRs focused. If you find yourself touching > 15 files for
  unrelated reasons, split.
- The repo runs `lint-staged` via husky; expect ESLint + cspell to run
  on `git commit`. Don't bypass with `--no-verify`.
- CI mirrors `npm run check`. Pass locally, pass in CI.

## When something flakes

- `cache.test.ts` / `runtime-debug.test.ts` occasionally fail under
  sandboxed environments because they write to
  `~/.cursor-engineering-coach/`. Re-run; only investigate if it fails a
  second time outside the sandbox.
- Worker tests are sensitive to timeouts; if you see "worker exited
  with code 1" intermittently, check that the test's fixture isn't
  larger than `WORKER_MAX_OLD_SPACE_MB` (4 GB) by accident.
- esbuild watch sometimes serves a stale bundle if you edit `package.json`
  while it's running — kill and restart.
