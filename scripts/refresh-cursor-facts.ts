/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Refresh `src/core/data/cursor-facts.json` from Cursor's public Models &
 * Pricing documentation.
 *
 *   npm run facts:refresh           # fetch + update the manifest
 *   npx tsx scripts/refresh-cursor-facts.ts --check   # fail if it would change
 *
 * Design goals (conservative + defensive — output is reviewed via a CI PR):
 *  - Fetches the docs page and exits non-zero if the fetch fails or the pricing
 *    table cannot be located, so a format change is noticed instead of writing
 *    garbage over good data.
 *  - Updates per-token rates for models it can confidently map to existing ids.
 *  - Adds clearly-new models with an inferred multiplier for human review.
 *  - Never deletes curated entries; multiplier/catalog/plan curation stays human.
 *  - Only rewrites the file (and bumps `generatedAt`) when something changed,
 *    keeping the compact committed formatting so diffs stay small.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  inferModelTier,
  type CursorFacts,
  type ModelFact,
  type CatalogFact,
  type PlanFact,
  type FactsTokenRate,
} from '../src/core/facts';

// Cursor docs run on Mintlify, which serves the raw Markdown (with the pricing
// table) at the `.md` suffix — the rendered HTML page is a JS SPA shell.
const FETCH_URL = 'https://cursor.com/docs/models-and-pricing.md';
const SOURCE_URL = 'https://cursor.com/docs/models-and-pricing';
const MANIFEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'core',
  'data',
  'cursor-facts.json',
);
const MIN_ROWS = 5;
const CHECK_ONLY = process.argv.includes('--check');

interface ParsedRow {
  name: string;
  provider?: string;
  input?: number;
  cacheWrite?: number;
  cacheRead?: number;
  output?: number;
}

function num(s: string): number | undefined {
  const m = s.replace(/[$,]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}

/** Reduce a Markdown link `[text](url)` (or bare text) to its display text. */
function linkText(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

/** Parse the pricing table from either a Markdown (MDX) or HTML rendering. */
function extractRows(body: string): ParsedRow[] {
  const rows: ParsedRow[] = [];

  // Markdown pipe table: "| Model | Provider | Input | Cache write | Cache read | Output | ... |"
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    const cells = t.slice(1, -1).split('|').map(c => c.trim());
    if (cells.length < 6) continue;
    if (/^:?-+:?$/.test(cells[0]) || /\bmodel\b/i.test(cells[0])) continue; // header/divider
    const input = num(cells[2]);
    const output = num(cells[5]);
    if (input === undefined || output === undefined) continue;
    rows.push({ name: linkText(cells[0]), provider: cells[1], input, cacheWrite: num(cells[3]), cacheRead: num(cells[4]), output });
  }
  if (rows.length >= MIN_ROWS) return rows;

  // HTML table fallback.
  const trs = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of trs) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(stripTags);
    if (cells.length < 6) continue;
    const input = num(cells[2]);
    const output = num(cells[5]);
    if (input === undefined || output === undefined) continue;
    rows.push({ name: linkText(cells[0]), provider: cells[1], input, cacheWrite: num(cells[3]), cacheRead: num(cells[4]), output });
  }
  return rows;
}

/**
 * Best-effort map a display name + provider to our normalized model id.
 * Handles Anthropic's word-order ("Claude 4.5 Haiku" -> claude-haiku-4.5) and
 * the variant suffixes that must NOT clobber the base model's rate:
 * "(Fast mode)" -> `-fast`, "1M" -> `-1m`.
 */
function deriveId(name: string, provider?: string): string | null {
  const lower = name.toLowerCase();
  const base = lower.replace(/\(.*?\)/g, ' ').trim();
  const isFast = /\bfast\b/.test(lower);
  const is1m = /\b1m\b/.test(lower);
  const suffix = `${isFast ? '-fast' : ''}${is1m ? '-1m' : ''}`;
  if (base.includes('claude') || (provider ?? '').toLowerCase().includes('anthropic')) {
    const variant = base.match(/\b(opus|sonnet|haiku)\b/)?.[1];
    const ver = base.match(/\b\d+(?:\.\d+)?\b/)?.[0];
    if (variant && ver) return `claude-${variant}-${ver}${suffix}`;
    return null;
  }
  const slug = lower.replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9.+-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : null;
}

function familyOf(id: string): string {
  if (/auto/i.test(id)) return 'Auto';
  if (id.startsWith('composer')) return 'Composer';
  if (id.startsWith('claude')) return 'Claude';
  if (/^(gpt|o\d)/.test(id)) return 'GPT';
  if (id.startsWith('gemini')) return 'Gemini';
  if (id.startsWith('grok')) return 'Grok';
  return 'Other';
}

function toRate(r: ParsedRow): FactsTokenRate | undefined {
  if (r.input === undefined || r.output === undefined) return undefined;
  const rate: FactsTokenRate = { input: r.input, cached: r.cacheRead ?? 0, output: r.output };
  if (r.cacheWrite !== undefined) rate.cacheWrite = r.cacheWrite;
  return rate;
}

