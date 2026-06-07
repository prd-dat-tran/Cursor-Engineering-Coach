---
name: add-coaching-page
description: >-
  Add a new analytics page/view to the Cursor Engineering Coach dashboard
  webview. Use whenever the user wants to add, create, or scaffold a new
  dashboard page, tab, view, or panel — e.g. "add a page that shows X", "a new
  tab for Y", or any new src/webview/page-*.ts. Covers the analyzer, the typed
  result shape, RPC wiring on both sides, the webview page module, nav + router,
  CSS, docs, and build/verify so nothing is missed.
---

# Add a Dashboard Page

A page is four moving parts wired by one slug:

1. an **analyzer** (`src/core/analyzer-<domain>.ts`) that turns parsed sessions into a typed shape,
2. a **type** for that shape (`src/core/types/analytics-types.ts`),
3. an **RPC** that exposes it (declared in `rpc-types.ts`, handled in `panel-rpc.ts`, surfaced on the `Analyzer` umbrella), and
4. a **webview module** (`src/webview/page-<domain>.ts`) that fetches via `rpc(...)` and renders.

There is no central page registry. The page is reached by a `data-page` **slug** that must be identical in the nav `<li>` and the router `switch`. The recently-added **Models** page (`analyzer-models.ts` → `getModelInsights` → `page-models.ts`) is the canonical template — copy it.

Deep references (read only when needed — progressive disclosure):
- Webview/RPC contract & page-module pattern: [@.cursor/rules/webview-and-rpc.mdc](mdc:.cursor/rules/webview-and-rpc.mdc)
- Analyzer conventions: [@.cursor/rules/core-analyzers-and-parsers.mdc](mdc:.cursor/rules/core-analyzers-and-parsers.mdc)
- System map (keep its tree in sync): [@.cursor/context/architecture.md](mdc:.cursor/context/architecture.md)

## Workflow

Copy this checklist and track it:

```
- [ ] 1. Type:     add the result shape in src/core/types/analytics-types.ts
- [ ] 2. Analyzer: src/core/analyzer-<domain>.ts (extends AnalyzerBase, public get<X>(f?))
- [ ] 3. Umbrella: import + member + instantiate + facade method in src/core/analyzer.ts
- [ ] 4. RPC type: add get<X> entry (+ type import) in src/core/types/rpc-types.ts
- [ ] 5. RPC impl: add handler in src/webview/panel-rpc.ts
- [ ] 6. Page:     src/webview/page-<domain>.ts (render<X>(content, filter) → rpc → render)
- [ ] 7. Router:   import + case '<slug>' with withErrorBoundary in src/webview/app.ts
- [ ] 8. Nav:      <li data-page="<slug>"> in src/webview/panel-html.ts (slug MUST match router)
- [ ] 9. CSS:      add a page block in src/webview/styles-pages.css
- [ ] 10. Docs:    docs/content/<section>/<page>.md + _index + features/_index + sidebar.html + build-pdf.sh + AGENTS.md + architecture.md tree
- [ ] 11. Verify:  npm run build && npm run check
```

Pick one `<slug>` / `<domain>` and use it everywhere (kebab-case, e.g. `models`).

## Step 1 — Type the result shape

Add an exported interface in `src/core/types/analytics-types.ts` describing exactly what the page needs. One umbrella interface (e.g. `ModelInsightsData`) plus any row sub-types. Keep it serializable (plain data — it crosses the RPC boundary as JSON).

## Step 2 — Analyzer

Create `src/core/analyzer-<domain>.ts`. Extend `AnalyzerBase`, take the standard constructor args, and expose one public method that accepts an optional `DateFilter`:

```ts
import { AnalyzerBase } from './analyzer-base';
import type { DateFilter, MyPageData } from './types';

export class MyDomainAnalyzer extends AnalyzerBase {
  getMyPageData(f?: DateFilter): MyPageData {
    const reqs = this.filter(f);           // request-level, date-filtered
    // ...aggregate; use this.requestSessionMap for workspace attribution
    return { /* MyPageData */ };
  }
}
```

Use `this.filter(f)` for date filtering and `this.requestSessionMap` to map a request to its session/workspace. If the page needs the billing model, accept the optional `billing` profile (see how `ModelAnalyzer` uses it) — never assume a plan. One file per domain; do not start a parallel analyzer.

## Step 3 — Wire the umbrella (`src/core/analyzer.ts`)

Four edits, mirroring `models`:

```ts
import { MyDomainAnalyzer } from './analyzer-mydomain';      // (a) import
// ...
  private readonly mydomain: MyDomainAnalyzer;               // (b) member
// ...in the constructor:
  this.mydomain = new MyDomainAnalyzer(sessions, elIdx, sharedMap, billing); // (c) instantiate
// ...with the other facade methods:
  getMyPageData(f?: DateFilter): MyPageData { return this.mydomain.getMyPageData(f); } // (d) facade
```

