/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Usage page — request-volume tracking, burn-rate forecast, and waste analysis.
 * Most relevant for request-based plans where every request is a flat charge. */

import { DateFilter, UsageBreakdown, UsageModelSlice, UsageNamedSlice } from '../core/types';
import {
  BillingProfile,
  DEFAULT_BILLING_PROFILE,
  LiveUsage,
  UsageProjection,
  isRequestBased,
  paceSummary,
  projectUsage,
} from '../core/billing';
import { rpc, createChart, COLORS, formatNum, destroyChartById } from './shared';
import { html, render, ComponentChildren } from './render';
import { mdInline } from './markdown';

const LEVEL_COLOR: Record<string, string> = { ok: COLORS.green, warn: COLORS.yellow, critical: COLORS.red };
const TIER_LABEL: Record<string, string> = { frontier: 'Frontier', light: 'Lightweight', auto: 'Auto' };
const TIER_COLOR: Record<string, string> = { frontier: COLORS.green, light: COLORS.yellow, auto: COLORS.purple };

interface LiveUsageResult { enabled: boolean; usage: LiveUsage | null }

export async function renderUsage(content: HTMLElement, filter: DateFilter): Promise<void> {
  let breakdown: UsageBreakdown;
  let billing: BillingProfile;
  let liveResult: LiveUsageResult;
  try {
    const [b, prof, lu] = await Promise.all([
      rpc<UsageBreakdown>('getUsageBreakdown', filter as Record<string, unknown>),
      rpc<BillingProfile>('getBillingProfile').catch(() => DEFAULT_BILLING_PROFILE),
      rpc<LiveUsageResult>('getLiveUsage').catch(() => ({ enabled: false, usage: null })),
    ]);
    breakdown = b;
    billing = prof;
    liveResult = lu;
  } catch (e) {
    render(html`<div class="error-banner">Failed to load usage data: ${String(e)}</div>`, content);
    return;
  }

  const proj = liveResult.usage ? projectUsage(liveResult.usage) : null;
  render(markup(breakdown, billing, liveResult, proj), content);
  renderDailyChart(breakdown);
}

function markup(b: UsageBreakdown, billing: BillingProfile, live: LiveUsageResult, proj: UsageProjection | null): ComponentChildren {
  return html`
    <div class="usage-page">
      <div class="page-header">
        <h1>Request Usage</h1>
        <p class="page-subtitle">
          ${isRequestBased(billing)
            ? 'On request-based billing every request costs the same — economize on the number of requests, not the model.'
            : 'Track how many requests you make and where they go.'}
        </p>
      </div>
      ${CycleHero(live, proj)}
      ${WasteCards(b)}
      <div class="usage-grid">
        <div class="card">
          <h3>Requests per day</h3>
          <div class="chart-wrap"><canvas id="usageDailyChart"></canvas></div>
        </div>
        <div class="card">
          <h3>By model</h3>
          ${ModelTable(b.byModel)}
        </div>
      </div>
      <div class="usage-grid">
        <div class="card">
          <h3>By workspace</h3>
          ${NamedTable(b.byWorkspace)}
        </div>
        <div class="card">
          <h3>How to make requests go further</h3>
          ${Advice(b, billing, proj)}
        </div>
      </div>
    </div>`;
}

