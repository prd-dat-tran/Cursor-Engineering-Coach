---
name: add-coaching-rule
description: >-
  Author a new built-in coaching / anti-pattern detection rule for this
  extension (a Markdown DSL file in src/core/rules/*.md). Use whenever the user
  wants to add, create, or scaffold a coaching rule, anti-pattern, or detector —
  e.g. "add a rule that detects X", "flag when users do Y", or any new entry
  under src/core/rules/. Covers the frontmatter, the `detect` DSL block, billing
  scoping, the rule-count test bump, and build/verify so nothing is missed.
---

# Add a Coaching Rule

Coaching insights are powered by Markdown files in `src/core/rules/*.md`. They
are **auto-discovered** at load (`rule-loader.ts` globs the directory) — there is
no central registry to edit. Adding a rule = add one `.md` file, bump one test
count, rebuild.

Deep references (read only when needed — progressive disclosure):
- DSL surface, fields, helpers: [@.cursor/rules/built-in-rules-and-dsl.mdc](mdc:.cursor/rules/built-in-rules-and-dsl.mdc)
- Canonical authoring guide: [@docs/AUTHORING_RULES.md](mdc:docs/AUTHORING_RULES.md)
- Available DSL fields: [@src/core/dsl/schema.ts](mdc:src/core/dsl/schema.ts)

## Workflow

Copy this checklist and track it:

```
- [ ] 1. Scaffold src/core/rules/<id>.md (frontmatter + 5 sections + detect block)
- [ ] 2. Write the detect block (thresholds.*, fields from schema.ts — no magic numbers)
- [ ] 3. Decide billing scope (tag cost/model rules; omit for universal rules)
- [ ] 4. Bump BOTH rule-count assertions in src/core/antipatterns-e2e.test.ts
- [ ] 5. Build + verify: npm run build && npm run check
```

## Step 1 — Scaffold the file

Filename is `kebab-case.md`; the `id` must equal the filename without `.md`.
Use this exact shape (mirrors `src/core/rules/underpowered-model.md`):

````markdown
---
id: my-new-rule
name: Human Readable Title
group: tool-mastery            # prompt-quality | session-hygiene | code-review | tool-mastery | context-management
severity: medium               # low | medium | high (high = clear cost: security, billing, flow destruction)
scope: requests                # requests | sessions  (must match `scan:` below)
requiresIdeContext: true       # optional — only set if the rule needs IDE/harness fields
billing: usage-based           # optional — see Step 3
version: 1
tags: [topic, keywords]
thresholds:
  minSample: 20                # named knobs the DSL references; tweakable in the Rule Playground
  maxShare: 0.4
---

# Description
One paragraph: what this detects and why it matters.

# When Triggered
{{count}} requests ({{pct}}) did X. Keep it specific; use {{template}} placeholders.

# How to Improve
Imperative, actionable advice naming real Cursor surfaces (Plan mode, Agent mode,
`@file`, `.cursor/rules/`, hooks). Never reference Copilot/Claude/Codex/Xcode.

# Examples
{{normalizeModel(modelId)}}: "{{messageText | truncate:50}}"

# Detection Logic
```detect
scan: requests
match: modelId != "" AND modelTier(modelId) > 0 AND modelTier(modelId) < 1
aggregate: ratio
check: ratio > thresholds.maxShare AND count > thresholds.minSample
examples: {{normalizeModel(modelId)}}: "{{messageText | truncate:50}}"
```
````

## Step 2 — Write the detect block

The DSL is a constrained expression language, **not JavaScript**.

- `scan:` is `requests` or `sessions` — must match the frontmatter `scope`.
- `match:` boolean per row; `aggregate:` is `count | sum | ratio | percent`;
  `check:` is the boolean that fires the rule (references `ratio`/`count`/`sum`).
- Strings are double-quoted; booleans compose with uppercase `AND` / `OR` / `NOT`.
- **Always** reference tunables as `thresholds.<name>` — never hard-code a number
  in `match`/`check` (the Rule Playground tweaks these).
- Only use fields that exist in [@src/core/dsl/schema.ts](mdc:src/core/dsl/schema.ts).
  Helpers like `modelTier(...)`, `matches(field, "regex")`, `normalizeModel(...)`,
  and the `| truncate:N` filter live in the interpreter.

If you need a field or helper that does not exist yet, that is a **DSL
extension** — a bigger task (schema + interpreter + cheatsheet + abuse tests).
Stop and follow the "When you extend the DSL" section of the DSL rule before
continuing.

## Step 3 — Billing scope

Tag rules whose advice is about **cost or model economics** so they don't give
wrong advice for the user's plan:

- **Omit `billing:`** → fires for everyone. Default for non-cost rules.
- `billing: usage-based` → cost scales with tokens (Cursor credit default).
  Tag token/credit-saving rules here.
- `billing: request-based` → flat per-request plans (many Enterprise contracts);
  e.g. flagging weak/auto models that buy no savings.

## Step 4 — Bump the rule-count test

Adding a file changes the built-in rule total. Open
[@src/core/antipatterns-e2e.test.ts](mdc:src/core/antipatterns-e2e.test.ts),
read the **current** expected number (don't assume — it changes every time a
rule is added), and increment **both** assertions by one:

```
it('loads all N built-in rules from .md files' ...) → expect(rules.length).toBe(N);
... → expect(builtIn!.ruleCount).toBe(N);
```

Tip: `ls src/core/rules/*.md | wc -l` is the authoritative new count. This is
the only count to touch — there is no registry list.

## Step 5 — Build and verify

```bash
npm run build      # copies src/core/rules/*.md → dist/rules (packaged extension reads dist)
npm run check      # typecheck + lint + spellcheck + knip + test (must be green)
```

Why both: tests read `src/core/rules/` (so `npm run check` validates the rule),
but the shipped extension loads from `dist/rules/`, so the rule only reaches
users after `npm run build`.

## Gotchas

- **cspell**: new product/model names must be added to [@cspell.json](mdc:cspell.json)
  or `npm run check` fails.
- **Cursor-only copy**: never mention Copilot, Claude Code, Codex, Gemini, Xcode,
  OpenCode, or `.github/copilot-instructions.md` / `CLAUDE.md` in rule text.
- **Don't rename a published `id`** — it's stored in user trust approvals and
  dashboards.
- **New `group`** values change dashboard tiles — reuse an existing one unless the
  product owner wants a new tile.
- After non-trivial rule/DSL changes, confirm the *Rules pipeline* section of
  [@.cursor/context/architecture.md](mdc:.cursor/context/architecture.md) still
  reads true (per the repo's docs-stay-in-sync rule).
