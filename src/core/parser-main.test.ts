/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Dirent } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./parser-vscode', () => ({
  findVsCodeDirs: vi.fn(() => []),
  scanVsCodeDirs: vi.fn(() => ({ entries: [], totalDirs: 0 })),
  processWorkspaceEntry: vi.fn(),
  processWorkspaceEntryAsync: vi.fn(() => Promise.resolve('')),
  harnessFromPath: vi.fn(() => 'Cursor'),
}));

vi.mock('./cache', () => ({
  getMemoryCache: vi.fn(() => null),
  setMemoryCache: vi.fn(),
  computeDirMetasAsync: vi.fn(() => Promise.resolve({})),
  loadCacheData: vi.fn(() => Promise.resolve(null)),
  saveCacheData: vi.fn(() => Promise.resolve()),
  findStaleDirs: vi.fn(() => ({ stale: new Set(), removed: new Set() })),
  clearCache: vi.fn(),
  stripSessionsForMemory: vi.fn(),
}));

import type { ParseResult } from './parser';
import type { Session } from './types';
import { LOAD_PHASES, clearCache, findLogsDirs, parseAllLogs, parseAllLogsAsyncDetailed } from './parser';
import {
  clearCache as cacheClearCache,
  computeDirMetasAsync,
  findStaleDirs,
  getMemoryCache,
  loadCacheData,
  saveCacheData,
  setMemoryCache,
  stripSessionsForMemory,
} from './cache';
import {
  findVsCodeDirs,
  harnessFromPath,
  processWorkspaceEntry,
  processWorkspaceEntryAsync,
  scanVsCodeDirs,
} from './parser-vscode';

function makeResult(): ParseResult {
  return {
    workspaces: new Map(),
    sessions: [],
    editLocIndex: new Map(),
    sessionSourceIndex: new Map(),
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    workspaceId: 'ws-1',
    workspaceName: 'Workspace 1',
    location: '/logs/workspace-1',
    harness: 'Cursor',
    creationDate: null,
    lastMessageDate: null,
    requestCount: 0,
    requests: [],
    ...overrides,
  };
}

function dirEntry(name: string): Dirent {
  return { name } as Dirent;
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(findVsCodeDirs).mockReturnValue([]);
  vi.mocked(scanVsCodeDirs).mockReturnValue({ entries: [], totalDirs: 0 });
  vi.mocked(processWorkspaceEntry).mockImplementation(() => '');
  vi.mocked(processWorkspaceEntryAsync).mockResolvedValue('');
  vi.mocked(harnessFromPath).mockReturnValue('Cursor');

  vi.mocked(getMemoryCache).mockReturnValue(null);
  vi.mocked(setMemoryCache).mockImplementation(() => {});
  vi.mocked(computeDirMetasAsync).mockResolvedValue({});
  vi.mocked(loadCacheData).mockResolvedValue(null);
  vi.mocked(saveCacheData).mockResolvedValue();
  vi.mocked(findStaleDirs).mockReturnValue({ stale: new Set(), removed: new Set() });
  vi.mocked(stripSessionsForMemory).mockImplementation(() => {});
});

describe('LOAD_PHASES', () => {
  it('contains the expected phase labels in order', () => {
    expect(LOAD_PHASES).toEqual([
      'Discovering log directories',
      'Checking cache',
      'Parsing Cursor sessions',
      'Preparing analytics',
      'Ready',
    ]);
  });
});

describe('findLogsDirs', () => {
  it('returns the Cursor workspace storage dirs', () => {
    vi.mocked(findVsCodeDirs).mockReturnValue(['/logs/cursor-a', '/logs/cursor-b']);

    expect(findLogsDirs()).toEqual(['/logs/cursor-a', '/logs/cursor-b']);
  });
});

describe('parseAllLogs', () => {
  it('returns an empty result for empty logs dirs', () => {
    const result = parseAllLogs([]);

    expect(result).toEqual({
      workspaces: new Map(),
      sessions: [],
      editLocIndex: new Map(),
      sessionSourceIndex: new Map(),
    });
    expect(scanVsCodeDirs).toHaveBeenCalledWith([]);
  });

  it('processes each Cursor workspace entry', () => {
    vi.mocked(scanVsCodeDirs).mockReturnValue({
      entries: [
        { logsDir: '/logs/cursor', dirEntries: [dirEntry('ws-1'), dirEntry('ws-2')] },
        { logsDir: '/logs/cursor-nightly', dirEntries: [dirEntry('ws-3')] },
      ],
      totalDirs: 3,
    });

    parseAllLogs(['/logs/cursor', '/logs/cursor-nightly']);

    expect(processWorkspaceEntry).toHaveBeenCalledTimes(3);
    expect(processWorkspaceEntry).toHaveBeenNthCalledWith(1, '/logs/cursor', 'ws-1', 'Cursor', expect.any(Object));
    expect(processWorkspaceEntry).toHaveBeenNthCalledWith(2, '/logs/cursor', 'ws-2', 'Cursor', expect.any(Object));
    expect(processWorkspaceEntry).toHaveBeenNthCalledWith(3, '/logs/cursor-nightly', 'ws-3', 'Cursor', expect.any(Object));
  });

  it('uses harnessFromPath for each Cursor logs dir', () => {
    vi.mocked(scanVsCodeDirs).mockReturnValue({
      entries: [{ logsDir: '/logs/custom', dirEntries: [dirEntry('ws-1')] }],
      totalDirs: 1,
    });

    parseAllLogs(['/logs/custom']);

    expect(harnessFromPath).toHaveBeenCalledWith('/logs/custom');
    expect(processWorkspaceEntry).toHaveBeenCalledWith('/logs/custom', 'ws-1', 'Cursor', expect.any(Object));
  });

  it('calls stripSessionsForMemory with parsed sessions', () => {
    const result = parseAllLogs(['/logs/cursor']);

    expect(stripSessionsForMemory).toHaveBeenCalledWith(result.sessions);
  });
});

