/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Model advisor — turns the user's own model usage plus their billing model
 * into best-fit recommendations that balance effectiveness and cost. */

import { AnalyzerBase } from './analyzer-base';
import {
  DateFilter, ModelClass, ModelInsightsData, ModelStat, ModelVerdict, ModelCatalogItem, ModelRecRow,
} from './types';
import { normalizeModel, modelMultiplier } from './helpers';
import { BillingProfile, DEFAULT_BILLING_PROFILE, isRequestBased } from './billing';

/* ── Classification helpers ──────────────────────────────────────── */

/** Map a request multiplier to a capability/cost class.
 *  0 = included/free, <1 = light, 1 = standard premium, >1 = frontier. */
export function classifyModel(norm: string, mult: number): ModelClass {
  if (/auto/i.test(norm)) return 'auto';
  if (mult === 0) return 'free';
  if (mult < 1) return 'light';
  if (mult > 1) return 'frontier';
  return 'standard';
}

export function modelFamily(norm: string): string {
  if (/auto/i.test(norm)) return 'Auto';
  if (norm.startsWith('composer')) return 'Composer';
  if (norm.startsWith('claude')) return 'Claude';
  if (/^(gpt|o\d)/.test(norm)) return 'GPT';
  if (norm.startsWith('gemini')) return 'Gemini';
  if (norm.startsWith('grok')) return 'Grok';
  return 'Other';
}

