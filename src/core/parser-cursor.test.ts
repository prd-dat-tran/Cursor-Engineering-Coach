/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { findCursorEditions, loadCursorComposerSession, parseCursorComposerSessions } from './parser-cursor';

/* ---- Test fixture helpers ---- */

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-engineering-coach-cursor-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf-8' });
}

function createCursorDbs(opts: {
  composers: Array<{ composerId: string; record: Record<string, unknown> }>;
  bubbles: Array<{ composerId: string; bubbleId: string; record: Record<string, unknown> }>;
  workspaces?: Array<{ wsId: string; folder?: string; selectedComposerIds?: string[] }>;
}): { edition: { name: string; harness: string; globalDb: string; workspaceStorageRoot: string } } {
  const root = makeTempDir();
  const userDir = path.join(root, 'Cursor', 'User');
  fs.mkdirSync(path.join(userDir, 'globalStorage'), { recursive: true });
  fs.mkdirSync(path.join(userDir, 'workspaceStorage'), { recursive: true });

  const globalDb = path.join(userDir, 'globalStorage', 'state.vscdb');
  runSql(
    globalDb,
    [
      "CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
      "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
    ].join('\n'),
  );

  // Insert composers + bubbles via stdin so escaping is automatic.
  const stmts: string[] = ['BEGIN;'];
  for (const c of opts.composers) {
    const json = JSON.stringify(c.record).replaceAll("'", "''");
    stmts.push(`INSERT INTO cursorDiskKV(key, value) VALUES('composerData:${c.composerId}', '${json}');`);
  }
  for (const b of opts.bubbles) {
    const json = JSON.stringify(b.record).replaceAll("'", "''");
    stmts.push(`INSERT INTO cursorDiskKV(key, value) VALUES('bubbleId:${b.composerId}:${b.bubbleId}', '${json}');`);
  }
  stmts.push('COMMIT;');
  runSql(globalDb, stmts.join('\n'));

  for (const ws of opts.workspaces ?? []) {
    const wsDir = path.join(userDir, 'workspaceStorage', ws.wsId);
    fs.mkdirSync(wsDir, { recursive: true });
    if (ws.folder) {
      fs.writeFileSync(
        path.join(wsDir, 'workspace.json'),
        JSON.stringify({ folder: `file://${ws.folder}` }),
      );
    }
    const wsDb = path.join(wsDir, 'state.vscdb');
    runSql(
      wsDb,
      "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
    );
    if (ws.selectedComposerIds && ws.selectedComposerIds.length > 0) {
      const value = JSON.stringify({ selectedComposerIds: ws.selectedComposerIds }).replaceAll("'", "''");
      runSql(
        wsDb,
        `INSERT INTO ItemTable(key, value) VALUES('composer.composerData', '${value}');`,
      );
    }
  }

  return {
    edition: {
      name: 'Cursor',
      harness: 'Cursor',
      globalDb,
      workspaceStorageRoot: path.join(userDir, 'workspaceStorage'),
    },
  };
}

/* ---- Fixture builders ---- */

interface UserHeader { bubbleId: string; type: 1 }
interface AsstHeader { bubbleId: string; type: 2; grouping?: Record<string, unknown> }

function userBubbleHeader(id: string): UserHeader { return { bubbleId: id, type: 1 }; }
function asstBubbleHeader(id: string, grouping?: Record<string, unknown>): AsstHeader {
  return { bubbleId: id, type: 2, grouping };
}

function userBubble(id: string, text: string, opts: { createdAt?: string } = {}): Record<string, unknown> {
  return {
    bubbleId: id,
    type: 1,
    text,
    createdAt: opts.createdAt ?? '2026-05-01T10:00:00.000Z',
    context: { fileSelections: [], cursorRules: [] },
    cursorRules: [],
  };
}

function asstTextBubble(id: string, text: string, opts: { inputTokens?: number; outputTokens?: number; createdAt?: string } = {}): Record<string, unknown> {
  return {
    bubbleId: id,
    type: 2,
    text,
    createdAt: opts.createdAt ?? '2026-05-01T10:00:05.000Z',
    tokenCount: { inputTokens: opts.inputTokens ?? 0, outputTokens: opts.outputTokens ?? 0 },
  };
}

function asstThinkingBubble(id: string, text: string, durationMs = 200): Record<string, unknown> {
  return {
    bubbleId: id,
    type: 2,
    text: '',
    thinking: { text, signature: '' },
    thinkingDurationMs: durationMs,
    capabilityType: 30,
    createdAt: '2026-05-01T10:00:02.000Z',
  };
}