/* ── Compact serializer (matches the committed formatting) ──────────── */

function emit(pairs: Array<[string, string | undefined]>): string {
  return `{ ${pairs.filter(([, v]) => v !== undefined).map(([k, v]) => `"${k}": ${v}`).join(', ')} }`;
}
const j = (v: unknown): string => JSON.stringify(v);
const opt = (v: unknown): string | undefined => (v === undefined ? undefined : j(v));

function emitRate(r: FactsTokenRate): string {
  return emit([['input', j(r.input)], ['cached', j(r.cached)], ['output', j(r.output)], ['cacheWrite', opt(r.cacheWrite)]]);
}
function emitModel(m: ModelFact): string {
  return emit([
    ['id', j(m.id)], ['family', opt(m.family)], ['status', opt(m.status)],
    ['multiplier', j(m.multiplier)], ['tokenRate', m.tokenRate ? emitRate(m.tokenRate) : undefined],
  ]);
}
function emitCatalog(c: CatalogFact): string {
  return emit([['id', j(c.id)], ['bestFor', j(c.bestFor)]]);
}
function emitPlan(p: PlanFact): string {
  return emit([
    ['id', j(p.id)], ['label', j(p.label)], ['priceUsdMonthly', opt(p.priceUsdMonthly)],
    ['includedApiUsd', opt(p.includedApiUsd)], ['skuId', opt(p.skuId)], ['skuCredits', opt(p.skuCredits)],
    ['billing', j(p.billing)],
  ]);
}
function serialize(f: CursorFacts): string {
  return [
    '{',
    `  "schemaVersion": ${j(f.schemaVersion)},`,
    `  "generatedAt": ${j(f.generatedAt)},`,
    `  "source": ${j(f.source)},`,
    '  "models": [',
    f.models.map(m => '    ' + emitModel(m)).join(',\n'),
    '  ],',
    '  "catalog": [',
    f.catalog.map(c => '    ' + emitCatalog(c)).join(',\n'),
    '  ],',
    '  "plans": [',
    f.plans.map(p => '    ' + emitPlan(p)).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  let body: string;
  try {
    const res = await fetch(FETCH_URL, { headers: { 'user-agent': 'cursor-engineering-coach facts refresher' } });
    if (!res.ok) {
      console.error(`Fetch failed: HTTP ${res.status} for ${FETCH_URL}`);
      process.exit(1);
    }
    body = await res.text();
  } catch (err) {
    console.error(`Fetch error for ${FETCH_URL}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const rows = extractRows(body);
  if (rows.length < MIN_ROWS) {
    console.error(`Only ${rows.length} pricing rows parsed (need >= ${MIN_ROWS}). The docs layout may have changed — aborting without writing.`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as CursorFacts;
  const byId = new Map(manifest.models.map(m => [m.id, m]));
  const updatedIds: string[] = [];
  const addedIds: string[] = [];
  const unmatched: string[] = [];

  for (const row of rows) {
    const id = deriveId(row.name, row.provider);
    if (!id) {
      unmatched.push(row.name);
      continue;
    }
    const rate = toRate(row);
    const existing = byId.get(id);
    if (existing) {
      if (rate && JSON.stringify(existing.tokenRate) !== JSON.stringify(rate)) {
        existing.tokenRate = rate;
        updatedIds.push(id);
      }
    } else {
      const model: ModelFact = {
        id,
        family: familyOf(id),
        status: 'active',
        multiplier: inferModelTier(id),
        ...(rate ? { tokenRate: rate } : {}),
      };
      manifest.models.push(model);
      byId.set(id, model);
      addedIds.push(id);
    }
  }

  if (unmatched.length > 0) {
    console.log(`Note: ${unmatched.length} table row(s) could not be mapped to an id (review manually): ${unmatched.join(', ')}`);
  }
  if (updatedIds.length > 0) console.log(`Rate updates: ${updatedIds.join(', ')}`);
  if (addedIds.length > 0) console.log(`New models: ${addedIds.join(', ')}`);

  if (updatedIds.length === 0 && addedIds.length === 0) {
    console.log(`cursor-facts.json is already up to date (${rows.length} rows checked).`);
    return;
  }

  if (CHECK_ONLY) {
    console.error(`Drift detected: ${updatedIds.length} rate change(s), ${addedIds.length} new model(s). Run "npm run facts:refresh" to update.`);
    process.exit(1);
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.source = SOURCE_URL;
  fs.writeFileSync(MANIFEST, serialize(manifest));
  console.log(`Updated ${updatedIds.length} rate(s) and added ${addedIds.length} model(s). Wrote ${path.relative(process.cwd(), MANIFEST)}.`);
  if (addedIds.length > 0) {
    console.log('New models were added with an inferred multiplier — review the multiplier and add catalog "bestFor" copy if notable.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
