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

/* ---- Usage projection (burn rate, run-out forecast) ---- */

const MS_PER_DAY = 86_400_000;

/** End of the billing cycle that starts at `cycleStartIso` (one calendar month later). */
export function cycleEnd(cycleStartIso: string): Date {
  const end = new Date(cycleStartIso);
  end.setMonth(end.getMonth() + 1);
  return end;
}

export type UsagePace = 'no-limit' | 'ahead' | 'on-track' | 'behind' | 'over';
export type UsageLevel = 'ok' | 'warn' | 'critical';

export interface UsageProjection {
  used: number;
  limit: number | null;
  /** 0..100 (0 when there is no fixed limit). */
  pctUsed: number;
  daysElapsed: number;
  daysRemaining: number;
  cycleLengthDays: number;
  /** Requests per day so far (burn rate). */
  perDay: number;
  /** Burn-rate-projected total requests by cycle end. */
  projectedTotal: number;
  /** ISO date the user is projected to hit the limit; null if no limit or won't run out. */
  projectedRunOut: string | null;
  /** How many days before cycle end the limit is projected to be hit (>=0); null if N/A. */
  runOutDaysEarly: number | null;
  pace: UsagePace;
  level: UsageLevel;
}

/**
 * Project request burn for the current cycle. Pure and deterministic (pass
 * `now` in tests). Returns null when the cycle start is unknown.
 */
export function projectUsage(u: LiveUsage, now: Date = new Date()): UsageProjection | null {
  if (!u.cycleStart) return null;
  const start = new Date(u.cycleStart);
  if (Number.isNaN(start.getTime())) return null;
  const end = cycleEnd(u.cycleStart);

  const cycleLengthDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));
  const elapsedRaw = (now.getTime() - start.getTime()) / MS_PER_DAY;
  const daysElapsed = Math.min(cycleLengthDays, Math.max(0, elapsedRaw));
  const daysRemaining = Math.max(0, cycleLengthDays - daysElapsed);
  const perDay = daysElapsed > 0 ? u.requestsUsed / daysElapsed : u.requestsUsed;
  const projectedTotal = Math.round(perDay * cycleLengthDays);
  const limit = u.requestsLimit;
  const pctUsed = limit && limit > 0 ? Math.round((u.requestsUsed / limit) * 100) : 0;

  let pace: UsagePace = 'no-limit';
  let level: UsageLevel = 'ok';
  let projectedRunOut: string | null = null;
  let runOutDaysEarly: number | null = null;

  if (limit && limit > 0) {
    if (u.requestsUsed >= limit) pace = 'over';
    else if (projectedTotal > limit) pace = 'behind';
    else if (projectedTotal >= limit * 0.9) pace = 'on-track';
    else pace = 'ahead';

    if (perDay > 0 && (pace === 'behind' || pace === 'over')) {
      const remaining = Math.max(0, limit - u.requestsUsed);
      const runOutDate = new Date(now.getTime() + (remaining / perDay) * MS_PER_DAY);
      projectedRunOut = runOutDate.toISOString();
      runOutDaysEarly = Math.max(0, Math.round((end.getTime() - runOutDate.getTime()) / MS_PER_DAY));
    }

    if (pace === 'over' || pctUsed >= 95) level = 'critical';
    else if (pace === 'behind' || pctUsed >= 80) level = 'warn';
    else level = 'ok';
  }

  return {
    used: u.requestsUsed,
    limit,
    pctUsed,
    daysElapsed: Math.round(daysElapsed),
    daysRemaining: Math.round(daysRemaining),
    cycleLengthDays,
    perDay: Math.round(perDay * 10) / 10,
    projectedTotal,
    projectedRunOut,
    runOutDaysEarly,
    pace,
    level,
  };
}

/** Human one-liner about pace, e.g. "On pace to run out ~8 days early". */
export function paceSummary(p: UsageProjection): string {
  switch (p.pace) {
    case 'no-limit':
      return `${p.used} requests this cycle (no fixed limit)`;
    case 'over':
      return `Out of requests — ${p.used}/${p.limit} used with ${p.daysRemaining} days left`;
    case 'behind':
      return p.runOutDaysEarly != null
        ? `On pace to run out ~${p.runOutDaysEarly} day${p.runOutDaysEarly === 1 ? '' : 's'} early (projected ${p.projectedTotal}/${p.limit})`
        : `On pace to exceed your limit (projected ${p.projectedTotal}/${p.limit})`;
    case 'on-track':
      return `On track — projected ${p.projectedTotal}/${p.limit} by cycle end`;
    case 'ahead':
      return `Comfortable — projected ${p.projectedTotal}/${p.limit}, ${p.daysRemaining} days left`;
  }
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
      'Do not frame advice around token cost or credit spend. ' +
      'A common pain point on these plans is RUNNING OUT of requests before the cycle resets — when the ' +
      'user asks about usage, call coach_credits (it returns live usage + a burn-rate run-out forecast) ' +
      'and proactively warn if they are on pace to run out early. Point them to the Usage page for a ' +
      'per-model/per-day/per-workspace breakdown and waste analysis.'
    );
  }
  return (
    'Billing context: the developer is on a USAGE-BASED (token/credit) Cursor plan' +
    (cursorPlanLabel(profile.plan) ? ` (${cursorPlanLabel(profile.plan)})` : '') +
    '. Cost scales with tokens × model rate, so it is reasonable to match model power to task ' +
    'complexity, lean on Auto for routine work, and keep prompts and context efficient.'
  );
}
