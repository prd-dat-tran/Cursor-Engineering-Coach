/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for billing-plan-aware coaching: pure billing helpers, detector
 * filtering by billing model, and PatternsAnalyzer recommendation branching.
 */

import { describe, it, expect } from 'vitest';
import {
  BillingProfile,
  DEFAULT_BILLING_PROFILE,
  LiveUsage,
  billingCoachNote,
  billingHeadline,
  billingModelLabel,
  cursorPlanLabel,
  defaultBillingModelForPlan,
  isRequestBased,
  liveUsageSummary,
  mapMembershipToPlan,
  planBillingIsAmbiguous,
  resolveBillingModel,
  resolveCursorPlan,
} from './billing';
import { getActiveDetectors } from './detector-registry';
import { PatternsAnalyzer } from './analyzer-patterns';
import { Session, SessionRequest } from './types';

const REQUEST_BASED: BillingProfile = { model: 'request-based', plan: 'enterprise', configured: true };
const USAGE_BASED: BillingProfile = { model: 'usage-based', plan: 'pro', configured: true };

function makeReq(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    messageText: 'Implement a feature with proper handling.',
    responseText: 'Done.',
    isCanceled: false,
    agentName: '',
    agentMode: 'chat',
    modelId: 'gpt-4.1-mini',
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    slashCommand: '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: 100,
    totalElapsed: 500,
    messageLength: 40,
    responseLength: 30,
    userCode: [],
    aiCode: [],
    toolConfirmations: [],
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: 'feature',
    ...overrides,
  };
}

function makeSess(requests: SessionRequest[]): Session {
  const now = Date.now();
  return {
    sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: 'ws-1',
    workspaceName: 'my-project',
    location: 'panel',
    harness: 'Cursor',
    creationDate: now - 3600000,
    lastMessageDate: now,
    requestCount: requests.length,
    requests,
  };
}

describe('billing helpers', () => {
  it('isRequestBased recognizes both profiles and bare models', () => {
    expect(isRequestBased(REQUEST_BASED)).toBe(true);
    expect(isRequestBased(USAGE_BASED)).toBe(false);
    expect(isRequestBased('request-based')).toBe(true);
    expect(isRequestBased('usage-based')).toBe(false);
    expect(isRequestBased(null)).toBe(false);
  });

  it('resolveBillingModel narrows arbitrary input', () => {
    expect(resolveBillingModel('request-based')).toBe('request-based');
    expect(resolveBillingModel('usage-based')).toBe('usage-based');
    expect(resolveBillingModel('garbage')).toBe('usage-based');
    expect(resolveBillingModel(undefined)).toBe('usage-based');
  });

  it('resolveCursorPlan narrows arbitrary input', () => {
    expect(resolveCursorPlan('enterprise')).toBe('enterprise');
    expect(resolveCursorPlan('pro-plus')).toBe('pro-plus');
    expect(resolveCursorPlan('nope')).toBe('unknown');
    expect(resolveCursorPlan(42)).toBe('unknown');
  });

  it('labels render human-readable text', () => {
    expect(billingModelLabel('request-based')).toBe('Request-based');
    expect(billingModelLabel('usage-based')).toBe('Usage-based');
    expect(cursorPlanLabel('enterprise')).toBe('Enterprise');
    expect(cursorPlanLabel('unknown')).toBe('');
  });

  it('headline inverts cost advice for request-based billing', () => {
    const req = billingHeadline(REQUEST_BASED);
    expect(req.title.toLowerCase()).toContain('best model');
    expect(req.detail.toLowerCase()).toContain('most capable');

    const usage = billingHeadline(USAGE_BASED);
    expect(usage.detail.toLowerCase()).toContain('tokens');
  });

  it('coach note instructs the model differently per plan', () => {
    const req = billingCoachNote(REQUEST_BASED);
    expect(req).toContain('REQUEST-BASED');
    expect(req).toContain('MOST CAPABLE');
    expect(req).toContain('Enterprise');

    const usage = billingCoachNote(USAGE_BASED);
    expect(usage).toContain('USAGE-BASED');
  });

  it('default profile is usage-based and not configured', () => {
    expect(DEFAULT_BILLING_PROFILE.model).toBe('usage-based');
    expect(DEFAULT_BILLING_PROFILE.configured).toBe(false);
  });
});

describe('plan auto-detection helpers', () => {
  it('maps Cursor membership strings to plan tiers', () => {
    expect(mapMembershipToPlan('enterprise')).toBe('enterprise');
    expect(mapMembershipToPlan('pro_plus')).toBe('pro-plus');
    expect(mapMembershipToPlan('pro')).toBe('pro');
    expect(mapMembershipToPlan('ultra')).toBe('ultra');
    expect(mapMembershipToPlan('team')).toBe('teams');
    expect(mapMembershipToPlan('business')).toBe('teams');
    expect(mapMembershipToPlan('free_trial')).toBe('hobby');
    expect(mapMembershipToPlan('free')).toBe('hobby');
    expect(mapMembershipToPlan('something-weird')).toBe('unknown');
    expect(mapMembershipToPlan(null)).toBe('unknown');
    expect(mapMembershipToPlan('')).toBe('unknown');
  });

  it('flags only Teams/Enterprise as billing-ambiguous (prompt-worthy)', () => {
    expect(planBillingIsAmbiguous('enterprise')).toBe(true);
    expect(planBillingIsAmbiguous('teams')).toBe(true);
    expect(planBillingIsAmbiguous('pro')).toBe(false);
    expect(planBillingIsAmbiguous('hobby')).toBe(false);
    expect(planBillingIsAmbiguous('unknown')).toBe(false);
  });

  it('defaults billing model to usage-based for every tier (request-based is opt-in)', () => {
    expect(defaultBillingModelForPlan('enterprise')).toBe('usage-based');
    expect(defaultBillingModelForPlan('hobby')).toBe('usage-based');
  });
});

