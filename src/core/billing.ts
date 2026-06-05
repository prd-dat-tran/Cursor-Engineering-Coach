/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cursor billing profile — the single source of truth for how the user is charged.
 *
 * Cursor (since mid-2025) defaults to *usage-based* billing: each request costs
 * tokens × model rate, so cheaper models save money. However, legacy request
 * plans and many custom Enterprise contracts bill per *request* — a flat cost
 * regardless of model or token count. Under request-based billing the optimal
 * strategy inverts: always use the most capable model, and treat the *number of
 * requests* (not tokens) as the thing to economize.
 *
 * This module is intentionally free of any `vscode` dependency so it can run in
 * analyzer worker threads. The VS Code settings reader lives in
 * `src/billing-vscode.ts`.
 */

/** How Cursor charges for agent usage. */
export type BillingModel = 'usage-based' | 'request-based';

/** Cursor plan tier (informational — used for labels and budget context). */
export type CursorPlan =
  | 'unknown'
  | 'hobby'
  | 'pro'
  | 'pro-plus'
  | 'ultra'
  | 'teams'
  | 'enterprise';

export interface BillingProfile {
  /** How Cursor charges for agent usage. */
  model: BillingModel;
  /** Plan tier, for labels and context. */
  plan: CursorPlan;
  /** True when the user explicitly set their billing model (via setting or prompt). */
  configured: boolean;
  /** True when the plan tier was auto-detected from local Cursor account data. */
  planDetected?: boolean;
}

/**
 * Live usage pulled (opt-in) from Cursor's backend for the current billing
 * cycle. `requestsLimit` is the included request quota (e.g. 500); null when
 * the plan has no fixed request cap.
 */
export interface LiveUsage {
  requestsUsed: number;
  requestsLimit: number | null;
  /** ISO date string for the start of the current billing cycle. */
  cycleStart: string | null;
  /** Epoch ms when this snapshot was fetched. */
  fetchedAt: number;
}

export const BILLING_MODELS: readonly BillingModel[] = ['usage-based', 'request-based'];

export const CURSOR_PLANS: readonly CursorPlan[] = [
  'unknown', 'hobby', 'pro', 'pro-plus', 'ultra', 'teams', 'enterprise',
];

/** Default profile when nothing is configured: 2026 Cursor default is usage/credit-based. */
export const DEFAULT_BILLING_PROFILE: BillingProfile = {
  model: 'usage-based',
  plan: 'unknown',
  configured: false,
};

/** Narrow an arbitrary value to a valid BillingModel (defaults to usage-based). */
export function resolveBillingModel(value: unknown): BillingModel {
  return value === 'request-based' ? 'request-based' : 'usage-based';
}

/** Narrow an arbitrary value to a valid CursorPlan (defaults to unknown). */
export function resolveCursorPlan(value: unknown): CursorPlan {
  return typeof value === 'string' && (CURSOR_PLANS as readonly string[]).includes(value)
    ? value as CursorPlan
    : 'unknown';
}

/**
 * Map Cursor's `cursorAuth/stripeMembershipType` string (read from the local
 * account DB) to a `CursorPlan`. Tolerant of spacing/casing/underscore variants
 * ("free_trial", "pro_plus", "team", "business", …).
 */
export function mapMembershipToPlan(raw: string | null | undefined): CursorPlan {
  if (!raw) return 'unknown';
  const v = raw.toLowerCase().replace(/[\s_]+/g, '-');
  if (v.includes('enterprise')) return 'enterprise';
  if (v.includes('team') || v.includes('business')) return 'teams';
  if (v.includes('ultra')) return 'ultra';
  if (v.includes('pro-plus') || v === 'pro+') return 'pro-plus';
  if (v.includes('pro')) return 'pro';
  if (v.includes('free') || v.includes('hobby') || v.includes('trial')) return 'hobby';
  return 'unknown';
}

