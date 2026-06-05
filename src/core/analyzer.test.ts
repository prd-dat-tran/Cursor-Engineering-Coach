/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { Analyzer } from './analyzer';
import { Session, SessionRequest, DateFilter } from './types';

/**
 * Simulates panel.ts validateDateFilter -- this is the exact logic
 * from the extension-side RPC handler that processes webview messages.
 */
function validateDateFilter(p: Record<string, unknown>): DateFilter {
  const isString = (v: unknown): v is string => typeof v === 'string';
  return {
    ...(isString(p.fromDate) && { fromDate: p.fromDate }),
    ...(isString(p.toDate) && { toDate: p.toDate }),
    ...(isString(p.workspaceId) && { workspaceId: p.workspaceId }),
    ...(!isString(p.workspaceId) && isString(p.workspace) && { workspaceId: p.workspace }),
  };
}

function makeRequest(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    messageText: 'Hello',
    responseText: 'Hi there',
    isCanceled: false,
    agentName: 'Copilot',
    agentMode: 'chat',
    modelId: 'gpt-4.1',
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    slashCommand: '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: 100,
    totalElapsed: 500,
    messageLength: 5,
    responseLength: 8,
    userCode: [],
    aiCode: [{ language: 'typescript', loc: 10 }],
    toolConfirmations: [],
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: 'other',
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  const base = {
    sessionId: 'sess-1',
    workspaceId: 'ws-1',
    workspaceName: 'my-project',
    location: 'panel',
    harness: 'Cursor',
    creationDate: now - 3600000,
    lastMessageDate: now,
    requestCount: 1,
    requests: [makeRequest()],
    ...overrides,
  };
  // Keep requestCount in sync with requests array
  base.requestCount = base.requests.length;
  return base;
}