## Step 4 — Declare the RPC (`src/core/types/rpc-types.ts`)

Add the method to the RPC map and import its result type:

```ts
  getMyPageData: { params: DateFilter | undefined; result: MyPageData };
```

## Step 5 — Handle the RPC (`src/webview/panel-rpc.ts`)

```ts
  getMyPageData: (a, _p, params) => a.getMyPageData(validateDateFilter(params)),
```

Always run incoming filters through `validateDateFilter` (never trust raw webview params). For read-only analytics this is all you need; side-effectful RPCs (network, commands) live in `panel-request-service.ts` instead.

## Step 6 — Webview page module (`src/webview/page-<domain>.ts`)

Export one `render<X>(content, filter)` that fetches and renders. Mirror `page-models.ts`:

```ts
import { html, render } from './render';
import { rpc } from './shared';
import type { DateFilter, MyPageData } from '../core/types';

export async function renderMyPage(content: HTMLElement, filter: DateFilter): Promise<void> {
  let data: MyPageData;
  try {
    data = await rpc<MyPageData>('getMyPageData', filter as Record<string, unknown>);
  } catch (e) {
    render(html`<div class="error-banner">Failed to load: ${String(e)}</div>`, content);
    return;
  }
  render(markup(data), content);
}
```

Build the DOM with the `html` tagged template + `render` (Preact). Reuse helpers from `shared.ts` (`createChart`, color tokens, formatters) and small components from sibling pages — don't reinvent cards/tables.

## Step 7 — Router (`src/webview/app.ts`)

Import the renderer and add a `case` whose value is the **slug**. Always wrap in `withErrorBoundary`:

```ts
import { renderMyPage } from './page-mydomain';
// ...inside the page switch:
case 'mypage': withErrorBoundary('My Page', content, () => renderMyPage(content, currentFilter)); break;
```

## Step 8 — Nav (`src/webview/panel-html.ts`)

Add an `<li>` under the right section heading. `data-page` **must equal** the router `case`:

```html
<li><a href="#" data-page="mypage"><span class="nav-icon"><svg>...</svg></span> My Page</a></li>
```

Pick an icon from an existing nav item's SVG style. Mismatched slug = a dead nav link that renders nothing.

## Step 9 — CSS (`src/webview/styles-pages.css`)

Append a clearly-commented block, namespaced by a page root class (e.g. `.mypage-page`). Match the file siblings use — most pages live in `styles-pages.css`; a few older ones (Usage) are in `styles.css`. Don't scatter one page across both.

## Step 10 — Docs & index sync

Per the repo's docs-stay-in-sync rule, a new page touches **six** doc surfaces. Mirror what `models` / `usage` do:

| File | Edit |
|---|---|
| `docs/content/<section>/<page>.md` | New Hugo page (front matter: `title`, `weight`, `description`) |
| `docs/content/<section>/_index.md` | Add a bullet link |
| `docs/content/features/_index.md` | Add under the matching area |
| `docs/themes/coach/layouts/partials/sidebar.html` | Add a `sidebar__link` |
| `docs/build-pdf.sh` | Add the `.md` to the `FILES` array (in nav order) |
| `AGENTS.md` | Add under the Documentation Index |
| `.cursor/context/architecture.md` | Add `page-<domain>.ts` to the webview tree |

Set `weight` to slot the page where it belongs in its section (siblings use 10, 15, 20…).

## Step 11 — Build and verify

```bash
npm run build      # rebuilds dist/extension.js + dist/webview/app.js
npm run check      # typecheck + lint + spellcheck + knip + test (must be green)
```

Then sanity-check the bundle picked it up:

```bash
rg -c "getMyPageData|mypage-page" dist/webview/app.js   # expect > 0
```

## Gotchas

- **Slug must match** across nav `data-page` and the router `case`, or the page silently renders nothing.
- **knip**: the new analyzer method, RPC entry, and `render<X>` export must all be reachable (umbrella facade + router) or knip flags dead code and `npm run check` fails.
- **Validate params**: route filters through `validateDateFilter`; never pass raw webview input to the analyzer.
- **Serializable results**: the RPC result is JSON — no class instances, functions, or `Map`/`Set` in the returned shape.
- **cspell**: new product/model names in `.ts` must be added to [@cspell.json](mdc:cspell.json).
- **Cursor-only copy**: never mention Copilot, Claude Code, Codex, Gemini, Xcode, or OpenCode in UI/docs text.
- **Billing-aware pages**: if the page gives cost/model advice, branch on the billing model (see `ModelAnalyzer`) — don't assume usage-based.
- After wiring, confirm the webview tree in [@.cursor/context/architecture.md](mdc:.cursor/context/architecture.md) still reads true.
