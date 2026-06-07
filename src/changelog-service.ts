/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Changelog service — fetches Cursor's public changelog feed, caches it, detects
 * new entries, and notifies the user (so everyone stays current, and maintainers
 * know when to re-sync the model-facts manifest).
 *
 * Privacy contract (mirrors the project's local-first stance):
 *   - The background check + notification are gated by
 *     `cursorEngineeringCoach.changelog.notifications` (default on). When off,
 *     no background network call is made.
 *   - The only request is an unauthenticated GET of Cursor's PUBLIC changelog
 *     RSS feed — no token, no usage data, nothing about the user is sent.
 *   - Results are cached under globalStorage; failures fall back to that cache.
 *   - Opening the Changelog page is an explicit fetch (always allowed).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  CHANGELOG_SOURCE,
  ChangelogData,
  ChangelogEntry,
  parseChangelogRss,
  unseenEntries,
} from './core/changelog';

const CONFIG_SECTION = 'cursorEngineeringCoach.changelog';
const FEED_URL = 'https://cursor.com/changelog/rss.xml';
const CACHE_FILE = 'cursor-changelog.cache.json';
const LAST_SEEN_KEY = 'changelog.lastSeenId';
const LAST_CHECK_KEY = 'changelog.lastCheckAt';
const MEM_TTL_MS = 30 * 60_000; // serve repeat page opens from memory for 30m
const CHECK_THROTTLE_MS = 6 * 60 * 60_000; // background new-entry check, every 6h
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ENTRIES = 60;

interface DiskCache {
  fetchedAt: number;
  entries: ChangelogEntry[];
}

let ctx: vscode.ExtensionContext | undefined;
let mem: { at: number; fetchedAt: number; entries: ChangelogEntry[] } | undefined;

function notificationsEnabled(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('notifications') !== false;
}

function cacheFilePath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, CACHE_FILE);
}

function readDiskCache(context: vscode.ExtensionContext): DiskCache | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(cacheFilePath(context), 'utf8'));
    if (raw && typeof raw === 'object' && Array.isArray((raw as DiskCache).entries)) {
      const dc = raw as DiskCache;
      return { fetchedAt: typeof dc.fetchedAt === 'number' ? dc.fetchedAt : 0, entries: dc.entries };
    }
  } catch {
    // No cache yet, or unreadable.
  }
  return undefined;
}

function writeDiskCache(context: vscode.ExtensionContext, data: DiskCache): void {
  try {
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    fs.writeFileSync(cacheFilePath(context), JSON.stringify(data));
  } catch {
    // Best-effort cache; ignore write failures.
  }
}

/** Fetch + parse the public feed. Returns undefined on any failure. */
async function fetchEntries(): Promise<ChangelogEntry[] | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(FEED_URL, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: controller.signal,
    });
    if (!resp.ok) return undefined;
    const entries = parseChangelogRss(await resp.text()).slice(0, MAX_ENTRIES);
    return entries.length > 0 ? entries : undefined;
  } catch {
    // Sanitized: never surface network internals.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve entries: live fetch, then in-memory cache, then disk cache. */
async function loadEntries(force: boolean): Promise<{ entries: ChangelogEntry[]; fetchedAt: number | null; stale: boolean }> {
  if (!force && mem && Date.now() - mem.at < MEM_TTL_MS) {
    return { entries: mem.entries, fetchedAt: mem.fetchedAt, stale: false };
  }

  const fresh = await fetchEntries();
  if (fresh) {
    const now = Date.now();
    mem = { at: now, fetchedAt: now, entries: fresh };
    if (ctx) writeDiskCache(ctx, { fetchedAt: now, entries: fresh });
    return { entries: fresh, fetchedAt: now, stale: false };
  }

  if (mem) return { entries: mem.entries, fetchedAt: mem.fetchedAt, stale: true };
  if (ctx) {
    const disk = readDiskCache(ctx);
    if (disk && disk.entries.length > 0) {
      mem = { at: Date.now(), fetchedAt: disk.fetchedAt, entries: disk.entries };
      return { entries: disk.entries, fetchedAt: disk.fetchedAt, stale: true };
    }
  }
  return { entries: [], fetchedAt: null, stale: true };
}

/** Assemble the Changelog page payload (used by the RPC handler). */
export async function getChangelog(force = false): Promise<ChangelogData> {
  const { entries, fetchedAt, stale } = await loadEntries(force);
  const lastSeenId = ctx?.globalState.get<string>(LAST_SEEN_KEY) ?? null;
  return {
    entries,
    fetchedAt,
    source: CHANGELOG_SOURCE,
    stale,
    lastSeenId,
    unseenCount: unseenEntries(entries, lastSeenId).length,
  };
}

/** Mark the changelog as read up to `id` (called when the page is opened). */
export function markChangelogSeen(id: string | undefined): void {
  if (!ctx || !id) return;
  void ctx.globalState.update(LAST_SEEN_KEY, id);
}

function notifyNew(fresh: ChangelogEntry[]): void {
  const latest = fresh[0];
  const n = fresh.length;
  const message = n === 1
    ? `Cursor shipped a new update: "${latest.title}".`
    : `Cursor shipped ${n} new updates — latest: "${latest.title}".`;
  void vscode.window.showInformationMessage(message, 'View Changelog', 'Dismiss').then(action => {
    if (action === 'View Changelog') void vscode.commands.executeCommand('cursorEngineeringCoach.openChangelog');
  });
}

/** Throttled background check: notify when Cursor publishes new entries. */
async function checkForNew(context: vscode.ExtensionContext): Promise<void> {
  if (!notificationsEnabled()) return;
  const last = context.globalState.get<number>(LAST_CHECK_KEY) ?? 0;
  const now = Date.now();
  if (now - last < CHECK_THROTTLE_MS) return;
  // Claim the slot up-front so a failure also waits out the throttle window.
  await context.globalState.update(LAST_CHECK_KEY, now);

  const entries = await fetchEntries();
  if (!entries) return;
  mem = { at: now, fetchedAt: now, entries };
  writeDiskCache(context, { fetchedAt: now, entries });

  const lastSeenId = context.globalState.get<string>(LAST_SEEN_KEY) ?? null;
  if (!lastSeenId) {
    // First run ever: baseline silently so we don't announce the whole backlog.
    await context.globalState.update(LAST_SEEN_KEY, entries[0].id);
    return;
  }
  const fresh = unseenEntries(entries, lastSeenId);
  if (fresh.length > 0) notifyNew(fresh);
}

/**
 * Wire up the changelog: remember the context (so the RPC handler can fetch and
 * mark-seen) and kick off a throttled, opt-out background check that notifies on
 * new entries. The open command itself lives in extension.ts (mirrors openUsage).
 */
export function registerChangelog(context: vscode.ExtensionContext): void {
  ctx = context;
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(state => { if (state.focused) void checkForNew(context); }),
  );
  void checkForNew(context);
}