describe('parseAllLogsAsyncDetailed', () => {
  it('returns cached data on memory-cache hit', async () => {
    const cachedResult = makeResult();
    cachedResult.sessions.push(makeSession());
    const currentMetas = { '/logs/ws-1': { chatCount: 1, chatMaxMtime: 1, editCount: 0, editMaxMtime: 0 } };

    vi.mocked(computeDirMetasAsync).mockResolvedValue(currentMetas);
    vi.mocked(getMemoryCache).mockReturnValue({ result: cachedResult, dirMetas: { '/logs/ws-1': { chatCount: 1, chatMaxMtime: 1, editCount: 0, editMaxMtime: 0 } } });

    const parsed = await parseAllLogsAsyncDetailed(['/logs']);

    expect(parsed).toEqual({ result: cachedResult, dirMetas: currentMetas });
  });

  it('skips disk cache and full parsing on memory-cache hit', async () => {
    vi.mocked(getMemoryCache).mockReturnValue({ result: makeResult(), dirMetas: {} });

    await parseAllLogsAsyncDetailed(['/logs']);

    expect(loadCacheData).not.toHaveBeenCalled();
    expect(scanVsCodeDirs).not.toHaveBeenCalled();
    expect(processWorkspaceEntryAsync).not.toHaveBeenCalled();
    expect(setMemoryCache).not.toHaveBeenCalled();
  });

  it('reports progress during a cold parse', async () => {
    const progress: Array<{ phase: number; detail?: string; workspacePlan?: string[]; workspaceDone?: string }> = [];

    vi.mocked(scanVsCodeDirs).mockReturnValue({
      entries: [{ logsDir: '/logs/cursor', dirEntries: [dirEntry('ws-1')] }],
      totalDirs: 1,
    });
    vi.mocked(processWorkspaceEntryAsync).mockImplementation((_logsDir, wsId, _harness, _ctx, onWorkspaceProgress) => {
      onWorkspaceProgress?.({ wsName: `Workspace ${wsId}`, detail: 'reading sessions', completed: 1, total: 1 });
      return Promise.resolve(`Workspace ${wsId}`);
    });

    await parseAllLogsAsyncDetailed(['/logs/cursor'], (update) => {
      progress.push(update);
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some(update => update.detail === 'Computing directory fingerprints')).toBe(true);
    expect(progress.some(update => update.detail === 'Loading disk cache')).toBe(true);
    expect(progress.some(update => update.detail === 'Cold parse')).toBe(true);
    expect(progress.some(update => update.phase === 2 && Array.isArray(update.workspacePlan))).toBe(true);
    expect(progress.some(update => update.phase === 2 && typeof update.workspaceDone === 'string')).toBe(true);
  });

  it('processes each Cursor workspace asynchronously during cold parse', async () => {
    vi.mocked(scanVsCodeDirs).mockReturnValue({
      entries: [{ logsDir: '/logs/cursor', dirEntries: [dirEntry('ws-1'), dirEntry('ws-2')] }],
      totalDirs: 2,
    });

    await parseAllLogsAsyncDetailed(['/logs/cursor']);

    expect(processWorkspaceEntryAsync).toHaveBeenCalledTimes(2);
    expect(processWorkspaceEntryAsync).toHaveBeenNthCalledWith(1, '/logs/cursor', 'ws-1', 'Cursor', expect.any(Object), expect.any(Function));
    expect(processWorkspaceEntryAsync).toHaveBeenNthCalledWith(2, '/logs/cursor', 'ws-2', 'Cursor', expect.any(Object), expect.any(Function));
  });

  it('strips sessions and saves caches after cold parse', async () => {
    const currentMetas = { '/logs/ws-1': { chatCount: 2, chatMaxMtime: 10, editCount: 1, editMaxMtime: 5 } };
    vi.mocked(computeDirMetasAsync).mockResolvedValue(currentMetas);

    const parsed = await parseAllLogsAsyncDetailed(['/logs/cursor']);

    expect(stripSessionsForMemory).toHaveBeenCalledWith(parsed.result.sessions);
    expect(setMemoryCache).toHaveBeenCalledWith(parsed.result, currentMetas);
    expect(saveCacheData).toHaveBeenCalledWith(parsed.result, currentMetas);
  });

  it('reports loaded-from-memory progress on memory-cache hit', async () => {
    const progress: string[] = [];
    const cachedResult = makeResult();
    cachedResult.sessions.push(makeSession());

    vi.mocked(getMemoryCache).mockReturnValue({ result: cachedResult, dirMetas: {} });

    await parseAllLogsAsyncDetailed(['/logs'], (update) => {
      progress.push(update.detail ?? '');
    });

    expect(progress).toContain('Loaded from memory');
  });
});

describe('clearCache', () => {
  it('re-exports clearCache from cache', () => {
    clearCache();

    expect(cacheClearCache).toHaveBeenCalledTimes(1);
  });
});
