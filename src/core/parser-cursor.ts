/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Cursor Composer / Agent session parser.
 *
 * Cursor (unlike the VS Code chat format read by parser-vscode) stores its
 * native Composer/Agent conversations in a SQLite database, not in
 * `workspaceStorage/<wsId>/chatSessions/*.jsonl`.
 *
 * Data layout (macOS):
 *   ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb        (SQLite)
 *   ~/Library/Application Support/Cursor/User/workspaceStorage/<wsId>/state.vscdb
 *   ~/Library/Application Support/Cursor/User/workspaceStorage/<wsId>/workspace.json
 *
 * The global state.vscdb contains a `cursorDiskKV` table with two key families
 * we care about:
 *   - `composerData:<composerId>`  — one row per Composer session. Holds the
 *     model, title, creation/update timestamps, todos, workspaceIdentifier,
 *     tracked git repos, ordered list of bubble headers, etc.
 *   - `bubbleId:<composerId>:<bubbleId>` — one row per turn or sub-turn inside
 *     a Composer. `type=1` is a user message, `type=2` is an assistant message
 *     (which may carry plain text, a thinking block, or a tool call via
 *     `toolFormerData`).
 *
 * This parser maps each Composer to a `Session` and groups bubbles into
 * `SessionRequest` turns (one per user message). Chat sessions written in the
 * VS Code `chatSessions/*.jsonl` format are handled separately by parser-vscode.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile, execFileSync } from 'child_process';
import { Session, SessionRequest, TodoItem, Workspace } from './types';
import {
  assertTrustedPath,
  createRequest,
  createSession,
  detectDevcontainerFromRequests,
  extractSkillNameFromPath,
} from './parser-shared';
import { canonicalizeReasoningEffort, extractReasoningEffortFromModelId } from './helpers';
import { debugCore, warnCore } from './log';

const CURSOR_HARNESS = 'Cursor';
const CURSOR_NIGHTLY_HARNESS = 'Cursor Nightly';

const SQLITE_TIMEOUT_MS = 60_000;
const SQLITE_MAX_BUFFER = 256 * 1024 * 1024;

/* ---- Discovery ---- */

export interface CursorEdition {
  name: string;
  harness: string;
  globalDb: string;
  workspaceStorageRoot: string;
}

function editionPaths(edition: 'Cursor' | 'Cursor Nightly'): { global: string; workspaceStorage: string } | null {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return null;
  let userDir: string;
  if (process.platform === 'darwin') {
    userDir = path.join(home, 'Library', 'Application Support', edition, 'User');
  } else if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || '';
    if (!appdata) return null;
    userDir = path.join(appdata, edition, 'User');
  } else {
    userDir = path.join(home, '.config', edition, 'User');
  }
  return {
    global: path.join(userDir, 'globalStorage', 'state.vscdb'),
    workspaceStorage: path.join(userDir, 'workspaceStorage'),
  };
}

export function findCursorEditions(): CursorEdition[] {
  const editions: CursorEdition[] = [];
  for (const { name, harness } of [
    { name: 'Cursor' as const, harness: CURSOR_HARNESS },
    { name: 'Cursor Nightly' as const, harness: CURSOR_NIGHTLY_HARNESS },
  ]) {
    const ep = editionPaths(name);
    if (!ep) continue;
    if (!fs.existsSync(ep.global)) continue;
    editions.push({
      name,
      harness,
      globalDb: ep.global,
      workspaceStorageRoot: ep.workspaceStorage,
    });
  }
  return editions;
}

/* ---- SQLite helpers (shell out to the sqlite3 CLI) ---- */

/** Build a `file:` URI with `immutable=1` so sqlite3 can read snapshots of
 *  databases that the running Cursor process holds open with exclusive
 *  locks. `immutable=1` skips lock acquisition (safe because we never write). */
function toImmutableUri(dbPath: string): string {
  // sqlite3 expects URIs to use forward slashes even on Windows.
  const posix = dbPath.replaceAll('\\', '/');
  const prefix = posix.startsWith('/') ? 'file://' : 'file:///';
  return `${prefix}${posix}?immutable=1`;
}

