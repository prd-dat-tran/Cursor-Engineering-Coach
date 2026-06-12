/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Concrete, copy-pasteable "How to improve" guidance for anti-pattern findings.
 *
 * The detection rules already carry a one-line suggestion ("Action"). For
 * tool/config and prompt-quality patterns that's rarely enough — users see they
 * did something sub-optimal but not *how* to fix it. This module maps a rule id
 * to step-by-step remediation (and, where useful, a small example snippet) so
 * the panel always offers an actionable path, with or without an AI provider. */

import { html, type ComponentChildren } from './render';

interface Remediation {
  /** Ordered, actionable steps. */
  steps: string[];
  /** Optional copy-pasteable example (no backticks inside — keep it plain). */
  snippet?: string;
  /** Label shown above the snippet (e.g. the file it belongs in). */
  snippetLabel?: string;
  /** Optional link to the relevant Cursor docs page. */
  docHref?: string;
  docLabel?: string;
}

const RULES_DOC = 'https://cursor.com/docs/context/rules';
const MCP_DOC = 'https://cursor.com/docs/context/mcp';
const MODELS_DOC = 'https://cursor.com/docs/models';

const REMEDIATION: Record<string, Remediation> = {
  'no-custom-instructions': {
    steps: [
      'Add an AGENTS.md at the repo root describing the project: stack, conventions, how to build & test, and key do/don\u2019ts.',
      'For finer control, add .cursor/rules/<name>.mdc files \u2014 they need YAML frontmatter (a plain .md in .cursor/rules is ignored).',
      'Scope a rule to file globs (e.g. src/**/*.ts) so it only loads when relevant and keeps the context lean.',
      'Reopen the Coach after editing so the new instructions are picked up.',
    ],
    snippet: '---\ndescription: TypeScript conventions\nglobs: src/**/*.ts\nalwaysApply: false\n---\n- Prefer named exports; no default exports.\n- Use vitest; colocate tests as *.test.ts.\n- Never edit generated files under dist/.',
    snippetLabel: '.cursor/rules/typescript.mdc',
    docHref: RULES_DOC,
    docLabel: 'Rules docs',
  },
  'no-slash-commands': {
    steps: [
      'Create .cursor/commands/<name>.md \u2014 each file becomes a /command you can run in chat.',
      'Put a repeatable workflow in the file (e.g. \u201Cwrite tests\u201D, \u201Creview the diff\u201D, \u201Crefactor for readability\u201D).',
      'In chat, type / and pick the command instead of re-typing the same instructions every time.',
    ],
    snippet: 'Review the staged git diff for bugs, missing tests, and unclear names.\nReply with a short checklist grouped by file.',
    snippetLabel: '.cursor/commands/review.md',
  },
  'agentic-no-tools': {
    steps: [
      'Use Agent mode (not a one-off ask) so Cursor can read files, run terminal commands, and edit across files to finish the task.',
      'Give the agent tools via MCP: add .cursor/mcp.json to connect servers (databases, browsers, issue trackers) it can call.',
      'Allow the terminal/edits the task actually needs so the agent isn\u2019t limited to chat-only answers.',
    ],
    snippet: '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]\n    }\n  }\n}',
    snippetLabel: '.cursor/mcp.json',
    docHref: MCP_DOC,
    docLabel: 'MCP docs',
  },
  'no-skills': {
    steps: [
      'Create .cursor/skills/<name>/SKILL.md to package a reusable capability the agent auto-loads when relevant.',
      'Describe in the frontmatter when to use it; keep the body focused on one workflow.',
      'Use the Skill Finder page to turn repeated prompts into a skill automatically.',
    ],
    snippet: '---\nname: run-tests\ndescription: Use when asked to run or fix the test suite.\n---\n1. Run the test command (npm test).\n2. Fix failures and re-run until green.',
    snippetLabel: '.cursor/skills/run-tests/SKILL.md',
  },
  'no-plan-mode': {
    steps: [
      'For large or multi-file tasks, switch the chat to Plan mode so the agent proposes an approach before editing.',
      'Review and adjust the plan, then let it execute \u2014 fewer wrong turns and wasted requests.',
      'Keep Agent mode for small, well-defined edits; reach for Plan when the work is ambiguous.',
    ],
  },
  'no-file-context': {
    steps: [
      'Reference concrete files with @file (or @folder) so the agent edits the right code instead of guessing.',
      'Add symbols with @code and external docs with @docs to ground the request.',
      'Paste the failing error text and the file path so the fix targets the real location.',
    ],
    snippet: 'In @src/auth/login.ts, add rate limiting (5/min/IP) using the existing\nRateLimiter. Keep the current return types and add a vitest case.',
    snippetLabel: 'Prompt with context',
  },
  'excessive-file-context': {
    steps: [
      'Attach only the files the task needs \u2014 extra files bloat the context window and dilute focus.',
      'Prefer @folder plus a clear instruction over dumping many individual files.',
      'Split big tasks so each turn works on a small, relevant slice.',
    ],
  },
  'lazy-prompting': {
    steps: [
      'State the intent, the constraints, and the expected output in a single prompt.',
      'Reference the relevant file(s) with @file and paste any error output.',
      'Add acceptance criteria so \u201Cdone\u201D is unambiguous (e.g. \u201Cdone when tests pass\u201D).',
    ],
    snippet: 'Refactor @src/api/client.ts to retry failed GETs (max 3, exponential\nbackoff). Don\u2019t change the public API. Add tests for the retry path.',
    snippetLabel: 'Before: \u201Cfix the client\u201D \u2192 After',
  },
  'caps-lock': {
    steps: [
      'Drop the all-caps \u2014 it does not make the model comply harder and reads as frustration.',
      'Instead, be explicit: list the exact constraint and mark it as a hard requirement.',
      'If the model keeps missing a rule, encode it in .cursor/rules/*.mdc so it always applies.',
    ],
  },
  'repeated-prompts': {
    steps: [
      'If you keep typing the same instruction, capture it once: a .cursor/commands/<name>.md command, a .cursor/rules/*.mdc rule, or a skill.',
      'Use the Skill Finder page to auto-detect repeated prompts and scaffold a skill for you.',
      'Next time, invoke the saved command with / instead of retyping.',
    ],
  },
  'vibe-coding': {
    steps: [
      'Write a 3\u20135 line spec before coding: goal, constraints, and acceptance criteria.',
      'Have the agent plan against the spec (Plan mode), then implement.',
      'Verify the result against the acceptance criteria instead of eyeballing the output.',
    ],
  },
  'no-spec-driven-development': {
    steps: [
      'Capture a short spec (goal + constraints + acceptance criteria) before the agent starts.',
      'Keep it in the repo (e.g. docs/specs/<feature>.md) so it\u2019s reusable context.',
      'Reference the spec with @file and ask the agent to plan against it first.',
    ],
  },
  'no-spec-structure': {
    steps: [
      'Give specs a consistent structure: Goal, Non-goals, Constraints, Acceptance criteria.',
      'Store them under a predictable path so both you and the agent can find them.',
      'Link the spec in the prompt with @file when implementing.',
    ],
  },
  'underpowered-model': {
    steps: [
      'For complex, multi-file, or agentic work, pick a stronger reasoning model in the model selector.',
      'Match the model to the task: heavy reasoning for architecture/refactors, lighter models for trivial edits.',
      'See the Models page for current options and a billing-aware recommendation.',
    ],
    docHref: MODELS_DOC,
    docLabel: 'Models docs',
  },
  'light-model-on-complex-work': {
    steps: [
      'Switch to a stronger model before tackling complex, multi-step, or whole-feature work.',
      'A capable model usually finishes in fewer turns \u2014 often cheaper overall than retrying with a weak one.',
      'Check the Models page to compare effectiveness vs. cost.',
    ],
    docHref: MODELS_DOC,
    docLabel: 'Models docs',
  },
  'model-overreliance': {
    steps: [
      'Use a lighter/faster model for lookups, explanations, and tiny edits to conserve requests.',
      'Reserve premium/max models for genuinely hard, multi-step tasks.',
      'Use the Usage and Models pages to see where your requests are actually going.',
    ],
    docHref: MODELS_DOC,
    docLabel: 'Models docs',
  },
  'premium-for-lookup-questions': {
    steps: [
      'Answer quick \u201Cwhat/where/how\u201D questions with a lighter model or Ask mode.',
      'Save premium models for changes that need real reasoning.',
      'The Models page shows a cheaper default that handles most lookups.',
    ],
    docHref: MODELS_DOC,
    docLabel: 'Models docs',
  },
  'mega-sessions': {
    steps: [
      'Start a fresh chat when the topic changes \u2014 long sessions bloat context and slow responses.',
      'Summarize progress, then open a new session for the next task.',
      'Use a plan / TODOs to keep a long task structured instead of one sprawling thread.',
    ],
  },
  'session-drift': {
    steps: [
      'Keep one session to one goal; spin up a new chat when you switch tasks.',
      'When the thread wanders, summarize the outcome and restart clean.',
      'Plan mode helps anchor a session to a defined scope.',
    ],
  },
  'agent-mode-for-asks': {
    steps: [
      'For pure questions, use Ask mode \u2014 it won\u2019t spend a request editing files.',
      'Switch to Agent only when you actually want changes made.',
    ],
  },
  'low-constraint-usage': {
    steps: [
      'Add explicit constraints to prompts: style, libraries to use/avoid, and return types.',
      'Encode durable constraints in .cursor/rules/*.mdc so you don\u2019t repeat them every time.',
      'Reference the exact files/symbols the change should touch.',
    ],
    docHref: RULES_DOC,
    docLabel: 'Rules docs',
  },
};