function CycleHero(live: LiveUsageResult, proj: UsageProjection | null): ComponentChildren {
  if (!live.enabled) {
    return html`
      <div class="usage-hero usage-hero-cta">
        <div>
          <strong>See your live request quota</strong>
          <p>Show "used / limit" for the current cycle and get run-out forecasts. Makes an opt-in call to Cursor's own usage API (token used transiently, never stored).</p>
        </div>
        <button class="btn-primary" onClick=${enableLiveUsage}>Enable usage tracking</button>
      </div>`;
  }
  if (!live.usage) {
    return html`
      <div class="usage-hero">
        <div>Couldn't fetch live usage right now.</div>
        <button class="btn-secondary" onClick=${() => rpc('getLiveUsage').then(() => location.reload())}>Retry</button>
      </div>`;
  }
  const u = live.usage;
  const limit = u.requestsLimit && u.requestsLimit > 0 ? u.requestsLimit : null;
  const pct = proj?.pctUsed ?? 0;
  const color = LEVEL_COLOR[proj?.level ?? 'ok'];
  const cycleStart = u.cycleStart ? new Date(u.cycleStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return html`
    <div class="usage-hero">
      <div class="usage-hero-main">
        <div class="usage-hero-count" style=${'color:' + color}>${u.requestsUsed}${limit ? html`<span class="usage-hero-limit"> / ${limit}</span>` : ''}</div>
        <div class="usage-hero-label">requests this cycle${cycleStart ? ' · since ' + cycleStart : ''}</div>
        ${limit ? html`<div class="usage-bar"><span class="usage-bar-fill" style=${'width:' + Math.min(100, pct) + '%;background:' + color + ';'}></span></div>` : ''}
      </div>
      ${proj ? html`
        <div class="usage-hero-stats">
          <div class="usage-stat"><span class="usage-stat-val">${proj.daysRemaining}</span><span class="usage-stat-key">days left</span></div>
          <div class="usage-stat"><span class="usage-stat-val">${proj.perDay}</span><span class="usage-stat-key">per day</span></div>
          <div class="usage-stat"><span class="usage-stat-val">${proj.projectedTotal}</span><span class="usage-stat-key">projected</span></div>
        </div>` : ''}
      ${proj ? html`<div class="usage-pace" style=${'border-color:' + color}>${paceSummary(proj)}</div>` : ''}
    </div>`;
}

function WasteCards(b: UsageBreakdown): ComponentChildren {
  const e = b.economics;
  const cards = [
    { label: 'Cancelled requests', value: e.cancelledRequests, pct: e.cancelledPct, hint: 'Stopped mid-flight — still counts as spend.' },
    { label: 'Lightweight / auto model', value: e.lightOrAutoRequests, pct: e.lightOrAutoPct, hint: 'On flat-rate billing a weaker model costs the same as the best one.' },
    { label: 'Frontier model', value: e.frontierRequests, pct: e.frontierPct, hint: 'Requests using a top-tier model — what you should default to.' },
  ];
  return html`
    <div class="usage-waste">
      ${cards.map(c => html`
        <div class="card usage-waste-card">
          <div class="usage-waste-val">${formatNum(c.value)}</div>
          <div class="usage-waste-label">${c.label} <span class="usage-waste-pct">${c.pct}%</span></div>
          <div class="usage-waste-hint">${c.hint}</div>
        </div>`)}
    </div>`;
}

function ModelTable(rows: UsageModelSlice[]): ComponentChildren {
  if (rows.length === 0) return html`<p class="muted">No model data in range.</p>`;
  const max = Math.max(...rows.map(r => r.requests), 1);
  return html`
    <table class="data-table compact">
      <thead><tr><th>Model</th><th>Tier</th><th>Requests</th></tr></thead>
      <tbody>
        ${rows.slice(0, 12).map(r => html`
          <tr>
            <td>${r.model}</td>
            <td><span class="usage-tier" style=${'color:' + (TIER_COLOR[r.tier] || COLORS.blue)}>${TIER_LABEL[r.tier] || r.tier}</span></td>
            <td>
              <div class="usage-row-bar"><span style=${'width:' + Math.round((r.requests / max) * 100) + '%;background:' + (TIER_COLOR[r.tier] || COLORS.blue) + ';'}></span></div>
              <span class="usage-row-bar-val">${formatNum(r.requests)}</span>
            </td>
          </tr>`)}
      </tbody>
    </table>`;
}

function NamedTable(rows: UsageNamedSlice[]): ComponentChildren {
  if (rows.length === 0) return html`<p class="muted">No workspace data in range.</p>`;
  const max = Math.max(...rows.map(r => r.requests), 1);
  return html`
    <table class="data-table compact">
      <thead><tr><th>Workspace</th><th>Requests</th></tr></thead>
      <tbody>
        ${rows.map(r => html`
          <tr>
            <td>${r.name}</td>
            <td>
              <div class="usage-row-bar"><span style=${'width:' + Math.round((r.requests / max) * 100) + '%;background:' + COLORS.blue + ';'}></span></div>
              <span class="usage-row-bar-val">${formatNum(r.requests)}</span>
            </td>
          </tr>`)}
      </tbody>
    </table>`;
}

function Advice(b: UsageBreakdown, billing: BillingProfile, proj: UsageProjection | null): ComponentChildren {
  const e = b.economics;
  const tips: string[] = [];
  if (proj && (proj.pace === 'behind' || proj.pace === 'over')) {
    tips.push(`You're on pace to ${proj.pace === 'over' ? 'have already run out' : `run out ~${proj.runOutDaysEarly} days early`}. Tighten the items below to extend your cycle.`);
  }
  if (e.cancelledRequests > 0) {
    tips.push(`Cut cancellations (${e.cancelledRequests}, ${e.cancelledPct}%): let runs finish, or write a clearer prompt before sending so you don't stop and re-ask.`);
  }
  if (isRequestBased(billing) && e.lightOrAutoRequests > 0) {
    tips.push(`You sent ${e.lightOrAutoRequests} requests (${e.lightOrAutoPct}%) to lightweight/auto models. On flat-rate billing that buys no savings — default to the most capable model.`);
  } else if (!isRequestBased(billing) && e.frontierPct > 70) {
    tips.push('Most requests use a frontier model. On usage-based billing, route routine edits to lighter/Auto models to save tokens.');
  }
  tips.push('Land more per request: use Plan mode for big features, attach context with `@file`, and batch related questions into one prompt instead of many small ones.');
  tips.push('Avoid one-shot lookups as separate agent requests — ask several related things together, or use inline edits for trivial changes.');
  return html`<ul class="usage-advice">${tips.map(t => html`<li>${mdInline(t)}</li>`)}</ul>`;
}

function renderDailyChart(b: UsageBreakdown): void {
  if (b.byDay.length === 0) return;
  destroyChartById('usageDailyChart');
  createChart('usageDailyChart', 'bar', {
    labels: b.byDay.map(d => d.date.slice(5)),
    datasets: [{ label: 'Requests', data: b.byDay.map(d => d.requests), backgroundColor: COLORS.blue }],
  }, {
    plugins: { legend: { display: false } },
    scales: { x: { ticks: { maxTicksLimit: 15 } }, y: { beginAtZero: true } },
  });
}

function enableLiveUsage(): void {
  void rpc('enableUsageTracking').then(() => {
    // Settings change triggers a panel reload; nothing else to do here.
  });
}