describe('Analyzer', () => {
  describe('getStats', () => {
    it('returns correct totals', () => {
      const sessions = [
        makeSession({ sessionId: 's1', workspaceId: 'ws-1', workspaceName: 'project-a', requestCount: 3, requests: [makeRequest(), makeRequest(), makeRequest()] }),
        makeSession({ sessionId: 's2', workspaceId: 'ws-2', workspaceName: 'project-b', requestCount: 2, requests: [makeRequest(), makeRequest()] }),
      ];
      const a = new Analyzer(sessions);
      const stats = a.getStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalWorkspaces).toBe(2);
      expect(stats.totalRequests).toBe(5);
    });

    it('handles empty sessions', () => {
      const a = new Analyzer([]);
      const stats = a.getStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalWorkspaces).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('getWorkspaces', () => {
    it('returns unique workspaces by canonical name with recent section', () => {
      const sessions = [
        makeSession({ workspaceId: 'ws-1', workspaceName: 'project-a' }),
        makeSession({ workspaceId: 'ws-1', workspaceName: 'project-a' }),
        makeSession({ workspaceId: 'ws-2', workspaceName: 'project-b' }),
        makeSession({ workspaceId: 'ws-3', workspaceName: 'project-a' }), // same name, different id
      ];
      const a = new Analyzer(sessions);
      const ws = a.getWorkspaces();
      // Recent (top 5 by activity) + all (alphabetical) — recent items appear in both sections
      const uniqueIds = new Set(ws.map(w => w.id));
      expect(uniqueIds.size).toBe(2);
      expect([...uniqueIds].sort()).toEqual(['project-a', 'project-b']);
      // Recent items are flagged
      const recent = ws.filter(w => w.recent);
      expect(recent.length).toBeLessThanOrEqual(5);
      // All-section items are sorted alphabetically
      const allSection = ws.filter(w => !w.recent);
      const allNames = allSection.map(w => w.name);
      expect(allNames).toEqual([...allNames].sort());
    });
  });

  describe('getDailyActivity', () => {
    it('returns labels and values arrays of equal length', () => {
      const ts = new Date(2024, 5, 15, 10, 0, 0).getTime();
      const sessions = [
        makeSession({ creationDate: ts, requests: [makeRequest({ timestamp: ts })] }),
      ];
      const a = new Analyzer(sessions);
      const da = a.getDailyActivity();
      expect(da.labels.length).toBe(da.values.length);
      expect(da.labels.length).toBeGreaterThan(0);
    });
  });

  describe('getSessionDetail', () => {
    it('returns the matching session', () => {
      const sessions = [
        makeSession({ sessionId: 'target' }),
        makeSession({ sessionId: 'other' }),
      ];
      const a = new Analyzer(sessions);
      const s = a.getSessionDetail('target');
      expect(s).not.toBeNull();
      expect(s!.sessionId).toBe('target');
    });

    it('returns null for unknown session id', () => {
      const a = new Analyzer([makeSession()]);
      expect(a.getSessionDetail('nonexistent')).toBeNull();
    });
  });

  describe('filter by workspace', () => {
    it('getDailyActivity filters by workspaceId', () => {
      const ts = new Date(2024, 5, 15, 10, 0, 0).getTime();
      const sessions = [
        makeSession({ workspaceId: 'ws-a', workspaceName: 'project-a', creationDate: ts, requests: [makeRequest({ timestamp: ts }), makeRequest({ timestamp: ts + 1000 })] }),
        makeSession({ workspaceId: 'ws-b', workspaceName: 'project-b', creationDate: ts, requests: [makeRequest({ timestamp: ts })] }),
      ];
      const a = new Analyzer(sessions);
      const all = a.getDailyActivity();
      const totalAll = all.values.reduce((a, b) => a + b, 0);
      expect(totalAll).toBe(3);

      // getWorkspaces returns canonical workspace ids (workspace names)
      const wss = a.getWorkspaces();
      expect(wss.find(w => w.name === 'project-a')?.id).toBe('project-a');

      const filtered = a.getDailyActivity({ workspaceId: 'project-a' });
      const totalFiltered = filtered.values.reduce((a, b) => a + b, 0);
      expect(totalFiltered).toBe(2); // only project-a's 2 requests
    });
  });

  describe('getConsumption request counting', () => {
    it('getConsumption counts requests regardless of token availability', () => {
      // Regression: getConsumption keys off model + timestamp only; missing
      // promptTokens/completionTokens must not affect request totals.
      const ts = new Date(2024, 5, 15, 10, 0, 0).getTime();
      const sessions = [
        makeSession({ sessionId: 's1', harness: 'Cursor', creationDate: ts, workspaceName: 'proj',
          requests: [
            makeRequest({ requestId: 'r1', timestamp: ts, modelId: 'gpt-4o', promptTokens: 100, completionTokens: 50 }),
            makeRequest({ requestId: 'r2', timestamp: ts + 1000, modelId: 'gpt-4o' }),
            makeRequest({ requestId: 'r3', timestamp: ts + 2000, modelId: 'gpt-4o', promptTokens: 0, completionTokens: 0 }),
          ] }),
      ];
      const a = new Analyzer(sessions);
      const data = a.getConsumption();
      expect(data.totalRequests).toBe(3);
      expect(data.modelTotals['gpt-4o']).toBe(3);
    });
  });

  describe('full RPC pipeline simulation', () => {
    const ts = new Date(2024, 5, 15, 10, 0, 0).getTime();
    const sessions = [
      makeSession({ sessionId: 's1', harness: 'Cursor', workspaceId: 'ws-1', workspaceName: 'alpha', creationDate: ts,
        requests: [makeRequest({ timestamp: ts }), makeRequest({ timestamp: ts + 1000 })] }),
      makeSession({ sessionId: 's2', harness: 'Cursor Nightly', workspaceId: 'ws-1', workspaceName: 'alpha', creationDate: ts,
        requests: [makeRequest({ timestamp: ts })] }),
      makeSession({ sessionId: 's3', harness: 'Cursor', workspaceId: 'ws-2', workspaceName: 'beta', creationDate: ts,
        requests: [makeRequest({ timestamp: ts }), makeRequest({ timestamp: ts + 1000 }), makeRequest({ timestamp: ts + 2000 })] }),
      makeSession({ sessionId: 's4', harness: 'Cursor CLI', workspaceId: 'ws-2', workspaceName: 'beta', creationDate: ts,
        requests: [makeRequest({ timestamp: ts })] }),
    ];

    it('webview workspace filter via combobox reaches analyzer correctly', () => {
      const a = new Analyzer(sessions);
      // Simulates: user picks "alpha" from combobox
      // getWorkspaces() returns {id: 'alpha', name: 'alpha'}
      // setWsSelection sets currentFilter.workspaceId = 'alpha'
      // webview sends: rpc('getDailyActivity', { workspaceId: 'alpha' })
      const wss = a.getWorkspaces();
      const alphaWs = wss.find(w => w.name === 'alpha');
      expect(alphaWs).toBeDefined();
      expect(alphaWs!.id).toBe('alpha');

      const webviewParams = { workspaceId: alphaWs!.id } as Record<string, unknown>;
      const filter = validateDateFilter(webviewParams);
      expect(filter).toEqual({ workspaceId: 'alpha' });

      const result = a.getDailyActivity(filter);
      const total = result.values.reduce((a, b) => a + b, 0);
      expect(total).toBe(3); // s1(2) + s2(1) = 3 alpha requests
    });

    it('webview "Current" toggle sets workspace correctly', () => {
      const a = new Analyzer(sessions);
      // Simulates: onDataReady matches current Cursor workspace to "beta"
      // matchedWorkspaceId = 'ws-2'
      // User clicks "Current" toggle
      // setWsSelection('ws-2', 'beta') sets currentFilter.workspaceId = 'ws-2'
      const webviewParams = { workspaceId: 'ws-2' } as Record<string, unknown>;
      const filter = validateDateFilter(webviewParams);
      const result = a.getDailyActivity(filter);
      const total = result.values.reduce((a, b) => a + b, 0);
      expect(total).toBe(4); // s3(3) + s4(1) = 4 beta requests
    });

    it('webview "All" removes filters correctly', () => {
      const a = new Analyzer(sessions);
      // Simulates: user clicks "All", currentFilter.workspaceId = undefined
      // Then undefined doesn't get serialized through postMessage
      const webviewParams = {} as Record<string, unknown>;
      const filter = validateDateFilter(webviewParams);
      expect(filter).toEqual({});

      const result = a.getDailyActivity(filter);
      const total = result.values.reduce((a, b) => a + b, 0);
      expect(total).toBe(7); // all requests
    });

    it('workspace filter propagates to getWorkspaceBreakdown', () => {
      const a = new Analyzer(sessions);
      const filter = validateDateFilter({ workspaceId: 'ws-2' } as Record<string, unknown>);
      const wb = a.getWorkspaceBreakdown(filter);
      // ws-2 sessions are in beta (s3 + s4)
      expect(wb.labels).toContain('beta');
      const total = wb.values.reduce((a, b) => a + b, 0);
      expect(total).toBe(4); // s3(3) + s4(1)
    });
  });

  describe('getAntiPatterns — profanity detection', () => {
    function profanitySession(messages: string[]): Session {
      const ts = new Date(2024, 5, 15, 10, 0, 0).getTime();
      return makeSession({
        requestCount: messages.length,
        requests: messages.map((m, i) => makeRequest({
          requestId: `req-${i}`,
          timestamp: ts + i * 1000,
          messageText: m,
          messageLength: m.length,
        })),
      });
    }

    it('detects actual profanity in user prompts', () => {
      const sessions = [profanitySession([
        'this damn thing is not working at all',
        'what the fuck is going on',
        'why the hell does this break every time',
      ])];
      const a = new Analyzer(sessions);
      const result = a.getAntiPatterns();
      const profanity = result.patterns.find(p => p.id === 'profanity');
      expect(profanity).toBeDefined();
      expect(profanity!.occurrences).toBeGreaterThanOrEqual(1);
    });

    it('does NOT flag normal programming words', () => {
      const sessions = [profanitySession([
        'please fix the class definition in utils.ts',
        'the assertion fails on line 42',
        'the image asset needs resizing',
        'use the test fixture for validation',
      ])];
      const a = new Analyzer(sessions);
      const result = a.getAntiPatterns();
      const profanity = result.patterns.find(p => p.id === 'profanity');
      expect(profanity).toBeUndefined();
    });

    it('does NOT flag pasted code blocks', () => {
      const codeMsg = 'fix this:\n```python\nclass Foo:\n    ass = "value"\n    def damn_method(self):\n        pass\n```\nplease refactor';
      const sessions = [profanitySession([codeMsg])];
      const a = new Analyzer(sessions);
      const result = a.getAntiPatterns();
      const profanity = result.patterns.find(p => p.id === 'profanity');
      expect(profanity).toBeUndefined();
    });

    it('only checks start+end of long pasted content', () => {
      const longMiddle = 'a '.repeat(300);
      const msg = 'please review this\n' + longMiddle + '\nwhat the shit is this ending';
      const sessions = [profanitySession([msg])];
      const a = new Analyzer(sessions);
      const result = a.getAntiPatterns();
      const profanity = result.patterns.find(p => p.id === 'profanity');
      expect(profanity).toBeDefined();
    });

    it('flags profanity even when buried in middle of long prompt', () => {
      const padding = 'normal text here. '.repeat(30);
      const msg = 'please review this code\n' + padding + 'some shit buried here' + padding + '\nthanks for the help';
      const sessions = [profanitySession([msg])];
      const a = new Analyzer(sessions);
      const result = a.getAntiPatterns();
      const profanity = result.patterns.find(p => p.id === 'profanity');
      // Declarative pipeline scans full text, so buried profanity IS detected
      expect(profanity).toBeDefined();
    });

    it('examples show triggering message text', () => {
      const sessions = [profanitySession([
        'this fucking code is broken',
      ])];
      const a = new Analyzer(sessions);
      const result = a.getAntiPatterns();
      const profanity = result.patterns.find(p => p.id === 'profanity');
      expect(profanity).toBeDefined();
      // Declarative pipeline uses per-row template examples
      expect(profanity!.examples.length).toBeGreaterThan(0);
    });
  });

  /* ── Focus Heatmap & Calendar ──────────────────────────────────── */

  describe('getHeatmap focus scores', () => {
    it('returns focusHeatmap with intensity based on 5-min bucket coverage', () => {
      // Create requests spread across a single hour (Wed, 10:00-10:59) in one week
      // Requests at minutes 0, 5, 10, 15, 20 → 5 of 12 buckets active → ~42% focus
      const base = new Date('2025-03-05T10:00:00').getTime(); // Wednesday
      const reqs = [0, 5, 10, 15, 20].map((m, i) =>
        makeRequest({ requestId: `r-${i}`, timestamp: base + m * 60000 })
      );
      const session = makeSession({ requests: reqs, requestCount: reqs.length });
      const a = new Analyzer([session]);
      const heatmap = a.getHeatmap();

      expect(heatmap.focusHeatmap).toBeDefined();
      expect(heatmap.focusHeatmap.length).toBe(7);
      // Wednesday = dow 3, hour 10
      const wednesdayFocus = heatmap.focusHeatmap[3][10];
      expect(wednesdayFocus).toBeGreaterThan(30); // ~42%
      expect(wednesdayFocus).toBeLessThanOrEqual(100);
      // Other cells should be 0
      expect(heatmap.focusHeatmap[0][10]).toBe(0); // Sunday
    });

    it('high density activity scores higher focus', () => {
      // Requests every minute for 40 minutes → 8 of 12 buckets → ~67% focus
      const base = new Date('2025-03-05T14:00:00').getTime();
      const reqs = Array.from({ length: 40 }, (_, i) =>
        makeRequest({ requestId: `r-${i}`, timestamp: base + i * 60000 })
      );
      const session = makeSession({ requests: reqs, requestCount: reqs.length });
      const a = new Analyzer([session]);
      const heatmap = a.getHeatmap();

      expect(heatmap.focusHeatmap[3][14]).toBeGreaterThan(50);
    });

    it('weekend focus is computed correctly', () => {
      // Saturday sustained coding session: 10am-11am, every 2 min
      const base = new Date('2025-03-08T10:00:00').getTime(); // Saturday
      const reqs = Array.from({ length: 30 }, (_, i) =>
        makeRequest({ requestId: `r-${i}`, timestamp: base + i * 120000 })
      );
      const session = makeSession({ requests: reqs, requestCount: reqs.length });
      const a = new Analyzer([session]);
      const heatmap = a.getHeatmap();

      // Saturday = dow 6, should have high focus at hour 10
      expect(heatmap.focusHeatmap[6][10]).toBeGreaterThan(40);
    });
  });

  describe('getCalendarActivity', () => {
    it('returns per-day request counts and focus scores', () => {
      // Two days of activity
      const day1Base = new Date('2025-03-05T10:00:00').getTime();
      const day2Base = new Date('2025-03-06T14:00:00').getTime();
      const reqs = [
        ...Array.from({ length: 10 }, (_, i) =>
          makeRequest({ requestId: `d1-${i}`, timestamp: day1Base + i * 300000 }) // every 5 min
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeRequest({ requestId: `d2-${i}`, timestamp: day2Base + i * 600000 }) // every 10 min
        ),
      ];
      const session = makeSession({ requests: reqs, requestCount: reqs.length });
      const a = new Analyzer([session]);
      const cal = a.getCalendarActivity();

      expect(cal.days.length).toBe(2);
      expect(cal.days[0].date).toBe('2025-03-05');
      expect(cal.days[0].requests).toBe(10);
      expect(cal.days[1].date).toBe('2025-03-06');
      expect(cal.days[1].requests).toBe(5);
      expect(cal.maxRequests).toBe(10);
      // Focus should be > 0 for both days
      expect(cal.days[0].focusScore).toBeGreaterThan(0);
      expect(cal.days[1].focusScore).toBeGreaterThan(0);
    });

    it('returns empty for no data', () => {
      const a = new Analyzer([]);
      const cal = a.getCalendarActivity();
      expect(cal.days).toEqual([]);
      expect(cal.maxRequests).toBe(0);
    });
  });

  describe('warmUp async progress', () => {
    it('delivers progress messages in order via setImmediate', async () => {
      const sessions = [
        makeSession({ sessionId: 's1', workspaceId: 'ws-1', workspaceName: 'proj', requests: [makeRequest()] }),
      ];
      const a = new Analyzer(sessions);

      const messages: { phase: number; detail: string }[] = [];
      await a.warmUp((phase, detail) => {
        messages.push({ phase, detail });
      });

      // Verify we got progress messages (worker falls back to sync in tests)
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // First message should be computing analytics
      expect(messages[0].detail).toContain('Computing analytics');
      expect(messages[0].phase).toBe(4);

      // Last message should indicate cache is ready
      const last = messages[messages.length - 1];
      expect(last.phase).toBe(5);
      expect(last.detail).toContain('Cache ready');
    });

    it('completes even with empty sessions', async () => {
      const a = new Analyzer([]);
      const messages: string[] = [];
      await a.warmUp((_phase, detail) => {
        messages.push(detail);
      });
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[messages.length - 1]).toContain('Cache ready');
    });
  });
});
