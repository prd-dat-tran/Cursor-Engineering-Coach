/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Changelog page — Cursor's official changelog, pulled from its public feed and
 * summarized for the team. New entries are flagged; a maintainer note points to
 * the (manual) facts re-sync when a release changes models or pricing. */

import type { DateFilter } from '../core/types';
import type { ChangelogData, ChangelogEntry } from '../core/changelog';
import { rpc, COLORS } from './shared';
import { html, render, ComponentChildren } from './render';

export async function renderChangelog(content: HTMLElement, _filter: DateFilter): Promise<void> {
  await load(content, false);
}

async function load(content: HTMLElement, force: boolean): Promise<void> {
  if (force) renderLoading(content, 'Refreshing changelog\u2026');
  let data: ChangelogData;
  try {
    data = await rpc<ChangelogData>('getChangelog', force ? { force: true } : undefined);
  } catch (e) {
    render(html`<div class="error-banner">Failed to load changelog: ${String(e)}</div>`, content);
    return;
  }
  render(markup(content, data), content);
}

function renderLoading(content: HTMLElement, message: string): void {
  render(html`<div class="loading-screen"><div class="loading-spinner"></div><div class="loading-text">${message}</div></div>`, content);
}

function openExternal(url: string): (ev: Event) => void {
  return (ev: Event) => {
    ev.preventDefault();
    void rpc('openExternal', { url }).catch(() => { /* ignore */ });
  };
}

function markup(content: HTMLElement, d: ChangelogData): ComponentChildren {
  return html`
    <div class="changelog-page">
      <div class="page-header">
        <h1>Cursor Changelog</h1>
        <p class="page-subtitle">What's new in Cursor — pulled from the official changelog and summarized for your team.</p>
        <div class="changelog-meta">
          <span class="changelog-freshness">${freshness(d)}</span>
          <a class="changelog-source" href="#" onClick=${openExternal(d.source)}>${d.source.replace(/^https?:\/\//, '')} \u2197</a>
          <button class="btn-secondary changelog-refresh" onClick=${() => void load(content, true)}>Refresh</button>
        </div>
      </div>

      ${MaintainerNote()}

      ${d.entries.length === 0
        ? html`<div class="card"><p class="muted">Couldn't load changelog entries right now${d.stale ? ' (offline, and nothing cached yet)' : ''}. Try <strong>Refresh</strong>, or read them on <a href="#" onClick=${openExternal(d.source)}>${d.source.replace(/^https?:\/\//, '')}</a>.</p></div>`
        : html`<div class="changelog-list">${d.entries.map((e, i) => EntryCard(e, i < d.unseenCount))}</div>`}
    </div>`;
}

function freshness(d: ChangelogData): string {
  if (d.entries.length === 0) return 'No entries loaded';
  if (d.stale) return 'Showing cached entries (offline)';
  if (!d.fetchedAt) return `${d.entries.length} entries`;
  return `Updated ${relativeTime(d.fetchedAt)} \u00b7 ${d.entries.length} entries`;
}

function MaintainerNote(): ComponentChildren {
  return html`
    <div class="changelog-maintainer">
      <span class="changelog-maintainer-tag">Maintainer</span>
      <div class="changelog-maintainer-body">
        When a release changes models, pricing, or plans, re-sync the model facts so the
        coach stays accurate: run <code>npm run facts:refresh</code> (or edit
        <code>src/core/data/cursor-facts.json</code>) and open a PR. Fact sync is intentionally manual.
      </div>
    </div>`;
}

function EntryCard(e: ChangelogEntry, isNew: boolean): ComponentChildren {
  return html`
    <article class=${'changelog-entry' + (isNew ? ' is-new' : '')}>
      <div class="changelog-entry-side">
        <time class="changelog-date">${formatDate(e.date)}</time>
        ${isNew ? html`<span class="changelog-new" style=${'color:' + COLORS.green + ';border-color:' + COLORS.green}>New</span>` : ''}
      </div>
      <div class="changelog-entry-main">
        <h3 class="changelog-title"><a href="#" onClick=${openExternal(e.link)}>${e.title}</a></h3>
        ${e.summary ? html`<p class="changelog-summary">${e.summary}</p>` : ''}
        ${e.highlights.length > 0
          ? html`<ul class="changelog-highlights">${e.highlights.map(h => html`<li>${h}</li>`)}</ul>`
          : ''}
        <a class="changelog-readmore" href="#" onClick=${openExternal(e.link)}>Read on cursor.com \u2197</a>
      </div>
    </article>`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}
