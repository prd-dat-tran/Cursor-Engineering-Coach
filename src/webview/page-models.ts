/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Models page — model advisor. Collects the models you actually use, scores
 * their fit, and recommends the best model per task balancing effectiveness
 * and billing (request-based vs usage-based). */

import { DateFilter, ModelInsightsData, ModelStat, ModelCatalogItem, ModelRecRow } from '../core/types';
import { rpc, COLORS, formatNum } from './shared';
import { html, render, ComponentChildren } from './render';

const CLASS_COLOR: Record<string, string> = {
  frontier: COLORS.purple,
  standard: COLORS.green,
  light: COLORS.yellow,
  free: COLORS.blue,
  auto: COLORS.blue,
  unknown: COLORS.muted,
};
const CLASS_LABEL: Record<string, string> = {
  frontier: 'Frontier',
  standard: 'Standard',
  light: 'Light',
  free: 'Free',
  auto: 'Auto',
  unknown: 'Unknown',
};
const TONE_COLOR: Record<string, string> = { good: COLORS.green, warn: COLORS.yellow, info: COLORS.blue };

export async function renderModels(content: HTMLElement, filter: DateFilter): Promise<void> {
  let data: ModelInsightsData;
  try {
    data = await rpc<ModelInsightsData>('getModelInsights', filter as Record<string, unknown>);
  } catch (e) {
    render(html`<div class="error-banner">Failed to load model insights: ${String(e)}</div>`, content);
    return;
  }
  render(markup(data), content);
}

function markup(d: ModelInsightsData): ComponentChildren {
  return html`
    <div class="models-page">
      <div class="page-header">
        <h1>Model Advisor</h1>
        <p class="page-subtitle">Pick the best model for each task — balancing capability and how your plan bills you.</p>
        ${FactsBadge(d)}
      </div>
      ${Headline(d)}
      <div class="models-grid">
        <div class="card">
          <h3>Best model by task</h3>
          ${RecTable(d.recommendations)}
        </div>
        <div class="card">
          <h3>How your models stack up</h3>
          ${Mix(d)}
        </div>
      </div>
      <div class="card">
        <h3>Your models <span class="muted-inline">(${d.distinctModels} used · ${formatNum(d.withModel)} requests)</span></h3>
        ${ModelTable(d.models)}
      </div>
      <div class="card">
        <h3>Model reference</h3>
        <p class="muted">Notable models available in Cursor. The cost column is request-equivalents: 0 is included/free, 1× is a standard premium request, and higher multiples spend proportionally more.</p>
        ${Catalog(d.catalog)}
      </div>
    </div>`;
}