describe('live usage summary', () => {
  const base: LiveUsage = { requestsUsed: 34, requestsLimit: 500, cycleStart: '2026-06-01', fetchedAt: 0 };

  it('renders a percentage when a request limit exists', () => {
    expect(liveUsageSummary(base)).toBe('34 of 500 requests used this cycle (7%)');
  });

  it('omits the percentage when there is no fixed limit', () => {
    expect(liveUsageSummary({ ...base, requestsLimit: null })).toBe('34 requests used this cycle');
  });
});

describe('detector filtering by billing model', () => {
  function activeRuleIds(model: 'usage-based' | 'request-based'): string[] {
    return getActiveDetectors(false, model)
      .map(d => d.rule?.id)
      .filter((id): id is string => Boolean(id));
  }

  it('usage-based plans see token-cost rules but not the flat-rate rule', () => {
    const ids = activeRuleIds('usage-based');
    expect(ids).toContain('premium-waste');
    expect(ids).not.toContain('underpowered-model');
  });

  it('request-based plans see the flat-rate rule but not token-cost rules', () => {
    const ids = activeRuleIds('request-based');
    expect(ids).toContain('underpowered-model');
    expect(ids).not.toContain('premium-waste');
    expect(ids).not.toContain('auto-avoidance');
  });

  it('untagged rules apply to both billing models', () => {
    expect(activeRuleIds('usage-based')).toContain('high-cancellation');
    expect(activeRuleIds('request-based')).toContain('high-cancellation');
  });
});

describe('PatternsAnalyzer recommendation branching', () => {
  // Heavy reliance on a lightweight model.
  const reqs = Array.from({ length: 30 }, () => makeReq({ modelId: 'gpt-4.1-mini' }));
  const sessions = [makeSess(reqs)];
  const emptyEditIndex = new Map<string, Map<string, number>>();

  it('request-based billing rewards best-model usage', () => {
    const analyzer = new PatternsAnalyzer(sessions, emptyEditIndex, undefined, REQUEST_BASED);
    const recs = analyzer.getRecommendations();
    const names = recs.map(r => r.name);
    expect(names).toContain('Best-Model Usage');
    expect(names).toContain('Best-Model Adoption');
    const bestModel = recs.find(r => r.name === 'Best-Model Usage')!;
    // All requests used a lightweight model → low score on a request-based plan.
    expect(bestModel.score).toBeLessThan(70);
    expect(bestModel.recommendation.toLowerCase()).toContain('most capable');
  });

  it('usage-based billing keeps diversity/alignment framing', () => {
    const analyzer = new PatternsAnalyzer(sessions, emptyEditIndex, undefined, USAGE_BASED);
    const names = analyzer.getRecommendations().map(r => r.name);
    expect(names).toContain('Model Diversity');
    expect(names).toContain('Model-Task Alignment');
    expect(names).not.toContain('Best-Model Usage');
  });

  it('defaults to usage-based framing when no profile is supplied', () => {
    const analyzer = new PatternsAnalyzer(sessions, emptyEditIndex);
    const names = analyzer.getRecommendations().map(r => r.name);
    expect(names).toContain('Model Diversity');
  });
});

describe('PatternsAnalyzer.getRequestEconomics', () => {
  const emptyEditIndex = new Map<string, Map<string, number>>();

  it('counts frontier vs light/auto vs cancelled requests', () => {
    const reqs = [
      ...Array.from({ length: 3 }, () => makeReq({ modelId: 'claude-opus-4.6' })),
      ...Array.from({ length: 2 }, () => makeReq({ modelId: 'claude-opus-4.6', isCanceled: true })),
      ...Array.from({ length: 3 }, () => makeReq({ modelId: 'gpt-4.1-mini' })),
      ...Array.from({ length: 2 }, () => makeReq({ modelId: 'auto' })),
    ];
    const analyzer = new PatternsAnalyzer([makeSess(reqs)], emptyEditIndex, undefined, REQUEST_BASED);
    const econ = analyzer.getRequestEconomics();
    expect(econ.totalRequests).toBe(10);
    expect(econ.requestsWithModel).toBe(10);
    expect(econ.frontierRequests).toBe(5);       // 5x opus (auto excluded)
    expect(econ.lightOrAutoRequests).toBe(5);     // 3x mini + 2x auto
    expect(econ.cancelledRequests).toBe(2);
    expect(econ.frontierPct).toBe(50);
    expect(econ.lightOrAutoPct).toBe(50);
    expect(econ.cancelledPct).toBe(20);
  });
});
