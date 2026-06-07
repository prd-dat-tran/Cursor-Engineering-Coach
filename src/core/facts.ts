/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cursor "facts" — the single source of truth for volatile, frequently-changing
 * Cursor data: model request-cost multipliers, per-token rates, plan credits,
 * and the curated model catalog.
 *
 * Fact sync is deliberately MAINTAINER-ONLY: the bundled manifest
 * (`data/cursor-facts.json`) is the single source of truth and the only thing
 * the running extension reads. There is no runtime auto-refresh. A maintainer
 * updates the manifest on demand (`npm run facts:refresh`, or by hand) and ships
 * it in an extension release; the in-IDE Changelog page flags when a sync may be
 * warranted. `validateFacts` gates the quality of that maintainer-committed JSON
 * (exercised by `cursor-facts.test.ts`, which CI runs after a refresh).
 *
 * This module is intentionally dependency-free (no `vscode`, no `fs`, no `zod`)
 * so it runs unchanged in the analyzer worker threads and in the webview bundle,
 * and so importing it never bloats those bundles. Validation is done with small
 * hand-rolled type guards.
 */

import bundled from './data/cursor-facts.json';

export interface FactsTokenRate {
  input: number;
  cached: number;
  output: number;
  cacheWrite?: number;
}

export type ModelStatus = 'active' | 'hidden' | 'deprecated';

export interface ModelFact {
  /** Normalized model id, e.g. `claude-opus-4.8`. */
  id: string;
  family?: string;
  status?: ModelStatus;
  /** Request-cost multiplier: 0 = included/free, <1 = light, 1 = standard, >1 = frontier. */
  multiplier: number;
  /** Per-token rate in USD per 1M tokens (omitted for models without a published rate). */
  tokenRate?: FactsTokenRate;
}

export interface CatalogFact {
  id: string;
  bestFor: string;
}

export type FactsBillingModel = 'usage-based' | 'request-based';

export interface PlanFact {
  id: string;
  label: string;
  priceUsdMonthly?: number;
  includedApiUsd?: number;
  /** SKU id for credit budgets (falls back to `id`). */
  skuId?: string;
  skuCredits?: number;
  billing: FactsBillingModel;
}

export interface CursorFacts {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  models: ModelFact[];
  catalog: CatalogFact[];
  plans: PlanFact[];
}

export interface FactsMeta {
  generatedAt: string;
  source: string;
  schemaVersion: number;
  modelCount: number;
}

/** Schema version the running code understands. */
export const FACTS_SCHEMA_VERSION = 1;

/** The bundled manifest is immutable at runtime — fact sync is maintainer-only. */
const FACTS: CursorFacts = bundled as unknown as CursorFacts;

// Derived lookup caches, computed once (facts never change at runtime).
let multCache: Record<string, number> | null = null;
let rateCache: Record<string, FactsTokenRate> | null = null;
let skuCache: Record<string, number> | null = null;

export function getActiveFacts(): CursorFacts {
  return FACTS;
}

export function getFactsMeta(): FactsMeta {
  return {
    generatedAt: FACTS.generatedAt,
    source: FACTS.source,
    schemaVersion: FACTS.schemaVersion,
    modelCount: FACTS.models.length,
  };
}

/** Model id -> request-cost multiplier (cached). */
export function getModelMultipliers(): Record<string, number> {
  if (!multCache) {
    const m: Record<string, number> = {};
    for (const model of FACTS.models) m[model.id] = model.multiplier;
    multCache = m;
  }
  return multCache;
}

/** Model id -> per-token rate, for models that have a published rate (cached). */
export function getModelTokenRates(): Record<string, FactsTokenRate> {
  if (!rateCache) {
    const r: Record<string, FactsTokenRate> = {};
    for (const model of FACTS.models) if (model.tokenRate) r[model.id] = model.tokenRate;
    rateCache = r;
  }
  return rateCache;
}

/** SKU id -> AI-credit budget (cached). */
export function getSkuCredits(): Record<string, number> {
  if (!skuCache) {
    const s: Record<string, number> = {};
    for (const plan of FACTS.plans) {
      if (typeof plan.skuCredits === 'number') s[plan.skuId ?? plan.id] = plan.skuCredits;
    }
    skuCache = s;
  }
  return skuCache;
}

/** Ordered display catalog of notable models. */
export function getCatalog(): CatalogFact[] {
  return FACTS.catalog;
}

/** Plan facts (price, included usage, credits, billing model). */
export function getPlanFacts(): PlanFact[] {
  return FACTS.plans;
}

/**
 * True when a (already-normalized) model id is known to the manifest, either
 * exactly or by prefix. Used to badge brand-new models as "facts pending".
 */
export function isKnownModel(norm: string): boolean {
  const multipliers = getModelMultipliers();
  if (multipliers[norm] !== undefined) return true;
  for (const k of Object.keys(multipliers)) if (norm.startsWith(k)) return true;
  return false;
}

/**
 * Heuristic request-cost multiplier for a model that is NOT in the manifest yet,
 * so a brand-new Cursor model degrades to a sane tier instead of a flat guess.
 * Order matters: frontier (opus) and Cursor (composer) families are checked
 * before the light-family keywords so an "opus-mini" style id still reads as
 * frontier.
 */
export function inferModelTier(norm: string): number {
  const m = norm.toLowerCase();
  if (/auto/.test(m)) return 1;
  if (/opus/.test(m)) return 3;
  if (/composer/.test(m)) return 1;
  if (/(haiku|mini|nano|flash|lite|micro)/.test(m)) return 0.33;
  if (/(sonnet|gpt-[4-9]|gemini.*pro|grok-[4-9]|o[1-9])/.test(m)) return 1;
  return 1;
}

/* ── Schema validation (gates the maintainer-committed manifest) ──── */

function isTokenRate(v: unknown): v is FactsTokenRate {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.input === 'number' &&
    typeof r.cached === 'number' &&
    typeof r.output === 'number' &&
    (r.cacheWrite === undefined || typeof r.cacheWrite === 'number')
  );
}

function isModelFact(v: unknown): v is ModelFact {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== 'string' || m.id.length === 0) return false;
  if (typeof m.multiplier !== 'number' || Number.isNaN(m.multiplier) || m.multiplier < 0) return false;
  if (m.tokenRate !== undefined && !isTokenRate(m.tokenRate)) return false;
  return true;
}

function isCatalogFact(v: unknown): v is CatalogFact {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === 'string' && c.id.length > 0 && typeof c.bestFor === 'string';
}

function isPlanFact(v: unknown): v is PlanFact {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.label === 'string' &&
    (p.billing === 'usage-based' || p.billing === 'request-based')
  );
}

/**
 * Validate a candidate manifest into `CursorFacts`, or return null. Used to gate
 * the JSON a maintainer commits (the refresh script's output, checked in
 * `cursor-facts.test.ts`), not to apply anything at runtime.
 */
export function validateFacts(raw: unknown): CursorFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const { schemaVersion, generatedAt, source, models, catalog, plans } = f;
  if (typeof schemaVersion !== 'number') return null;
  if (typeof generatedAt !== 'string' || generatedAt.length === 0) return null;
  if (typeof source !== 'string') return null;
  if (!Array.isArray(models) || models.length === 0 || !models.every(isModelFact)) return null;
  if (!Array.isArray(catalog) || !catalog.every(isCatalogFact)) return null;
  if (!Array.isArray(plans) || !plans.every(isPlanFact)) return null;
  return { schemaVersion, generatedAt, source, models, catalog, plans };
}