function FactsBadge(d: ModelInsightsData): ComponentChildren {
  const meta = d.factsMeta;
  if (!meta) return '';
  const when = new Date(meta.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const tip = `Model facts from ${meta.source} (${meta.modelCount} models), bundled with this build. ` +
    'Maintainers refresh these from Cursor\'s docs; the Changelog page flags when an update is due.';
  return html`<div class="muted" style="font-size:11px;margin-top:2px" title=${tip}>Model facts as of ${when}</div>`;
}

function Headline(d: ModelInsightsData): ComponentChildren {
  const color = TONE_COLOR[d.headline.tone] || COLORS.blue;
  return html`
    <div class="models-hero" style=${'border-left-color:' + color}>
      <div class="models-hero-main">
        <h2>${d.headline.title}</h2>
        <p>${d.headline.body}</p>
      </div>
      ${d.topPick ? html`
        <div class="models-pick">
          <div class="models-pick-label">Suggested default</div>
          <div class="models-pick-name" style=${'color:' + color}>${d.topPick.label}</div>
          <div class="models-pick-why">${d.topPick.why}</div>
        </div>` : ''}
    </div>`;
}

function RecTable(rows: ModelRecRow[]): ComponentChildren {
  return html`
    <table class="data-table compact models-rec">
      <thead><tr><th>Task</th><th>Reach for</th></tr></thead>
      <tbody>
        ${rows.map(r => html`
          <tr>
            <td>${r.task}</td>
            <td><strong>${r.recommended}</strong><div class="models-rec-note">${r.note}</div></td>
          </tr>`)}
      </tbody>
    </table>`;
}

function Mix(d: ModelInsightsData): ComponentChildren {
  if (d.withModel === 0) return html`<p class="muted">No model data in range.</p>`;
  const segs = [
    { key: 'frontier', label: 'Frontier / standard', share: d.frontierShare, color: COLORS.green },
    { key: 'light', label: 'Light / free', share: d.lightShare, color: COLORS.yellow },
    { key: 'auto', label: 'Auto', share: d.autoShare, color: COLORS.purple },
  ].filter(s => s.share > 0);
  return html`
    <div class="models-mix">
      <div class="models-mix-bar">
        ${segs.map(s => html`<span style=${'width:' + Math.round(s.share * 100) + '%;background:' + s.color + ';'} title=${s.label}></span>`)}
      </div>
      <ul class="models-mix-legend">
        ${segs.map(s => html`<li><span class="dot" style=${'background:' + s.color}></span>${s.label} <strong>${Math.round(s.share * 100)}%</strong></li>`)}
      </ul>
      ${d.cancelledShare > 0 ? html`<p class="models-mix-cancel">${Math.round(d.cancelledShare * 100)}% of all requests were cancelled — wasted spend on any plan.</p>` : ''}
    </div>`;
}

function ModelTable(rows: ModelStat[]): ComponentChildren {
  if (rows.length === 0) {
    return html`<p class="muted">No model-bearing requests in this range yet. Once you chat with the agent, your model mix and fit scores show up here.</p>`;
  }
  const max = Math.max(...rows.map(r => r.requests), 1);
  return html`
    <table class="data-table compact models-table">
      <thead>
        <tr>
          <th>Model</th><th>Class</th><th>Cost</th><th>Requests</th><th>Avg LoC</th><th>Cancel</th><th>Fit</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => ModelRow(r, max))}
      </tbody>
    </table>`;
}

function ModelRow(r: ModelStat, max: number): ComponentChildren {
  const cColor = CLASS_COLOR[r.klass] || COLORS.blue;
  const vColor = TONE_COLOR[r.verdict.tone] || COLORS.blue;
  return html`
    <tr>
      <td>
        <span class="models-name">${r.label}</span><span class="models-family">${r.family}</span>
        ${r.known === false ? html`<span class="models-chip" style=${'color:' + COLORS.muted + ';border-color:' + COLORS.muted} title="Not in the model facts yet — using an inferred cost tier. Refresh model facts to update.">facts pending</span>` : ''}
      </td>
      <td><span class="models-chip" style=${'color:' + cColor + ';border-color:' + cColor}>${CLASS_LABEL[r.klass] || r.klass}</span></td>
      <td>${costLabel(r.multiplier)}</td>
      <td>
        <div class="models-bar"><span style=${'width:' + Math.round((r.requests / max) * 100) + '%;background:' + cColor + ';'}></span></div>
        <span class="models-bar-val">${formatNum(r.requests)} · ${Math.round(r.share * 100)}%</span>
      </td>
      <td>${r.avgAiLoc}</td>
      <td>${Math.round(r.cancelRate * 100)}%</td>
      <td><span class="models-verdict" style=${'color:' + vColor} title=${r.verdict.detail}>${r.verdict.label}</span></td>
    </tr>`;
}

function Catalog(items: ModelCatalogItem[]): ComponentChildren {
  return html`
    <div class="models-catalog">
      ${items.map(c => {
        const color = CLASS_COLOR[c.klass] || COLORS.blue;
        return html`
          <div class=${'models-cat-card' + (c.used ? ' used' : '')}>
            <div class="models-cat-head">
              <span class="models-cat-name">${c.label}</span>
              ${c.used ? html`<span class="models-cat-used">used</span>` : ''}
            </div>
            <div class="models-cat-meta">
              <span class="models-chip" style=${'color:' + color + ';border-color:' + color}>${CLASS_LABEL[c.klass] || c.klass}</span>
              <span class="models-cat-cost">${costLabel(c.multiplier)}</span>
            </div>
            <div class="models-cat-best">${c.bestFor}</div>
          </div>`;
      })}
    </div>`;
}

function costLabel(mult: number): string {
  if (mult === 0) return 'Free';
  if (mult === 1) return '1×';
  if (mult < 1) return mult + '×';
  return mult + '×';
}