/** claude-opus-4.7 → "Claude Opus 4.7"; gpt-5.4-mini → "GPT 5.4 Mini". */
export function modelLabel(norm: string): string {
  if (/auto/i.test(norm)) return 'Auto';
  return norm
    .split('-')
    .map(part => {
      if (/^\d/.test(part)) return part;
      if (part === 'gpt') return 'GPT';
      if (/^o\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/* ── Curated reference catalog (notable models available in Cursor) ── */
/* Multipliers are looked up from the live rate table so this list never
 * drifts from constants.ts — only the id + "best for" copy lives here. */

const CATALOG: { id: string; bestFor: string }[] = [
  { id: 'claude-opus-4.8', bestFor: 'Hardest reasoning — large multi-file refactors, deep debugging, architecture.' },
  { id: 'claude-opus-4.7', bestFor: 'Heavy agentic coding and complex multi-step features.' },
  { id: 'claude-sonnet-4.6', bestFor: 'Fast, dependable everyday agentic coding.' },
  { id: 'gpt-5.5', bestFor: 'Top-tier reasoning and persistence on long-running tasks.' },
  { id: 'gpt-5.4', bestFor: 'Strong general-purpose coding with solid reasoning.' },
  { id: 'composer-2.5', bestFor: "Cursor's own fast agentic model — cost-efficient everyday coding from the cheaper pool." },
  { id: 'gemini-3.1-pro', bestFor: 'Large-context reads and multi-file understanding.' },
  { id: 'claude-haiku-4.5', bestFor: 'Quick edits and cheap, low-stakes changes.' },
  { id: 'gpt-5.4-mini', bestFor: 'Routine tasks at a fraction of the cost.' },
  { id: 'gemini-3-flash', bestFor: 'Fast, cheap responses for simple work.' },
  { id: 'grok-4.3', bestFor: 'Snappy responses for low-stakes edits.' },
  { id: 'gpt-5-mini', bestFor: 'Included lightweight model for lookups and boilerplate.' },
  { id: 'auto', bestFor: 'Cursor routes per task from the cheaper pool — a great default.' },
];

/* ── Analyzer ────────────────────────────────────────────────────── */

interface Acc {
  requests: number;
  loc: number;
  cancelled: number;
  agentic: number;
  mult: number;
}

function billingKind(billing: BillingProfile): ModelInsightsData['billingModel'] {
  if (!billing.configured) return 'unknown';
  return isRequestBased(billing) ? 'request' : 'usage';
}

/** Turn the per-model accumulators into scored stats and bucket totals. */
function buildStats(
  byModel: Map<string, Acc>,
  withModel: number,
  billingModel: ModelInsightsData['billingModel'],
): { models: ModelStat[]; frontierReqs: number; lightReqs: number; autoReqs: number } {
  let frontierReqs = 0, lightReqs = 0, autoReqs = 0;
  const models: ModelStat[] = [];
  for (const [norm, acc] of byModel) {
    const klass = classifyModel(norm, acc.mult);
    if (klass === 'auto') autoReqs += acc.requests;
    else if (klass === 'frontier' || klass === 'standard') frontierReqs += acc.requests;
    else lightReqs += acc.requests;

    const avgAiLoc = acc.requests > 0 ? acc.loc / acc.requests : 0;
    const cancelRate = acc.requests > 0 ? acc.cancelled / acc.requests : 0;
    const agenticShare = acc.requests > 0 ? acc.agentic / acc.requests : 0;
    models.push({
      model: norm,
      label: modelLabel(norm),
      family: modelFamily(norm),
      klass,
      multiplier: acc.mult,
      requests: acc.requests,
      share: withModel > 0 ? acc.requests / withModel : 0,
      avgAiLoc: Math.round(avgAiLoc),
      cancelRate,
      agenticShare,
      verdict: verdictFor(klass, billingModel, { avgAiLoc, cancelRate, agenticShare, requests: acc.requests }),
    });
  }
  models.sort((a, b) => b.requests - a.requests);
  return { models, frontierReqs, lightReqs, autoReqs };
}

export class ModelAnalyzer extends AnalyzerBase {
  private readonly billing: BillingProfile;

  constructor(
    sessions: ConstructorParameters<typeof AnalyzerBase>[0],
    editLocIndex: ConstructorParameters<typeof AnalyzerBase>[1],
    sharedMap?: ConstructorParameters<typeof AnalyzerBase>[2],
    billing: BillingProfile = DEFAULT_BILLING_PROFILE,
  ) {
    super(sessions, editLocIndex, sharedMap);
    this.billing = billing;
  }

  getModelInsights(f?: DateFilter): ModelInsightsData {
    const reqs = this.filter(f);
    const totalRequests = reqs.length;
    const byModel = new Map<string, Acc>();
    let withModel = 0;
    let cancelledAll = 0;

    for (const r of reqs) {
      if (r.isCanceled) cancelledAll++;
      if (!r.modelId) continue;
      withModel++;
      const norm = normalizeModel(r.modelId);
      const acc = byModel.get(norm) ?? { requests: 0, loc: 0, cancelled: 0, agentic: 0, mult: modelMultiplier(norm) };
      acc.requests++;
      acc.loc += this.requestLoc(r);
      if (r.isCanceled) acc.cancelled++;
      if (r.toolsUsed.length > 0 || r.editedFiles.length > 0) acc.agentic++;
      byModel.set(norm, acc);
    }

    const billingModel = billingKind(this.billing);
    const { models, frontierReqs, lightReqs, autoReqs } = buildStats(byModel, withModel, billingModel);

    const frontierShare = withModel > 0 ? frontierReqs / withModel : 0;
    const lightShare = withModel > 0 ? lightReqs / withModel : 0;
    const autoShare = withModel > 0 ? autoReqs / withModel : 0;
    const cancelledShare = totalRequests > 0 ? cancelledAll / totalRequests : 0;

    const usedSet = new Set(models.map(m => m.model));
    const catalog: ModelCatalogItem[] = CATALOG.map(c => {
      const norm = normalizeModel(c.id);
      const mult = modelMultiplier(norm);
      return {
        label: modelLabel(norm),
        family: modelFamily(norm),
        klass: classifyModel(norm, mult),
        multiplier: mult,
        bestFor: c.bestFor,
        used: usedSet.has(norm),
      };
    });

    return {
      billingModel,
      totalRequests,
      withModel,
      distinctModels: models.length,
      frontierShare,
      lightShare,
      autoShare,
      cancelledShare,
      headline: headlineFor(billingModel, frontierShare),
      topPick: topPickFor(billingModel, models),
      models,
      recommendations: RECS[billingModel],
      catalog,
    };
  }
}

/* ── Pure helpers (exported for tests) ───────────────────────────── */

interface VerdictSignals { avgAiLoc: number; cancelRate: number; agenticShare: number; requests: number }

export function verdictFor(klass: ModelClass, billing: ModelInsightsData['billingModel'], s: VerdictSignals): ModelVerdict {
  // Wasted requests trump everything: cancellations cost the same on any plan.
  if (s.requests >= 5 && s.cancelRate > 0.25) {
    return { kind: 'high-cancel', label: 'High cancel rate', tone: 'warn', detail: `${Math.round(s.cancelRate * 100)}% of these requests were cancelled — wasted spend regardless of model.` };
  }
  if (billing === 'request') {
    if (klass === 'light' || klass === 'free' || klass === 'auto') {
      return { kind: 'underpowered', label: 'Underpowered for your plan', tone: 'warn', detail: 'On request-based billing a lighter model costs the same as the best one — default to a frontier model.' };
    }
    return { kind: 'good-fit', label: 'Strong choice', tone: 'good', detail: 'Capable model — the right call when every request is a flat charge.' };
  }
  if (billing === 'usage') {
    if (klass === 'frontier' && s.avgAiLoc < 15 && s.agenticShare < 0.3) {
      return { kind: 'overkill', label: 'Likely overkill', tone: 'warn', detail: 'Premium model on light work — route quick questions and small edits to a standard or free model to save tokens.' };
    }
    if ((klass === 'light' || klass === 'free') && s.agenticShare > 0.6) {
      return { kind: 'maybe-underpowered', label: 'Watch quality', tone: 'info', detail: 'A light model is doing agentic work — fine if results hold, but step up for complex, multi-file tasks.' };
    }
    return { kind: 'good-fit', label: 'Reasonable fit', tone: 'good', detail: 'Capability looks matched to the work.' };
  }
  return { kind: 'neutral', label: 'Set your plan', tone: 'info', detail: 'Set your billing model in settings for tailored model advice.' };
}

export function headlineFor(billing: ModelInsightsData['billingModel'], frontierShare: number): ModelInsightsData['headline'] {
  const pct = Math.round(frontierShare * 100);
  if (billing === 'request') {
    return {
      title: 'Use the most capable model — it costs the same on your plan',
      body: `You're on request-based billing: every request costs the same flat amount no matter which model runs it. Default to a frontier model and spend your effort reducing the NUMBER of requests, not the model. Right now ${pct}% of your model-bearing requests use a frontier/standard model.`,
      tone: frontierShare >= 0.7 ? 'good' : 'warn',
    };
  }
  if (billing === 'usage') {
    return {
      title: 'Match the model to the task',
      body: `You're on usage-based (token) billing: stronger models cost more. Reserve frontier models for complex features, refactors, and debugging; let Auto or Composer 2.5 handle everyday work from Cursor's cheaper pool; and use free/light models for lookups and boilerplate. ${pct}% of your requests currently use a frontier/standard model.`,
      tone: frontierShare > 0.8 ? 'warn' : 'good',
    };
  }
  return {
    title: 'Set your billing model for tailored advice',
    body: 'Model choice trades capability against cost very differently depending on whether you pay per request or per token. Set your plan in settings to get specific recommendations — until then the guidance below is general.',
    tone: 'info',
  };
}

export function topPickFor(billing: ModelInsightsData['billingModel'], models: ModelStat[]): ModelInsightsData['topPick'] {
  if (billing === 'request') {
    const usedFrontier = models
      .filter(m => m.klass === 'frontier' || m.klass === 'standard')
      .sort((a, b) => b.multiplier - a.multiplier || b.requests - a.requests)[0];
    return {
      label: usedFrontier ? usedFrontier.label : 'Claude Opus 4.8',
      why: 'Same flat cost as any model — make the strongest one your default and save requests elsewhere.',
    };
  }
  if (billing === 'usage') {
    return {
      label: 'Auto or Composer 2.5',
      why: "Cursor routes everyday work to its cheaper included pool — reserve frontier models (Opus 4.8 / GPT-5.5) for hard problems and drop to free/light models for lookups.",
    };
  }
  return null;
}

const RECS: Record<ModelInsightsData['billingModel'], ModelRecRow[]> = {
  request: [
    { task: 'Complex feature, refactor, or debugging', recommended: 'Claude Opus 4.8 · GPT-5.5', note: 'Same cost as any model — use the strongest available.' },
    { task: 'Everyday coding', recommended: 'Claude Sonnet 4.6 · GPT-5.4 (or Opus)', note: 'Still one request; pick capability over imaginary "savings".' },
    { task: 'Quick lookups & small edits', recommended: 'Any model · inline edit (⌘K)', note: 'Costs one request regardless — batch related asks to spend fewer.' },
    { task: 'Large / long-context work', recommended: 'GPT-5.5 · Gemini 3.1 Pro · Max Mode', note: 'Big context windows land multi-file tasks in a single request.' },
  ],
  usage: [
    { task: 'Complex feature, refactor, or debugging', recommended: 'Claude Opus 4.8 / 4.7 · GPT-5.5', note: 'Worth the premium for hard, multi-file work.' },
    { task: 'Everyday coding', recommended: 'Auto · Composer 2.5 · Claude Sonnet 4.6', note: 'Auto and Composer draw from the cheaper pool — your default.' },
    { task: 'Quick lookups & Q&A', recommended: 'Auto · GPT-5 Mini', note: 'No reason to spend premium tokens here.' },
    { task: 'Boilerplate & repetitive edits', recommended: 'Claude Haiku 4.5 · Gemini 3 Flash · GPT-5.4 Mini', note: 'Cheap and fast for low-stakes changes.' },
  ],
  unknown: [
    { task: 'Complex feature, refactor, or debugging', recommended: 'A frontier model (Claude Opus 4.8 · GPT-5.5)', note: 'Capability matters most on hard work.' },
    { task: 'Everyday coding', recommended: 'Auto · Composer 2.5 · Claude Sonnet 4.6', note: 'Balanced default for most tasks.' },
    { task: 'Quick lookups & boilerplate', recommended: 'A free/light model (GPT-5 Mini · Gemini Flash)', note: 'On token billing this saves money; on request billing it costs the same.' },
  ],
};