function snippetBlock(r: Remediation): ComponentChildren {
  if (!r.snippet) return null;
  const label = r.snippetLabel ? html`<div class="ap-remediation-snippet-label">${r.snippetLabel}</div>` : null;
  return html`<div class="ap-remediation-snippet">${label}<pre><code>${r.snippet}</code></pre></div>`;
}

function docBlock(r: Remediation): ComponentChildren {
  if (!r.docHref) return null;
  const label = r.docLabel || 'Cursor docs';
  return html`<a class="ap-remediation-doc" href=${r.docHref} target="_blank" rel="noreferrer">${label} \u2197</a>`;
}

/** Render the step-by-step remediation panel for a rule, or null if none exists. */
export function renderRemediation(ruleId: string): ComponentChildren {
  const r = REMEDIATION[ruleId];
  if (!r) return null;
  return html`
    <details class="ap-remediation">
      <summary class="ap-remediation-summary">
        <span class="ap-remediation-icon">\u{1F6E0}</span>
        How to improve
        <span class="ap-remediation-hint">step-by-step</span>
      </summary>
      <div class="ap-remediation-body">
        <ol class="ap-remediation-steps">${r.steps.map(s => html`<li>${s}</li>`)}</ol>
        ${snippetBlock(r)}
        ${docBlock(r)}
      </div>
    </details>`;
}