function asstToolBubble(id: string, toolName: string, rawArgs: string): Record<string, unknown> {
  return {
    bubbleId: id,
    type: 2,
    text: '',
    capabilityType: 15,
    createdAt: '2026-05-01T10:00:03.000Z',
    toolFormerData: {
      name: toolName,
      rawArgs,
      status: 'completed',
      toolCallId: `tool-${id}`,
    },
  };
}

/* ---- Tests ---- */

describe('findCursorEditions', () => {
  it('returns no editions when Cursor is not installed', () => {
    const prevHome = process.env.HOME;
    const prevAppData = process.env.APPDATA;
    const tmp = makeTempDir();
    process.env.HOME = tmp;
    process.env.APPDATA = tmp;
    try {
      expect(findCursorEditions()).toEqual([]);
    } finally {
      process.env.HOME = prevHome;
      process.env.APPDATA = prevAppData;
    }
  });
});

describe('parseCursorComposerSessions', () => {
  it('builds one session per composer with user/assistant request pairs', () => {
    const { edition } = createCursorDbs({
      composers: [
        {
          composerId: 'comp-1',
          record: {
            composerId: 'comp-1',
            name: 'Fix the bug',
            createdAt: 1735_000_000_000,
            lastUpdatedAt: 1735_000_010_000,
            modelConfig: { modelName: 'claude-opus-4-7-thinking-xhigh', maxMode: false },
            unifiedMode: 'agent',
            fullConversationHeadersOnly: [
              userBubbleHeader('u-1'),
              asstBubbleHeader('a-1-think', { capabilityType: 30, hasThinking: true }),
              asstBubbleHeader('a-1'),
              userBubbleHeader('u-2'),
              asstBubbleHeader('a-2'),
            ],
            workspaceIdentifier: { id: 'ws-1' },
            todos: [
              { id: 'a', content: 'Done item', status: 'completed' },
              { id: 'b', content: 'In flight', status: 'in-progress' },
            ],
          },
        },
      ],
      bubbles: [
        { composerId: 'comp-1', bubbleId: 'u-1', record: userBubble('u-1', 'why is half-checked broken?') },
        { composerId: 'comp-1', bubbleId: 'a-1-think', record: asstThinkingBubble('a-1-think', 'Need to read the file.') },
        { composerId: 'comp-1', bubbleId: 'a-1', record: asstTextBubble('a-1', 'Here is the fix.', { inputTokens: 200, outputTokens: 50 }) },
        { composerId: 'comp-1', bubbleId: 'u-2', record: userBubble('u-2', 'apply it', { createdAt: '2026-05-01T10:00:08.000Z' }) },
        { composerId: 'comp-1', bubbleId: 'a-2', record: asstTextBubble('a-2', 'Applied.', { createdAt: '2026-05-01T10:00:10.000Z', outputTokens: 10 }) },
      ],
      workspaces: [{ wsId: 'ws-1', folder: '/Users/me/proj-alpha' }],
    });

    const { sessions, workspaces } = parseCursorComposerSessions(edition);
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.harness).toBe('Cursor');
    expect(s.sessionId).toBe('comp-1');
    expect(s.workspaceId).toBe('cursor-ws-1');
    expect(s.workspaceName).toBe('proj-alpha');
    expect(s.workspaceRootPath).toBe('/Users/me/proj-alpha');
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0].messageText).toBe('why is half-checked broken?');
    expect(s.requests[0].responseText).toBe('Here is the fix.');
    expect(s.requests[0].agentName).toBe('Cursor');
    expect(s.requests[0].agentMode).toBe('agent');
    expect(s.requests[0].modelId).toBe('claude-opus-4-7-thinking-xhigh');
    expect(s.requests[0].promptTokens).toBe(200);
    expect(s.requests[0].completionTokens).toBe(50);
    // `-xhigh` is Cursor's "Max" reasoning effort.
    expect(s.requests[0].reasoningEffort).toBe('max');
    // Last request carries the todo snapshot.
    expect(s.requests[0].todoSnapshot).toBeNull();
    expect(s.requests[1].messageText).toBe('apply it');
    expect(s.requests[1].todoSnapshot).toEqual([
      { id: 0, title: 'Done item', status: 'completed' },
      { id: 1, title: 'In flight', status: 'in-progress' },
    ]);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].id).toBe('cursor-ws-1');
    expect(workspaces[0].name).toBe('proj-alpha');
  });

  it('attributes tool calls to toolsUsed and split edited vs referenced files', () => {
    const { edition } = createCursorDbs({
      composers: [
        {
          composerId: 'comp-tools',
          record: {
            composerId: 'comp-tools',
            name: 'Tooling demo',
            createdAt: 1735_000_000_000,
            modelConfig: { modelName: 'claude-sonnet-4-5' },
            unifiedMode: 'agent',
            fullConversationHeadersOnly: [
              userBubbleHeader('u-1'),
              asstBubbleHeader('t-read'),
              asstBubbleHeader('t-write'),
              asstBubbleHeader('a-final'),
            ],
            workspaceIdentifier: { id: 'ws-tools' },
            originalFileStates: {
              'file:///Users/me/proj-tools/src/edited.ts': { firstEditBubbleId: 't-write', isNewlyCreated: false },
            },
            newlyCreatedFiles: [{ uri: { fsPath: '/Users/me/proj-tools/src/created.ts' } }],
          },
        },
      ],
      bubbles: [
        { composerId: 'comp-tools', bubbleId: 'u-1', record: userBubble('u-1', 'do the thing') },
        { composerId: 'comp-tools', bubbleId: 't-read', record: asstToolBubble('t-read', 'read_file_v2', JSON.stringify({ target_file: '/Users/me/proj-tools/src/edited.ts' })) },
        { composerId: 'comp-tools', bubbleId: 't-write', record: asstToolBubble('t-write', 'write_to_file', JSON.stringify({ target_file: '/Users/me/proj-tools/src/edited.ts' })) },
        { composerId: 'comp-tools', bubbleId: 'a-final', record: asstTextBubble('a-final', 'all done') },
      ],
      workspaces: [{ wsId: 'ws-tools', folder: '/Users/me/proj-tools' }],
    });

    const { sessions } = parseCursorComposerSessions(edition);
    expect(sessions).toHaveLength(1);
    const req = sessions[0].requests[0];
    expect(req.toolsUsed).toEqual(['read_file_v2', 'write_to_file']);
    // Edited file from the write tool + composer-level aggregate.
    expect(req.editedFiles).toContain('/Users/me/proj-tools/src/edited.ts');
    expect(req.editedFiles).toContain('/Users/me/proj-tools/src/created.ts');
    // Read file goes into referencedFiles, NOT editedFiles.
    expect(req.referencedFiles).toContain('/Users/me/proj-tools/src/edited.ts');
  });

  it('falls back to trackedGitRepos when workspaceIdentifier is missing', () => {
    const { edition } = createCursorDbs({
      composers: [
        {
          composerId: 'comp-orphan',
          record: {
            composerId: 'comp-orphan',
            createdAt: 1735_000_000_000,
            modelConfig: { modelName: 'gpt-5' },
            fullConversationHeadersOnly: [userBubbleHeader('u-1'), asstBubbleHeader('a-1')],
            trackedGitRepos: [{ repoPath: '/Users/me/orphan-repo' }],
          },
        },
      ],
      bubbles: [
        { composerId: 'comp-orphan', bubbleId: 'u-1', record: userBubble('u-1', 'orphan') },
        { composerId: 'comp-orphan', bubbleId: 'a-1', record: asstTextBubble('a-1', 'ok') },
      ],
    });

    const { sessions } = parseCursorComposerSessions(edition);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].workspaceName).toBe('orphan-repo');
    expect(sessions[0].workspaceRootPath).toBe('/Users/me/orphan-repo');
  });

  it('reverse-looks-up workspace via per-workspace selectedComposerIds', () => {
    const { edition } = createCursorDbs({
      composers: [
        {
          composerId: 'comp-rev',
          record: {
            composerId: 'comp-rev',
            createdAt: 1735_000_000_000,
            modelConfig: { modelName: 'gpt-5' },
            fullConversationHeadersOnly: [userBubbleHeader('u-1'), asstBubbleHeader('a-1')],
          },
        },
      ],
      bubbles: [
        { composerId: 'comp-rev', bubbleId: 'u-1', record: userBubble('u-1', 'q?') },
        { composerId: 'comp-rev', bubbleId: 'a-1', record: asstTextBubble('a-1', 'a.') },
      ],
      workspaces: [{ wsId: 'ws-rev', folder: '/Users/me/rev-proj', selectedComposerIds: ['comp-rev'] }],
    });

    const { sessions } = parseCursorComposerSessions(edition);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].workspaceId).toBe('cursor-ws-rev');
    expect(sessions[0].workspaceName).toBe('rev-proj');
  });

  it('surfaces thinking text when there is no plain assistant reply', () => {
    const { edition } = createCursorDbs({
      composers: [
        {
          composerId: 'comp-think',
          record: {
            composerId: 'comp-think',
            createdAt: 1735_000_000_000,
            modelConfig: { modelName: 'claude-opus-4-7-thinking-xhigh', maxMode: true },
            fullConversationHeadersOnly: [
              userBubbleHeader('u-1'),
              asstBubbleHeader('a-think'),
            ],
          },
        },
      ],
      bubbles: [
        { composerId: 'comp-think', bubbleId: 'u-1', record: userBubble('u-1', 'think hard') },
        { composerId: 'comp-think', bubbleId: 'a-think', record: asstThinkingBubble('a-think', 'pondering deeply') },
      ],
    });

    const { sessions } = parseCursorComposerSessions(edition);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].requests[0].responseText).toContain('<thinking>');
    expect(sessions[0].requests[0].responseText).toContain('pondering deeply');
    // `-xhigh` model id maps directly to `max`.
    expect(sessions[0].requests[0].reasoningEffort).toBe('max');
  });

  it('orders bubbles using fullConversationHeadersOnly even when bubble createdAt is out of order', () => {
    const { edition } = createCursorDbs({
      composers: [
        {
          composerId: 'comp-order',
          record: {
            composerId: 'comp-order',
            createdAt: 1735_000_000_000,
            modelConfig: { modelName: 'gpt-5' },
            fullConversationHeadersOnly: [
              userBubbleHeader('first-user'),
              asstBubbleHeader('first-asst'),
              userBubbleHeader('second-user'),
              asstBubbleHeader('second-asst'),
            ],
          },
        },
      ],
      bubbles: [
        // Insert in reverse chronological order; the header list must still
        // drive request ordering.
        { composerId: 'comp-order', bubbleId: 'second-asst', record: asstTextBubble('second-asst', 'second reply', { createdAt: '2026-05-01T10:01:00.000Z' }) },
        { composerId: 'comp-order', bubbleId: 'second-user', record: userBubble('second-user', 'follow-up', { createdAt: '2026-05-01T10:00:50.000Z' }) },
        { composerId: 'comp-order', bubbleId: 'first-asst', record: asstTextBubble('first-asst', 'first reply', { createdAt: '2026-05-01T10:00:20.000Z' }) },
        { composerId: 'comp-order', bubbleId: 'first-user', record: userBubble('first-user', 'initial', { createdAt: '2026-05-01T10:00:00.000Z' }) },
      ],
    });

    const { sessions } = parseCursorComposerSessions(edition);
    expect(sessions[0].requests.map(r => r.messageText)).toEqual(['initial', 'follow-up']);
    expect(sessions[0].requests.map(r => r.responseText)).toEqual(['first reply', 'second reply']);
  });

  it('returns no sessions when the database has no composers', () => {
    const { edition } = createCursorDbs({ composers: [], bubbles: [] });
    const { sessions } = parseCursorComposerSessions(edition);
    expect(sessions).toEqual([]);
  });
});