function sqliteJsonSync<T = unknown>(dbPath: string, sql: string): T[] {
  assertTrustedPath(dbPath);
  try {
    const out = execFileSync('sqlite3', ['-readonly', '-json', toImmutableUri(dbPath), sql], {
      encoding: 'utf-8',
      timeout: SQLITE_TIMEOUT_MS,
      maxBuffer: SQLITE_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out ? (JSON.parse(out) as T[]) : [];
  } catch (e) {
    debugCore('parser-cursor', `sqlite3 query failed on ${dbPath}`, e);
    return [];
  }
}

function sqliteJsonAsync<T = unknown>(dbPath: string, sql: string): Promise<T[]> {
  return new Promise(resolve => {
    try { assertTrustedPath(dbPath); } catch (e) {
      debugCore('parser-cursor', `untrusted db ${dbPath}`, e);
      resolve([]);
      return;
    }
    execFile('sqlite3', ['-readonly', '-json', toImmutableUri(dbPath), sql], {
      encoding: 'utf-8',
      timeout: SQLITE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: SQLITE_MAX_BUFFER,
    }, (err, stdout) => {
      if (err) {
        debugCore('parser-cursor', `sqlite3 query failed on ${dbPath}`, err.message);
        resolve([]);
        return;
      }
      if (!stdout) { resolve([]); return; }
      try {
        resolve(JSON.parse(stdout) as T[]);
      } catch (parseErr) {
        warnCore('parser-cursor', `sqlite3 returned unparseable JSON on ${dbPath}`, parseErr);
        resolve([]);
      }
    });
  });
}

/* ---- Account readers (local, read-only) ---- */

/** Read a single `ItemTable` value by key from the first Cursor edition's global DB. */
function readGlobalItem(key: string): string | null {
  for (const ed of findCursorEditions()) {
    if (!fs.existsSync(ed.globalDb)) continue;
    const rows = sqliteJsonSync<{ value: string }>(
      ed.globalDb,
      `SELECT value FROM ItemTable WHERE key = '${key.replaceAll("'", "''")}'`,
    );
    const v = rows[0]?.value;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Read the user's Stripe membership type (plan tier) from local Cursor account
 * data. Local, read-only, no network. Returns e.g. "enterprise", "pro", "free".
 */
export function readCursorMembershipType(): string | null {
  return readGlobalItem('cursorAuth/stripeMembershipType');
}

/**
 * Read the Cursor access token (JWT) from local account data, for the opt-in
 * live-usage fetch only. SENSITIVE: callers must use it transiently and must
 * never log, persist, or send it anywhere other than Cursor's own backend.
 */
export function readCursorAccessToken(): string | null {
  return readGlobalItem('cursorAuth/accessToken');
}

/* ---- Workspace mapping helpers ---- */

interface WorkspaceFolderInfo {
  wsId: string;
  folderPath: string | null;
  composerIds: string[];
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function fileUriToFsPath(uri: string): string | null {
  if (!uri) return null;
  if (uri.startsWith('file://')) {
    try { return decodeURIComponent(uri.replace(/^file:\/\//, '')); }
    catch { return uri.replace(/^file:\/\//, ''); }
  }
  return uri.startsWith('/') ? uri : null;
}

function workspaceNameFromPath(p: string | null | undefined): string {
  if (!p) return '';
  const cleaned = p.replaceAll('\\', '/').replace(/\/+$/, '');
  return cleaned.split('/').pop() || '';
}

function readWorkspaceComposerIds(dbPath: string): string[] {
  if (!fs.existsSync(dbPath)) return [];
  try {
    const rows = sqliteJsonSync<{ value: string }>(
      dbPath,
      "SELECT value FROM ItemTable WHERE key = 'composer.composerData'",
    );
    const raw = rows[0]?.value;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { selectedComposerIds?: string[]; lastFocusedComposerIds?: string[] };
    const seen = new Set<string>();
    const out: string[] = [];
    for (const list of [parsed.selectedComposerIds, parsed.lastFocusedComposerIds]) {
      for (const id of list ?? []) {
        if (typeof id !== 'string' || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  } catch (e) {
    debugCore('parser-cursor', `cannot read per-workspace composers from ${dbPath}`, e);
    return [];
  }
}

/** Walk Cursor's workspaceStorage to map workspaceId → folder path and the
 *  composer IDs that were last selected for that workspace. The composer IDs
 *  are best-effort: Cursor's per-workspace `composer.composerData` only
 *  stores the currently-selected tabs, not the full history. */
function discoverWorkspaceFolders(workspaceStorageRoot: string): Map<string, WorkspaceFolderInfo> {
  const map = new Map<string, WorkspaceFolderInfo>();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspaceStorageRoot, { withFileTypes: true });
  } catch (e) {
    debugCore('parser-cursor', `cannot read workspaceStorage ${workspaceStorageRoot}`, e);
    return map;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsId = entry.name;
    const wsDir = path.join(workspaceStorageRoot, wsId);
    const wsJsonPath = path.join(wsDir, 'workspace.json');
    const dbPath = path.join(wsDir, 'state.vscdb');

    const wsJson = safeReadJson<{ folder?: string; configuration?: string }>(wsJsonPath);
    const folderUri = wsJson?.folder ?? wsJson?.configuration ?? null;
    const folderPath = folderUri ? fileUriToFsPath(folderUri) : null;

    const composerIds = readWorkspaceComposerIds(dbPath);
    map.set(wsId, { wsId, folderPath, composerIds });
  }
  return map;
}

/* ---- Composer + bubble shape ---- */

interface ComposerHeader {
  bubbleId: string;
  type?: number;
  grouping?: {
    isRenderable?: boolean;
    capabilityType?: number;
    toolFormerTool?: number;
    toolCallId?: string;
    hasThinking?: boolean;
    thinkingDurationMs?: number;
    hasText?: boolean;
  };
}

interface ComposerTodo {
  id?: string;
  content?: string;
  status?: string;
  dependencies?: string[];
}

interface ComposerOriginalFileState {
  firstEditBubbleId?: string;
  isNewlyCreated?: boolean;
}

interface ComposerNewFile {
  uri?: { fsPath?: string; path?: string; external?: string };
}

interface ComposerTrackedRepo {
  repoPath?: string;
}

interface ComposerCursorRule {
  filename?: string;
}

interface ComposerRecord {
  _v?: number;
  composerId: string;
  name?: string;
  subtitle?: string;
  status?: string;
  unifiedMode?: string;
  forceMode?: string;
  isAgentic?: boolean;
  isReadingLongFile?: boolean;
  fullConversationHeadersOnly?: ComposerHeader[];
  createdAt?: number;
  lastUpdatedAt?: number;
  conversationCheckpointLastUpdatedAt?: number;
  modelConfig?: { modelName?: string; maxMode?: boolean };
  agentBackend?: string;
  contextUsagePercent?: number;
  contextTokensUsed?: number;
  contextTokenLimit?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  addedFiles?: number;
  removedFiles?: number;
  filesChangedCount?: number;
  todos?: ComposerTodo[];
  originalFileStates?: Record<string, ComposerOriginalFileState>;
  newlyCreatedFiles?: ComposerNewFile[];
  trackedGitRepos?: ComposerTrackedRepo[];
  cursorRules?: ComposerCursorRule[];
  workspaceIdentifier?: {
    id?: string;
    configPath?: { fsPath?: string; path?: string; external?: string };
  };
}

interface BubbleRow {
  key: string;
  id: string;
  type: number | null;
  text: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  capabilityType: number | null;
  toolName: string;
  toolStatus: string;
  toolArgs: string;
  createdAtIso: string;
  inputTokens: number | null;
  outputTokens: number | null;
  requestId: string;
  fileSelectionsJson: string;
  cursorRulesJson: string;
}

const BUBBLE_FIELDS_SQL = [
  'key',
  "json_extract(value, '$.bubbleId') AS id",
  "json_extract(value, '$.type') AS type",
  "coalesce(json_extract(value, '$.text'), '') AS text",
  "coalesce(json_extract(value, '$.thinking.text'), '') AS thinkingText",
  "json_extract(value, '$.thinkingDurationMs') AS thinkingDurationMs",
  "json_extract(value, '$.capabilityType') AS capabilityType",
  "coalesce(json_extract(value, '$.toolFormerData.name'), '') AS toolName",
  "coalesce(json_extract(value, '$.toolFormerData.status'), '') AS toolStatus",
  "coalesce(json_extract(value, '$.toolFormerData.rawArgs'), '') AS toolArgs",
  "coalesce(json_extract(value, '$.createdAt'), '') AS createdAtIso",
  "json_extract(value, '$.tokenCount.inputTokens') AS inputTokens",
  "json_extract(value, '$.tokenCount.outputTokens') AS outputTokens",
  "coalesce(json_extract(value, '$.requestId'), '') AS requestId",
  "coalesce(json_extract(value, '$.context.fileSelections'), '[]') AS fileSelectionsJson",
  "coalesce(json_extract(value, '$.cursorRules'), '[]') AS cursorRulesJson",
].join(', ');

function escapeForGlob(value: string): string {
  // GLOB special chars: * ? [ ] -. Cursor IDs are UUIDs, no special chars, but
  // defensive escaping keeps this safe if Cursor ever changes the format.
  return value.replaceAll('[', '[[]');
}

/** Escape a value for embedding inside a single-quoted SQLite string literal. */
function escapeForSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

/* ---- Per-bubble helpers ---- */

function isoToMs(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

interface FileSelection { uri?: { path?: string; fsPath?: string; external?: string } }

function decodeFileSelections(raw: string): string[] {
  if (!raw || raw === '[]') return [];
  let parsed: FileSelection[];
  try { parsed = JSON.parse(raw) as FileSelection[]; } catch { return []; }
  const out: string[] = [];
  for (const sel of parsed) {
    const p = sel?.uri?.fsPath || sel?.uri?.path || (sel?.uri?.external ? fileUriToFsPath(sel.uri.external) : null);
    if (p) out.push(p);
  }
  return out;
}

interface CursorRuleEntry { filename?: string }

function decodeCursorRuleNames(raw: string): string[] {
  if (!raw || raw === '[]') return [];
  let parsed: CursorRuleEntry[];
  try { parsed = JSON.parse(raw) as CursorRuleEntry[]; } catch { return []; }
  const out: string[] = [];
  for (const r of parsed) {
    const file = r?.filename;
    if (!file) continue;
    // Try the SKILL.md detector first.
    const fromSkill = extractSkillNameFromPath(file);
    if (fromSkill) { out.push(fromSkill); continue; }
    // Fallback: take the second-to-last path segment, stripping the leading
    // emoji prefix that Cursor uses for built-in vs project rules.
    const cleaned = file.replace(/^[\p{Extended_Pictographic}\s]+/u, '').replaceAll('\\', '/');
    const segments = cleaned.split('/').filter(Boolean);
    const stem = segments.length >= 2 ? (segments.at(-2) ?? '') : (segments.at(-1) ?? '');
    if (stem) out.push(stem);
  }
  return out;
}

function todoStatusOf(raw: string | undefined): TodoItem['status'] {
  if (raw === 'completed') return 'completed';
  if (raw === 'in-progress' || raw === 'in_progress' || raw === 'inProgress') return 'in-progress';
  return 'not-started';
}

function mapComposerTodos(todos: ComposerTodo[] | undefined): TodoItem[] | null {
  if (!Array.isArray(todos) || todos.length === 0) return null;
  return todos.map((t, idx) => ({
    id: Number.isFinite(Number(t.id)) ? Number(t.id) : idx,
    title: String(t.content ?? ''),
    status: todoStatusOf(t.status),
  }));
}

/* ---- Workspace resolution per-composer ---- */

interface ResolvedWorkspace {
  workspaceId: string;
  workspaceName: string;
  workspaceRootPath: string;
}

function configPathToFolder(cfg: ComposerRecord['workspaceIdentifier']): string {
  const fs1 = cfg?.configPath?.fsPath;
  const fs2 = fs1 ?? fileUriToFsPath(cfg?.configPath?.external ?? '');
  const folder = fs2 ?? cfg?.configPath?.path ?? '';
  if (folder.endsWith('.code-workspace')) return path.dirname(folder);
  return folder;
}

function tryResolveByWsId(composer: ComposerRecord, workspaceFolders: Map<string, WorkspaceFolderInfo>): ResolvedWorkspace | null {
  const wsId = composer.workspaceIdentifier?.id;
  if (!wsId) return null;
  const info = workspaceFolders.get(wsId);
  if (!info) return null;
  const folder = info.folderPath || configPathToFolder(composer.workspaceIdentifier) || '';
  return {
    workspaceId: `cursor-${wsId}`,
    workspaceName: workspaceNameFromPath(folder) || wsId,
    workspaceRootPath: folder,
  };
}

function tryResolveByConfigPath(composer: ComposerRecord): ResolvedWorkspace | null {
  const folder = configPathToFolder(composer.workspaceIdentifier);
  if (!folder) return null;
  return {
    workspaceId: `cursor-${composer.workspaceIdentifier?.id || folder}`,
    workspaceName: workspaceNameFromPath(folder),
    workspaceRootPath: folder,
  };
}

function tryResolveByReverseLookup(
  composer: ComposerRecord,
  workspaceFolders: Map<string, WorkspaceFolderInfo>,
  composerIdToWsId: Map<string, string>,
): ResolvedWorkspace | null {
  const reverseWsId = composerIdToWsId.get(composer.composerId);
  if (!reverseWsId) return null;
  const info = workspaceFolders.get(reverseWsId);
  if (!info) return null;
  const folder = info.folderPath || '';
  return {
    workspaceId: `cursor-${reverseWsId}`,
    workspaceName: workspaceNameFromPath(folder) || reverseWsId,
    workspaceRootPath: folder,
  };
}

function tryResolveByTrackedRepo(composer: ComposerRecord): ResolvedWorkspace | null {
  const repoPath = composer.trackedGitRepos?.[0]?.repoPath;
  if (!repoPath) return null;
  return {
    workspaceId: `cursor-${repoPath}`,
    workspaceName: workspaceNameFromPath(repoPath),
    workspaceRootPath: repoPath,
  };
}

function tryResolveByFirstEditedFile(composer: ComposerRecord): ResolvedWorkspace | null {
  const firstFileUri = Object.keys(composer.originalFileStates ?? {})[0];
  const firstFile = firstFileUri ? fileUriToFsPath(firstFileUri) : null;
  if (!firstFile) return null;
  const parent = path.dirname(firstFile);
  return {
    workspaceId: `cursor-${parent}`,
    workspaceName: workspaceNameFromPath(parent),
    workspaceRootPath: parent,
  };
}

function resolveComposerWorkspace(
  composer: ComposerRecord,
  workspaceFolders: Map<string, WorkspaceFolderInfo>,
  composerIdToWsId: Map<string, string>,
): ResolvedWorkspace {
  return tryResolveByWsId(composer, workspaceFolders)
    ?? tryResolveByConfigPath(composer)
    ?? tryResolveByReverseLookup(composer, workspaceFolders, composerIdToWsId)
    ?? tryResolveByTrackedRepo(composer)
    ?? tryResolveByFirstEditedFile(composer)
    ?? {
      workspaceId: 'cursor-unknown',
      workspaceName: 'Cursor (unknown workspace)',
      workspaceRootPath: '',
    };
}

/* ---- Bubble grouping ---- */

interface AggregatedAssistant {
  text: string;
  thinking: string;
  toolsUsed: string[];
  editedFiles: string[];
  referencedFiles: string[];
  promptTokens: number;
  completionTokens: number;
  hasTokens: boolean;
  lastTs: number | null;
  totalThinkingMs: number;
}

function newAggregate(): AggregatedAssistant {
  return {
    text: '',
    thinking: '',
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    promptTokens: 0,
    completionTokens: 0,
    hasTokens: false,
    lastTs: null,
    totalThinkingMs: 0,
  };
}

/** Tools the assistant invoked. Returns the canonical tool name when present. */
function extractToolNames(b: BubbleRow): string[] {
  const names: string[] = [];
  if (b.toolName) names.push(b.toolName);
  return names;
}

const CURSOR_WRITE_TOOLS = new Set([
  'write_to_file', 'write', 'edit_file', 'edit', 'apply_diff', 'create_file',
  'apply_patch', 'patch', 'multi_edit', 'create', 'overwrite',
  'write_file_v2', 'edit_file_v2',
]);

const CURSOR_READ_TOOLS = new Set([
  'read_file', 'read_file_v2', 'read', 'view', 'view_file',
  'glob', 'grep', 'list_dir', 'find',
]);

interface ToolArgs {
  path?: string;
  filePath?: string;
  file_path?: string;
  target_file?: string;
  targetFile?: string;
  uri?: string;
}

function extractFileFromToolArgs(raw: string): string | null {
  if (!raw) return null;
  let parsed: ToolArgs;
  try { parsed = JSON.parse(raw) as ToolArgs; } catch { return null; }
  return parsed.target_file
    ?? parsed.targetFile
    ?? parsed.file_path
    ?? parsed.filePath
    ?? parsed.path
    ?? parsed.uri
    ?? null;
}

function accumulateTimestamps(b: BubbleRow, agg: AggregatedAssistant): void {
  const ts = isoToMs(b.createdAtIso);
  if (ts && (!agg.lastTs || ts > agg.lastTs)) agg.lastTs = ts;
}

function accumulateTokens(b: BubbleRow, agg: AggregatedAssistant): void {
  if (b.inputTokens != null) {
    agg.promptTokens += b.inputTokens;
    if (b.inputTokens > 0) agg.hasTokens = true;
  }
  if (b.outputTokens != null) {
    agg.completionTokens += b.outputTokens;
    if (b.outputTokens > 0) agg.hasTokens = true;
  }
}

function accumulateThinking(b: BubbleRow, agg: AggregatedAssistant): void {
  if (!b.thinkingText) return;
  agg.thinking += (agg.thinking ? '\n' : '') + b.thinkingText;
  if (b.thinkingDurationMs && Number.isFinite(b.thinkingDurationMs)) {
    agg.totalThinkingMs += b.thinkingDurationMs;
  }
}

function accumulateToolCall(b: BubbleRow, agg: AggregatedAssistant): void {
  const tools = extractToolNames(b);
  if (tools.length === 0) return;
  for (const t of tools) agg.toolsUsed.push(t);
  const lower = b.toolName.toLowerCase();
  const file = extractFileFromToolArgs(b.toolArgs);
  if (!file) return;
  if (CURSOR_WRITE_TOOLS.has(lower)) agg.editedFiles.push(file);
  else if (CURSOR_READ_TOOLS.has(lower)) agg.referencedFiles.push(file);
}

function applyAssistantBubble(b: BubbleRow, agg: AggregatedAssistant): void {
  accumulateTimestamps(b, agg);
  accumulateTokens(b, agg);
  accumulateThinking(b, agg);
  accumulateToolCall(b, agg);
  if (b.text && !b.thinkingText && !b.toolName) {
    agg.text += (agg.text ? '\n' : '') + b.text;
  }
}

/* ---- Session assembly ---- */

function composerCreatedTs(c: ComposerRecord, fallback: number | null): number | null {
  if (typeof c.createdAt === 'number' && c.createdAt > 0) return c.createdAt;
  return fallback;
}

function composerLastTs(c: ComposerRecord, fallback: number | null): number | null {
  if (typeof c.lastUpdatedAt === 'number' && c.lastUpdatedAt > 0) return c.lastUpdatedAt;
  if (typeof c.conversationCheckpointLastUpdatedAt === 'number' && c.conversationCheckpointLastUpdatedAt > 0) {
    return c.conversationCheckpointLastUpdatedAt;
  }
  return fallback;
}

function collectComposerEditedFiles(c: ComposerRecord): { edited: string[]; createdFiles: string[] } {
  const edited: string[] = [];
  for (const uri of Object.keys(c.originalFileStates ?? {})) {
    const p = fileUriToFsPath(uri);
    if (p) edited.push(p);
  }
  const createdFiles: string[] = [];
  for (const nf of c.newlyCreatedFiles ?? []) {
    const p = nf.uri?.fsPath ?? (nf.uri?.external ? fileUriToFsPath(nf.uri.external) : null) ?? nf.uri?.path ?? null;
    if (p) createdFiles.push(p);
  }
  return { edited, createdFiles };
}

interface RequestSlot {
  userBubble: BubbleRow | null;
  assistantBubbles: BubbleRow[];
}

function partitionBubbles(bubbles: BubbleRow[]): RequestSlot[] {
  const slots: RequestSlot[] = [];
  let cur: RequestSlot | null = null;
  for (const b of bubbles) {
    if (b.type === 1) {
      if (cur) slots.push(cur);
      cur = { userBubble: b, assistantBubbles: [] };
    } else if (cur) {
      cur.assistantBubbles.push(b);
    } else {
      // Assistant bubble with no preceding user turn — surface as a
      // synthetic empty user turn so the data isn't lost.
      cur = { userBubble: null, assistantBubbles: [b] };
    }
  }
  if (cur) slots.push(cur);
  return slots;
}

function deriveRequestId(slot: RequestSlot, composerId: string, slotIndex: number): string {
  if (slot.userBubble?.requestId) return slot.userBubble.requestId;
  if (slot.userBubble?.id) return `${composerId}:${slot.userBubble.id}`;
  return `${composerId}:turn-${slotIndex}`;
}

function composeResponseText(agg: AggregatedAssistant): string {
  if (agg.text) return agg.text;
  if (agg.thinking) return `<thinking>\n${agg.thinking}\n</thinking>`;
  return '';
}

function aggregateRequest(
  slot: RequestSlot,
  composer: ComposerRecord,
  composerEditedFiles: string[],
  composerCreatedFiles: string[],
  slotIndex: number,
  isLastSlot: boolean,
): SessionRequest {
  const agg = newAggregate();
  for (const b of slot.assistantBubbles) applyAssistantBubble(b, agg);

  const userTs = slot.userBubble ? isoToMs(slot.userBubble.createdAtIso) : null;
  const userText = slot.userBubble?.text || '';
  const userFiles = slot.userBubble ? decodeFileSelections(slot.userBubble.fileSelectionsJson) : [];
  const userSkills = slot.userBubble ? decodeCursorRuleNames(slot.userBubble.cursorRulesJson) : [];

  // Cursor records the task list and composer-aggregate edited files at
  // session granularity (not per turn), so we attach both to the final
  // request slot only.
  const todoSnapshot = isLastSlot ? mapComposerTodos(composer.todos) : null;
  const editedFiles = Array.from(isLastSlot
    ? new Set([...agg.editedFiles, ...composerEditedFiles, ...composerCreatedFiles])
    : new Set(agg.editedFiles));

  const modelId = composer.modelConfig?.modelName || '';
  // Cursor's user-visible mode toggle ('agent' | 'edit' | 'ask') — closest
  // analog to the VS Code chat mode for the rule engine.
  const agentMode = composer.unifiedMode || composer.forceMode || 'agent';

  return createRequest({
    requestId: deriveRequestId(slot, composer.composerId, slotIndex),
    timestamp: userTs,
    messageText: userText,
    responseText: composeResponseText(agg),
    agentName: 'Cursor',
    agentMode,
    modelId,
    toolsUsed: agg.toolsUsed,
    editedFiles,
    referencedFiles: Array.from(new Set([...agg.referencedFiles, ...userFiles])),
    skillsUsed: Array.from(new Set(userSkills)),
    totalElapsed: userTs && agg.lastTs ? Math.max(0, agg.lastTs - userTs) : null,
    promptTokens: agg.hasTokens ? agg.promptTokens : null,
    completionTokens: agg.hasTokens ? agg.completionTokens : null,
    reasoningEffort: extractReasoningEffortFromModelId(modelId)
      ?? canonicalizeReasoningEffort(composer.modelConfig?.maxMode ? 'max' : null),
    todoSnapshot,
  });
}

function buildCursorSession(
  composer: ComposerRecord,
  bubbles: BubbleRow[],
  harness: string,
  ws: ResolvedWorkspace,
): Session | null {
  if (bubbles.length === 0 && (composer.fullConversationHeadersOnly?.length ?? 0) === 0) return null;

  const slots = partitionBubbles(bubbles);
  if (slots.length === 0) return null;

  const { edited: composerEditedFiles, createdFiles: composerCreatedFiles } = collectComposerEditedFiles(composer);
  const requests: SessionRequest[] = [];
  for (let i = 0; i < slots.length; i++) {
    requests.push(aggregateRequest(slots[i], composer, composerEditedFiles, composerCreatedFiles, i, i === slots.length - 1));
  }
  if (requests.length === 0) return null;

  const firstTs = requests.find(r => r.timestamp != null)?.timestamp ?? null;
  const lastTs = [...requests].reverse().find(r => r.timestamp != null)?.timestamp ?? null;
  const creation = composerCreatedTs(composer, firstTs);
  const lastMessage = composerLastTs(composer, lastTs);

  return createSession({
    sessionId: composer.composerId,
    workspaceId: ws.workspaceId,
    workspaceName: ws.workspaceName,
    workspaceRootPath: ws.workspaceRootPath || undefined,
    location: 'panel',
    harness,
    creationDate: creation,
    lastMessageDate: lastMessage,
    requests,
    hasDevcontainer: detectDevcontainerFromRequests(requests, ws.workspaceRootPath || undefined),
  });
}

/* ---- Public API ---- */

function buildComposerIdToWsId(workspaceFolders: Map<string, WorkspaceFolderInfo>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [wsId, info] of workspaceFolders) {
    for (const composerId of info.composerIds) {
      if (!map.has(composerId)) map.set(composerId, wsId);
    }
  }
  return map;
}

function rowStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function rowNum(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function bubbleRowFromQuery(row: Record<string, unknown>): BubbleRow {
  return {
    key: rowStr(row.key),
    id: rowStr(row.id),
    type: rowNum(row.type),
    text: rowStr(row.text),
    thinkingText: rowStr(row.thinkingText),
    thinkingDurationMs: rowNum(row.thinkingDurationMs),
    capabilityType: rowNum(row.capabilityType),
    toolName: rowStr(row.toolName),
    toolStatus: rowStr(row.toolStatus),
    toolArgs: rowStr(row.toolArgs),
    createdAtIso: rowStr(row.createdAtIso),
    inputTokens: rowNum(row.inputTokens),
    outputTokens: rowNum(row.outputTokens),
    requestId: rowStr(row.requestId),
    fileSelectionsJson: rowStr(row.fileSelectionsJson, '[]'),
    cursorRulesJson: rowStr(row.cursorRulesJson, '[]'),
  };
}

/** Order bubbles to match `fullConversationHeadersOnly`. Bubbles missing
 *  from the header list (rare, but possible after partial migrations) are
 *  appended in createdAt order at the end so they aren't dropped. */
function orderBubbles(rows: BubbleRow[], headers: ComposerHeader[] | undefined): BubbleRow[] {
  if (!headers || headers.length === 0) {
    return [...rows].sort((a, b) => (isoToMs(a.createdAtIso) ?? 0) - (isoToMs(b.createdAtIso) ?? 0));
  }
  const byId = new Map<string, BubbleRow>();
  for (const r of rows) byId.set(r.id, r);
  const ordered: BubbleRow[] = [];
  const seen = new Set<string>();
  for (const h of headers) {
    const row = byId.get(h.bubbleId);
    if (row) {
      // Pass the header's type/grouping through so we can still classify rows
      // whose bubble payload lost its `type` field on migration.
      if (row.type == null && typeof h.type === 'number') row.type = h.type;
      ordered.push(row);
      seen.add(h.bubbleId);
    }
  }
  const leftovers = rows.filter(r => !seen.has(r.id));
  leftovers.sort((a, b) => (isoToMs(a.createdAtIso) ?? 0) - (isoToMs(b.createdAtIso) ?? 0));
  return [...ordered, ...leftovers];
}

function parseComposerRow(row: Record<string, unknown>): ComposerRecord | null {
  const raw = row.value;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as ComposerRecord;
    if (typeof parsed.composerId !== 'string' || !parsed.composerId) return null;
    return parsed;
  } catch (e) {
    debugCore('parser-cursor', 'unparseable composer row', e);
    return null;
  }
}

function loadComposerRecords(globalDb: string): ComposerRecord[] {
  const rows = sqliteJsonSync<Record<string, unknown>>(
    globalDb,
    "SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
  );
  const records: ComposerRecord[] = [];
  for (const r of rows) {
    const composer = parseComposerRow(r);
    if (composer) records.push(composer);
  }
  return records;
}

async function loadComposerRecordsAsync(globalDb: string): Promise<ComposerRecord[]> {
  const rows = await sqliteJsonAsync<Record<string, unknown>>(
    globalDb,
    "SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
  );
  const records: ComposerRecord[] = [];
  for (const r of rows) {
    const composer = parseComposerRow(r);
    if (composer) records.push(composer);
  }
  return records;
}

function fetchBubblesForComposer(globalDb: string, composerId: string): BubbleRow[] {
  const safeId = escapeForGlob(composerId);
  const sql = `SELECT ${BUBBLE_FIELDS_SQL} FROM cursorDiskKV WHERE key GLOB 'bubbleId:${safeId}:*'`;
  const rows = sqliteJsonSync<Record<string, unknown>>(globalDb, sql);
  return rows.map(bubbleRowFromQuery);
}

async function fetchBubblesForComposerAsync(globalDb: string, composerId: string): Promise<BubbleRow[]> {
  const safeId = escapeForGlob(composerId);
  const sql = `SELECT ${BUBBLE_FIELDS_SQL} FROM cursorDiskKV WHERE key GLOB 'bubbleId:${safeId}:*'`;
  const rows = await sqliteJsonAsync<Record<string, unknown>>(globalDb, sql);
  return rows.map(bubbleRowFromQuery);
}

export interface CursorParseResult {
  sessions: Session[];
  workspaces: Workspace[];
}

export function parseCursorComposerSessions(edition: CursorEdition): CursorParseResult {
  const workspaceFolders = discoverWorkspaceFolders(edition.workspaceStorageRoot);
  const composerIdToWsId = buildComposerIdToWsId(workspaceFolders);
  const composers = loadComposerRecords(edition.globalDb);

  const sessions: Session[] = [];
  const wsMap = new Map<string, Workspace>();
  for (const composer of composers) {
    const rows = fetchBubblesForComposer(edition.globalDb, composer.composerId);
    const ordered = orderBubbles(rows, composer.fullConversationHeadersOnly);
    const ws = resolveComposerWorkspace(composer, workspaceFolders, composerIdToWsId);
    const session = buildCursorSession(composer, ordered, edition.harness, ws);
    if (!session) continue;
    sessions.push(session);
    if (!wsMap.has(session.workspaceId)) {
      wsMap.set(session.workspaceId, {
        id: session.workspaceId,
        name: session.workspaceName,
        path: session.workspaceRootPath || edition.workspaceStorageRoot,
      });
    }
  }
  return { sessions, workspaces: [...wsMap.values()] };
}

export interface CursorParseProgress {
  /** 0-based index of the composer just processed. */
  index: number;
  /** Total composers to process for this edition. */
  total: number;
  /** Human-readable composer title (or composerId when no name). */
  name: string;
}

export async function parseCursorComposerSessionsAsync(
  edition: CursorEdition,
  onProgress?: (p: CursorParseProgress) => void,
): Promise<CursorParseResult> {
  const workspaceFolders = discoverWorkspaceFolders(edition.workspaceStorageRoot);
  const composerIdToWsId = buildComposerIdToWsId(workspaceFolders);
  const composers = await loadComposerRecordsAsync(edition.globalDb);

  const sessions: Session[] = [];
  const wsMap = new Map<string, Workspace>();
  for (let i = 0; i < composers.length; i++) {
    const composer = composers[i];
    const rows = await fetchBubblesForComposerAsync(edition.globalDb, composer.composerId);
    const ordered = orderBubbles(rows, composer.fullConversationHeadersOnly);
    const ws = resolveComposerWorkspace(composer, workspaceFolders, composerIdToWsId);
    const session = buildCursorSession(composer, ordered, edition.harness, ws);
    onProgress?.({ index: i, total: composers.length, name: composer.name || composer.composerId });
    if (!session) continue;
    sessions.push(session);
    if (!wsMap.has(session.workspaceId)) {
      wsMap.set(session.workspaceId, {
        id: session.workspaceId,
        name: session.workspaceName,
        path: session.workspaceRootPath || edition.workspaceStorageRoot,
      });
    }
    // Yield every 5 composers so the event loop stays responsive when the
    // user has many sessions.
    if (i % 5 === 4) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return { sessions, workspaces: [...wsMap.values()] };
}

/** Re-parse a single Composer session with full text, for the on-demand
 *  session detail view (the in-memory copy has its text stripped). Returns
 *  null when the composer or its bubbles can no longer be read. */
export function loadCursorComposerSession(
  globalDb: string,
  workspaceStorageRoot: string,
  composerId: string,
  harness: string,
): Session | null {
  const rows = sqliteJsonSync<Record<string, unknown>>(
    globalDb,
    `SELECT value FROM cursorDiskKV WHERE key = 'composerData:${escapeForSqlString(composerId)}'`,
  );
  const composer = rows.length > 0 ? parseComposerRow(rows[0]) : null;
  if (!composer) return null;

  const workspaceFolders = discoverWorkspaceFolders(workspaceStorageRoot);
  const composerIdToWsId = buildComposerIdToWsId(workspaceFolders);
  const bubbles = fetchBubblesForComposer(globalDb, composerId);
  const ordered = orderBubbles(bubbles, composer.fullConversationHeadersOnly);
  const ws = resolveComposerWorkspace(composer, workspaceFolders, composerIdToWsId);
  return buildCursorSession(composer, ordered, harness, ws);
}