/**
 * Default billing model when the user hasn't chosen one. Cursor's default is
 * usage/credit-based across tiers; request-based is a per-contract choice that
 * is NOT encoded in any local data, so we conservatively default to
 * usage-based and (for ambiguous tiers) prompt the user to confirm.
 */
export function defaultBillingModelForPlan(_plan: CursorPlan): BillingModel {
  return 'usage-based';
}

/**
 * Tiers whose billing model is commonly a custom contract (request- or
 * token-based) and therefore worth a one-time confirmation prompt.
 */
export function planBillingIsAmbiguous(plan: CursorPlan): boolean {
  return plan === 'enterprise' || plan === 'teams';
}

/** One-line human summary of a live-usage snapshot. */
export function liveUsageSummary(u: LiveUsage): string {
  if (u.requestsLimit && u.requestsLimit > 0) {
    const pct = Math.round((u.requestsUsed / u.requestsLimit) * 100);
    return `${u.requestsUsed} of ${u.requestsLimit} requests used this cycle (${pct}%)`;
  }
  return `${u.requestsUsed} requests used this cycle`;
}

export function isRequestBased(profile?: BillingProfile | BillingModel | null): boolean {
  const model = typeof profile === 'string' ? profile : profile?.model;
  return model === 'request-based';
}

export function billingModelLabel(model: BillingModel): string {
  return model === 'request-based' ? 'Request-based' : 'Usage-based';
}

export function cursorPlanLabel(plan: CursorPlan): string {
  switch (plan) {
    case 'hobby': return 'Hobby';
    case 'pro': return 'Pro';
    case 'pro-plus': return 'Pro+';
    case 'ultra': return 'Ultra';
    case 'teams': return 'Teams';
    case 'enterprise': return 'Enterprise';
    default: return '';
  }
}

/**
 * One-line headline shown next to the billing chip on the dashboard.
 * Tailors the optimization advice to the billing model.
 */
export function billingHeadline(profile: BillingProfile): { title: string; detail: string } {
  if (isRequestBased(profile)) {
    return {
      title: 'Optimize for the best model, not the cheapest',
      detail:
        'On request-based billing every request costs the same regardless of model or tokens. ' +
        'Default to the most capable model (e.g. Claude Opus or GPT-5.x) and economize on the ' +
        'number of requests — clearer prompts and better context mean fewer, higher-value turns.',
    };
  }
  return {
    title: 'Match model power to the task',
    detail:
      'On usage-based billing, cost scales with tokens × model rate. Use Auto or lighter models ' +
      'for routine work, reserve premium models for hard reasoning, and keep prompts and context tight.',
  };
}

/**
 * Billing context injected into the @coach system prompt so the chat model
 * gives plan-appropriate advice.
 */
export function billingCoachNote(profile: BillingProfile): string {
  if (isRequestBased(profile)) {
    return (
      'Billing context: the developer is on a REQUEST-BASED Cursor plan' +
      (cursorPlanLabel(profile.plan) ? ` (${cursorPlanLabel(profile.plan)})` : '') +
      '. Each agent request costs the same flat amount regardless of model or token count. ' +
      'Therefore: (1) recommend using the MOST CAPABLE model available for every request — ' +
      'never suggest switching to cheaper/lighter models or to Auto purely to save tokens or credits; ' +
      '(2) the real cost lever is the NUMBER of requests, so coach the user to get results in fewer, ' +
      'higher-quality requests (precise prompts, good upfront context, fewer cancellations and re-tries). ' +
      'Do not frame advice around token cost or credit spend.'
    );
  }
  return (
    'Billing context: the developer is on a USAGE-BASED (token/credit) Cursor plan' +
    (cursorPlanLabel(profile.plan) ? ` (${cursorPlanLabel(profile.plan)})` : '') +
    '. Cost scales with tokens × model rate, so it is reasonable to match model power to task ' +
    'complexity, lean on Auto for routine work, and keep prompts and context efficient.'
  );
}