describe('loadCursorComposerSession', () => {
  it('reloads a single composer with full response text', () => {
    const { edition } = createCursorDbs({
      composers: [
        {
          composerId: 'comp-detail',
          record: {
            composerId: 'comp-detail',
            createdAt: 1735_000_000_000,
            modelConfig: { modelName: 'gpt-5' },
            unifiedMode: 'agent',
            fullConversationHeadersOnly: [userBubbleHeader('u-1'), asstBubbleHeader('a-1')],
            workspaceIdentifier: { id: 'ws-detail' },
          },
        },
      ],
      bubbles: [
        { composerId: 'comp-detail', bubbleId: 'u-1', record: userBubble('u-1', 'explain the architecture') },
        { composerId: 'comp-detail', bubbleId: 'a-1', record: asstTextBubble('a-1', 'The full detailed answer.') },
      ],
      workspaces: [{ wsId: 'ws-detail', folder: '/Users/me/detail-proj' }],
    });

    const session = loadCursorComposerSession(edition.globalDb, edition.workspaceStorageRoot, 'comp-detail', edition.harness);
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe('comp-detail');
    expect(session?.harness).toBe('Cursor');
    expect(session?.requests[0].messageText).toBe('explain the architecture');
    expect(session?.requests[0].responseText).toBe('The full detailed answer.');
    expect(session?.workspaceName).toBe('detail-proj');
  });

  it('returns null for an unknown composer id', () => {
    const { edition } = createCursorDbs({ composers: [], bubbles: [] });
    expect(loadCursorComposerSession(edition.globalDb, edition.workspaceStorageRoot, 'missing', edition.harness)).toBeNull();
  });
});
