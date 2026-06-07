/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cursor changelog — types and a dependency-free parser for Cursor's public
 * changelog RSS feed (`https://cursor.com/changelog/rss.xml`).
 *
 * The feed is the stable, machine-readable source (each `<item>` has a title,
 * permalink, pubDate, a one-paragraph description, and the full HTML body in
 * `content:encoded`). We summarize each release for the user: title, date, a
 * short blurb, and the section headings as quick "what's in it" highlights.
 *
 * This module is intentionally dependency-free (no `vscode`, no XML library) so
 * it is trivially unit-testable and safe to import from the webview if needed.
 */

/** Canonical, human-facing changelog URL (for attribution + "read more" links). */
export const CHANGELOG_SOURCE = 'https://cursor.com/changelog';

export interface ChangelogEntry {
  /** Stable id — the entry's permalink (RSS guid/link). */
  id: string;
  title: string;
  /** Permalink on cursor.com. */
  link: string;
  /** ISO-8601 publish date (empty when the feed date was unparseable). */
  date: string;
  /** Short plain-text summary (from the RSS `<description>`). */
  summary: string;
  /** Section headings from the body — a quick scan of what shipped. */
  highlights: string[];
}

/** RPC payload for the Changelog page (assembled by the service). */
export interface ChangelogData {
  entries: ChangelogEntry[];
  /** Epoch ms when the entries were fetched, or null if unknown/empty. */
  fetchedAt: number | null;
  /** Canonical source URL for attribution. */
  source: string;
  /** True when served from cache because the live fetch failed. */
  stale: boolean;
  /** Id of the newest entry the user has already seen (drives "new" badges). */
  lastSeenId: string | null;
  /** Number of entries newer than `lastSeenId`. */
  unseenCount: number;
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unwrapCdata(s: string): string {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
  return m ? m[1] : s;
}

/** Inner text of the first `<tag>…</tag>` in `block` (CDATA unwrapped). */
function tagInner(block: string, tag: string): string {
  const re = new RegExp(`<${escapeTag(tag)}[^>]*>([\\s\\S]*?)</${escapeTag(tag)}>`, 'i');
  const m = re.exec(block);
  return m ? unwrapCdata(m[1]) : '';
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Decode entities, strip any markup, and collapse whitespace. */
function clean(s: string): string {
  return decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim();
}

function toIso(rfc822: string): string {
  const t = Date.parse(rfc822.trim());
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/** Pull the `<h2>` section headings from a release body as highlights. */
function extractHighlights(body: string, max = 6): string[] {
  const out: string[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    // Cursor's headings sometimes render with a leading "#" anchor marker.
    const text = clean(m[1]).replace(/^#+\s*/, '').trim();
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Parse a Cursor changelog RSS feed into entries (newest first, as the feed is
 * ordered). Resilient to missing fields — an item without a title or id is
 * skipped rather than throwing.
 */
export function parseChangelogRss(xml: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = clean(tagInner(block, 'title'));
    const link = clean(tagInner(block, 'link'));
    const guid = clean(tagInner(block, 'guid'));
    const id = guid || link;
    if (!title || !id) continue;
    entries.push({
      id,
      title,
      link: link || id,
      date: toIso(tagInner(block, 'pubDate')),
      summary: clean(tagInner(block, 'description')),
      highlights: extractHighlights(tagInner(block, 'content:encoded')),
    });
  }
  return entries;
}

/**
 * Entries newer than `lastSeenId`. The feed is newest-first, so these are the
 * items before the last-seen one. When `lastSeenId` is null or no longer in the
 * feed, every entry is considered unseen.
 */
export function unseenEntries(entries: ChangelogEntry[], lastSeenId: string | null): ChangelogEntry[] {
  if (!lastSeenId) return entries.slice();
  const idx = entries.findIndex(e => e.id === lastSeenId);
  return idx === -1 ? entries.slice() : entries.slice(0, idx);
}
