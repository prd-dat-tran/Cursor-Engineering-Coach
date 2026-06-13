/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal, safe Markdown renderer for coaching copy in the webview.
 *
 * Coaching rules and config advice are authored in Markdown (inline `code`,
 * **bold**, *italic*, links, and bullet / numbered lists). Rendering that copy
 * as a raw string shows literal backticks and asterisks in the UI. This module
 * turns it into Preact vnodes via the auto-escaping `html` tag from ./render,
 * so untrusted text never reaches innerHTML and link href values are checked.
 *
 * Scope is intentionally small: it covers the constructs our rule / advice copy
 * actually uses, not full CommonMark. Only pass *curated coaching copy* here —
 * verbatim user data (example rows, prompt previews) must stay plain so that a
 * stray `*` or backtick in a user's prompt is shown exactly as typed.
 */

import { html, type ComponentChildren } from './render';

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'link'; value: string; href: string };

/* One bounded alternation per construct. Every branch uses a single quantifier
 * over a negated character class, so matching stays linear (no nested
 * quantifiers, no catastrophic backtracking on adversarial input). */
const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ kind: 'text', value: text.slice(last, idx) });
    const [full, code, strong, em, link] = m;
    if (code) {
      tokens.push({ kind: 'code', value: code.slice(1, -1) });
    } else if (strong) {
      tokens.push({ kind: 'strong', value: strong.slice(2, -2) });
    } else if (em) {
      tokens.push({ kind: 'em', value: em.slice(1, -1) });
    } else {
      const sep = link.indexOf('](');
      const label = link.slice(1, sep);
      const href = link.slice(sep + 2, -1);
      if (SAFE_LINK.test(href)) tokens.push({ kind: 'link', value: label, href });
      else tokens.push({ kind: 'text', value: full });
    }
    last = idx + full.length;
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) });
  return tokens;
}

/** Render a single line of inline markdown to escaped Preact children. */
export function mdInline(text: string): ComponentChildren {
  return tokenizeInline(text).map((t) => {
    switch (t.kind) {
      case 'code': return html`<code class="md-code">${t.value}</code>`;
      case 'strong': return html`<strong>${t.value}</strong>`;
      case 'em': return html`<em>${t.value}</em>`;
      case 'link': return html`<a class="md-link" href=${t.href} target="_blank" rel="noreferrer noopener">${t.value}</a>`;
      default: return t.value;
    }
  });
}

type BlockKind = 'p' | 'ul' | 'ol' | 'pre' | 'h';
export interface MdBlock { kind: BlockKind; items: string[]; level?: number }

const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+\.\s+(.*)$/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s*```/;

/**
 * Split coaching / AI copy into blocks: fenced code, headings, bullet and
 * numbered lists, and paragraphs. Soft single newlines join into one paragraph
 * (Markdown semantics); blank lines start a new block. Richer than the rule
 * copy needs, because the AI "Why?/Improve" explainer returns full Markdown.
 */
export function splitBlocks(text: string): MdBlock[] {
  const lines = text.split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'p', items: [para.join(' ')] });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (FENCE_RE.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) { code.push(lines[i]); i++; }
      blocks.push({ kind: 'pre', items: code });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = HEADING_RE.exec(line);
    if (heading) { flush(); blocks.push({ kind: 'h', items: [heading[2]], level: heading[1].length }); continue; }
    const bullet = BULLET_RE.exec(line);
    if (bullet) { flush(); appendItem(blocks, 'ul', bullet[1]); continue; }
    const numbered = NUMBERED_RE.exec(line);
    if (numbered) { flush(); appendItem(blocks, 'ol', numbered[1]); continue; }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

function appendItem(blocks: MdBlock[], kind: 'ul' | 'ol', item: string): void {
  const prev = blocks[blocks.length - 1];
  if (prev?.kind === kind) prev.items.push(item);
  else blocks.push({ kind, items: [item] });
}

function renderBlock(b: MdBlock): ComponentChildren {
  switch (b.kind) {
    case 'ul': return html`<ul class="md-list">${b.items.map((li) => html`<li>${mdInline(li)}</li>`)}</ul>`;
    case 'ol': return html`<ol class="md-list">${b.items.map((li) => html`<li>${mdInline(li)}</li>`)}</ol>`;
    case 'pre': return html`<pre class="md-pre"><code>${b.items.join('\n')}</code></pre>`;
    case 'h': return html`<p class=${`md-h md-h${b.level ?? 3}`}>${mdInline(b.items[0])}</p>`;
    default: return html`<p class="md-p">${mdInline(b.items[0])}</p>`;
  }
}

/**
 * Render a block of coaching / AI copy (paragraphs, lists, headings, fenced
 * code + inline formatting). A single plain paragraph renders inline (no <p>
 * wrapper) so existing single-line containers keep their layout — only the
 * formatting changes.
 */
export function mdBlock(text: string): ComponentChildren {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const blocks = splitBlocks(trimmed);
  if (blocks.length === 1 && blocks[0].kind === 'p') {
    return mdInline(blocks[0].items[0]);
  }
  return blocks.map(renderBlock);
}
