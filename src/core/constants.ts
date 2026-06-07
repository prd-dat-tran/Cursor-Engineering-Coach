/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Shared constants for Cursor Engineering Coach */

import { getModelMultipliers, getModelTokenRates, getSkuCredits, FactsTokenRate } from './facts';

/* ---- Model facts (multipliers, per-token rates, plan credits) ----
 * The source of truth is data/cursor-facts.json, loaded via facts.ts. Fact sync
 * is maintainer-only (no runtime refresh): the bundled manifest is updated on
 * demand via `npm run facts:refresh` and ships in a release. The exports below
 * are snapshots derived at module load for backwards-compatibility.
 * Source: Cursor models & pricing — https://cursor.com/docs/models-and-pricing */

/** Per-token rate in USD per 1M tokens. */
export type TokenRate = FactsTokenRate;

/** Model id -> request-cost multiplier (0 = included/free, <1 = light, 1 = standard, >1 = frontier). */
export const MODEL_MULTIPLIERS: Record<string, number> = getModelMultipliers();

export const LOC_COST_2010 = 20;

/** Model id -> per-token rate (USD per 1M tokens). */
export const MODEL_TOKEN_RATES: Record<string, TokenRate> = getModelTokenRates();

/** AI Credit budget per SKU (1 credit = $0.01 USD). */
export const SKU_AI_CREDITS: Record<string, number> = getSkuCredits();

/* ---- Legacy threshold kept for analyzer-patterns.ts ---- */
export const LONG_SESSION_REQS = 30;

/* ---- Insights thresholds ---- */
export const REVIEW_GAP_THRESHOLD_MS = 30_000;     // 30s gap after AI code = likely reviewed
export const VIBE_CODE_MIN_LOC = 100;               // min AI LoC per session to flag
export const VIBE_CODE_MAX_USER_PROMPTS = 5;        // max user prompts in a vibe-coded session
export const VIBE_CODE_MIN_SESSIONS = 3;             // min sessions to flag
export const CONTEXT_AUDIT_MIN_REQS = 30;            // min requests for context audit
export const PROMPT_MATURITY_SAMPLE_SIZE = 50;       // prompts to sample for maturity grading
export const LATE_NIGHT_START = 22;                  // 10 PM
export const LATE_NIGHT_END = 5;                     // 5 AM
export const BURNOUT_STREAK_DAYS = 14;               // consecutive days threshold
export const BURNOUT_LATE_NIGHT_RATE = 0.15;         // late-night ratio threshold
export const BURNOUT_WEEKEND_RATE = 0.25;            // weekend ratio threshold

/* ---- Config health thresholds ---- */
export const LOW_CONSTRAINT_MIN_REQS = 30;           // min requests to flag low constraint usage
export const LOW_CONSTRAINT_RATE = 0.08;             // <8% of prompts use constraints → anti-pattern
export const LOW_MARKDOWN_RATIO = 0.05;              // <5% markdown LoC → likely no spec-driven development
export const LOW_MARKDOWN_MIN_LOC = 100;             // min total AI LoC in a workspace to flag
export const LOW_MARKDOWN_MIN_WORKSPACES = 1;        // min workspaces with low markdown to flag
export const OVERSIZED_INSTRUCTION_LINES = 500;      // instruction file too large (lines)
export const CURSOR_RULE_FILE_MAX_CHARS = 6000;      // .cursor/rules/*.md soft cap before context bloat
export const CURSOR_RULE_RECOMMENDED_LINES = 200;    // AGENTS.md / .cursor/rules recommended max lines

/* ---- Flow state thresholds ---- */
export const FLOW_RAPID_FOLLOWUP_SEC = 30;            // follow-up within 30s = rapid (in the zone)
export const FLOW_SESSION_MIN_REQS = 3;               // min requests for a session to count
export const FLOW_BLOCK_GAP_MIN = 15;                 // gap > 15 min between requests = new work block
export const FLOW_DEEP_SCORE = 70;                    // 70-100 = deep flow
export const FLOW_MODERATE_SCORE = 45;                // 45-69 = moderate flow
export const FLOW_SHALLOW_SCORE = 25;                 // 25-44 = shallow | <25 = fragmented
export const FLOW_LOW_SCORE_RATE = 0.6;               // >60% fragmented days → anti-pattern
export const FLOW_MIN_DAYS = 5;                       // min days of activity to flag

/* ---- Context management thresholds ---- */
export const CONTEXT_WINDOW_DEFAULT = 128_000;            // default assumed context window (tokens)
export const CONTEXT_OPTIMAL_UTILIZATION = 50;            // ≤50% avg = optimal (top performance)
export const CONTEXT_LIMITED_UTILIZATION = 80;            // >80% avg = limited
export const CONTEXT_SATURATION_THRESHOLD = 60;           // requests ≥60% utilization count as saturated
export const CONTEXT_COMPACTION_STORM_MIN = 4;            // 4+ compactions in a session = storm
export const CONTEXT_MIN_TOKEN_REQUESTS = 5;              // min requests with tokens to score a session
export const CONTEXT_GROWING_SESSION_MIN_REQS = 8;        // min requests to detect runaway growth
export const CONTEXT_GROWING_SESSION_GROWTH_RATE = 0.8;   // 80%+ sequential increases = runaway

/* ---- Token estimation (for sessions without native token data) ---- */

/* ---- Token data quality cutoff ---- */
export const TOKEN_DATA_AVAILABLE_FROM = '2026-04-01';

/* ---- Feature flags ---- */
export const FF_TOKEN_REPORTING_ENABLED = false;
