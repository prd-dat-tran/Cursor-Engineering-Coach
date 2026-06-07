/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import {
  FACTS_SCHEMA_VERSION,
  getActiveFacts,
  getFactsMeta,
  getModelMultipliers,
  getModelTokenRates,
  getSkuCredits,
  getCatalog,
  getPlanFacts,
  isKnownModel,
  inferModelTier,
  validateFacts,
  type CursorFacts,
} from './facts';
import { MODEL_MULTIPLIERS, MODEL_TOKEN_RATES, SKU_AI_CREDITS } from './constants';
import { modelMultiplier } from './helpers';

const validManifest: CursorFacts = {
  schemaVersion: 1,
  generatedAt: '2026-06-08T00:00:00Z',
  source: 'unit-test',
  models: [
    { id: 'test-model', family: 'Other', status: 'active', multiplier: 2, tokenRate: { input: 1, cached: 0.1, output: 2 } },
  ],
  catalog: [{ id: 'test-model', bestFor: 'testing' }],
  plans: [{ id: 'pro', label: 'Pro', skuCredits: 1234, billing: 'usage-based' }],
};

describe('cursor-facts manifest invariants', () => {
  const facts = getActiveFacts();

  it('declares the schema version the code understands', () => {
    expect(facts.schemaVersion).toBe(FACTS_SCHEMA_VERSION);
  });

  it('has an ISO-8601 generatedAt timestamp', () => {
    expect(facts.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(facts.generatedAt))).toBe(false);
  });

  it('has at least one model and every model has a non-negative multiplier', () => {
    expect(facts.models.length).toBeGreaterThan(0);
    for (const m of facts.models) {
      expect(typeof m.id, `model id`).toBe('string');
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.multiplier, `${m.id} multiplier`).toBeGreaterThanOrEqual(0);
    }
  });

  it('every token rate has positive input and output', () => {
    for (const m of facts.models) {
      if (!m.tokenRate) continue;
      expect(m.tokenRate.input, `${m.id} input`).toBeGreaterThan(0);
      expect(m.tokenRate.output, `${m.id} output`).toBeGreaterThan(0);
      expect(m.tokenRate.cached, `${m.id} cached`).toBeGreaterThanOrEqual(0);
    }
  });

  it('has unique model ids', () => {
    const ids = facts.models.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every catalog id refers to a known model', () => {
    const ids = new Set(facts.models.map(m => m.id));
    for (const c of getCatalog()) {
      expect(ids.has(c.id), `catalog id ${c.id} should exist in models`).toBe(true);
      expect(c.bestFor.length).toBeGreaterThan(0);
    }
  });

  it('every plan has a valid billing model', () => {
    for (const p of getPlanFacts()) {
      expect(['usage-based', 'request-based']).toContain(p.billing);
      if (p.skuCredits !== undefined) expect(p.skuCredits).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('derived lookup maps', () => {
  it('reproduces the constants multiplier map', () => {
    const multipliers = getModelMultipliers();
    for (const [k, v] of Object.entries(MODEL_MULTIPLIERS)) {
      expect(multipliers[k], `${k} multiplier`).toBe(v);
    }
    expect(Object.keys(multipliers).length).toBe(Object.keys(MODEL_MULTIPLIERS).length);
  });

  it('reproduces the constants token-rate map', () => {
    const rates = getModelTokenRates();
    for (const [k, v] of Object.entries(MODEL_TOKEN_RATES)) {
      expect(rates[k], `${k} rate`).toEqual(v);
    }
  });

  it('derives SKU credits from plans (pro/pro-plus/business/enterprise)', () => {
    const sku = getSkuCredits();
    expect(sku).toEqual(SKU_AI_CREDITS);
    expect(sku['pro']).toBe(1000);
    expect(sku['pro-plus']).toBe(3900);
    expect(sku['business']).toBe(1900);
    expect(sku['enterprise']).toBe(3900);
  });
});

describe('inferModelTier (graceful handling of unknown models)', () => {
  it('treats Opus as frontier', () => {
    expect(inferModelTier('claude-opus-9')).toBe(3);
  });
  it('treats light families as cheap', () => {
    expect(inferModelTier('claude-haiku-9')).toBe(0.33);
    expect(inferModelTier('gpt-9-nano')).toBe(0.33);
    expect(inferModelTier('gemini-9-flash')).toBe(0.33);
  });
  it('treats Auto and standard frontier as 1', () => {
    expect(inferModelTier('auto')).toBe(1);
    expect(inferModelTier('gpt-9')).toBe(1);
    expect(inferModelTier('claude-sonnet-9')).toBe(1);
  });
  it('defaults a totally unknown id to standard (1)', () => {
    expect(inferModelTier('something-brand-new')).toBe(1);
  });
});

describe('isKnownModel', () => {
  it('recognizes exact and prefixed manifest ids', () => {
    expect(isKnownModel('claude-opus-4.8')).toBe(true);
    expect(isKnownModel('claude-opus-4.8-high')).toBe(true);
    expect(isKnownModel('auto')).toBe(true);
  });
  it('returns false for unknown ids', () => {
    expect(isKnownModel('made-up-model-name')).toBe(false);
  });
});

describe('modelMultiplier integration with facts', () => {
  it('uses manifest multipliers for known models', () => {
    expect(modelMultiplier('claude-opus-4.8')).toBe(7.5);
    expect(modelMultiplier('gpt-4.1')).toBe(0);
  });
  it('infers a sane tier for a brand-new model id', () => {
    expect(modelMultiplier('claude-opus-9')).toBe(3);
    expect(modelMultiplier('totally-unknown-model')).toBe(1);
  });
});

describe('getFactsMeta', () => {
  it('reports the bundled manifest provenance', () => {
    const meta = getFactsMeta();
    expect(meta.schemaVersion).toBe(FACTS_SCHEMA_VERSION);
    expect(meta.modelCount).toBe(getActiveFacts().models.length);
    expect(meta.source.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(meta.generatedAt))).toBe(false);
  });
});

describe('validateFacts (gates the maintainer-committed manifest)', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateFacts(validManifest)).not.toBeNull();
  });

  it('rejects junk and malformed payloads', () => {
    expect(validateFacts('nope')).toBeNull();
    expect(validateFacts(null)).toBeNull();
    expect(validateFacts({})).toBeNull();
    expect(validateFacts({ ...validManifest, models: [] })).toBeNull();
    expect(validateFacts({ ...validManifest, models: [{ id: 'x' }] })).toBeNull();
  });

  it('does not mutate the active (bundled) facts', () => {
    validateFacts(validManifest);
    expect(getModelMultipliers()['claude-opus-4.8']).toBe(7.5);
    expect(getModelMultipliers()['test-model']).toBeUndefined();
  });
});
