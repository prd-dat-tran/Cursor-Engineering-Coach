/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { parseChangelogRss, unseenEntries, type ChangelogEntry } from './changelog';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Cursor Changelog</title>
    <link>https://cursor.com/changelog</link>
    <item>
      <title>Design Mode &amp; Voice</title>
      <link>https://cursor.com/changelog/design-mode-improvements</link>
      <guid isPermaLink="true">https://cursor.com/changelog/design-mode-improvements</guid>
      <pubDate>Fri, 05 Jun 2026 00:00:00 GMT</pubDate>
      <description>Click, draw, or describe changes by voice.</description>
      <content:encoded><![CDATA[<p>Intro paragraph.</p>
<h2>Multi-select elements</h2>
<p>Body.</p>
<h2>Voice input</h2>
<p>More body.</p>]]></content:encoded>
    </item>
    <item>
      <title>Auto-review Run Mode</title>
      <link>https://cursor.com/changelog/auto-review</link>
      <guid isPermaLink="true">https://cursor.com/changelog/auto-review</guid>
      <pubDate>Fri, 29 May 2026 00:00:00 GMT</pubDate>
      <description>A new run mode with fewer approval prompts.</description>
      <content:encoded><![CDATA[<p>Just a couple of paragraphs, no headings.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

describe('parseChangelogRss', () => {
  const entries = parseChangelogRss(FEED);

  it('parses every item in feed order (newest first)', () => {
    expect(entries.length).toBe(2);
    expect(entries[0].title).toBe('Design Mode & Voice');
    expect(entries[1].title).toBe('Auto-review Run Mode');
  });

  it('uses the permalink as a stable id and link', () => {
    expect(entries[0].id).toBe('https://cursor.com/changelog/design-mode-improvements');
    expect(entries[0].link).toBe('https://cursor.com/changelog/design-mode-improvements');
  });

  it('decodes entities and keeps a clean summary', () => {
    expect(entries[0].summary).toBe('Click, draw, or describe changes by voice.');
    expect(entries[0].title).not.toContain('&amp;');
  });

  it('parses pubDate to an ISO string', () => {
    expect(entries[0].date).toBe('2026-06-05T00:00:00.000Z');
    expect(Number.isNaN(Date.parse(entries[0].date))).toBe(false);
  });

  it('extracts h2 section headings as highlights', () => {
    expect(entries[0].highlights).toEqual(['Multi-select elements', 'Voice input']);
  });

  it('tolerates entries with no headings', () => {
    expect(entries[1].highlights).toEqual([]);
  });

  it('returns nothing for an empty or malformed feed', () => {
    expect(parseChangelogRss('')).toEqual([]);
    expect(parseChangelogRss('<rss><channel></channel></rss>')).toEqual([]);
  });
});

describe('unseenEntries', () => {
  const entries: ChangelogEntry[] = [
    { id: 'c', title: 'C', link: 'c', date: '', summary: '', highlights: [] },
    { id: 'b', title: 'B', link: 'b', date: '', summary: '', highlights: [] },
    { id: 'a', title: 'A', link: 'a', date: '', summary: '', highlights: [] },
  ];

  it('treats everything as unseen when nothing has been seen', () => {
    expect(unseenEntries(entries, null).map(e => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns only entries newer than the last-seen id', () => {
    expect(unseenEntries(entries, 'b').map(e => e.id)).toEqual(['c']);
  });

  it('returns none when the newest entry was already seen', () => {
    expect(unseenEntries(entries, 'c')).toEqual([]);
  });

  it('treats all as unseen when the last-seen id scrolled off the feed', () => {
    expect(unseenEntries(entries, 'zzz').map(e => e.id)).toEqual(['c', 'b', 'a']);
  });
});
