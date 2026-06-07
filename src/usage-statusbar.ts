/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Status bar request-usage gauge (e.g. `$(pulse) 45/500`) for request-based
 * Cursor plans. Reads live usage via the opt-in fetcher, projects burn rate,
 * colors itself at thresholds, and fires one-time-per-cycle notifications when
 * the user is at risk of running out of requests.
 *
 * Visibility is driven by `cursorEngineeringCoach.usage.statusBar`
 * (auto | always | off). The live network call stays opt-in — when it is off
 * the item becomes a one-click "enable" affordance instead of fetching.
 */

import * as vscode from 'vscode';
import {
  LiveUsage,
  UsageProjection,
  isRequestBased,
  paceSummary,
  projectUsage,
} from './core/billing';
import { BILLING_CONFIG_SECTION, readBillingProfile } from './billing-vscode';
import { fetchLiveUsage, liveUsageEnabled } from './billing-usage';

const USAGE_CONFIG_SECTION = 'cursorEngineeringCoach.usage';
const REFRESH_MS = 10 * 60_000;

type StatusBarMode = 'auto' | 'always' | 'off';

function statusBarMode(): StatusBarMode {
  const v = vscode.workspace.getConfiguration(USAGE_CONFIG_SECTION).get<string>('statusBar');
  return v === 'always' || v === 'off' ? v : 'auto';
}

function notifyEnabled(): boolean {
  return vscode.workspace.getConfiguration(USAGE_CONFIG_SECTION).get<boolean>('notify') !== false;
}

class UsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'cursorEngineeringCoach.openUsage';
    context.subscriptions.push(this.item);
  }

  start(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeWindowState(s => { if (s.focused) void this.refresh(); }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(USAGE_CONFIG_SECTION) || e.affectsConfiguration(BILLING_CONFIG_SECTION)) {
          void this.refresh(true);
        }
      }),
    );
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.context.subscriptions.push({ dispose: () => { if (this.timer) clearInterval(this.timer); } });
    void this.refresh();
  }

  async refresh(force = false): Promise<void> {
    const mode = statusBarMode();
    if (mode === 'off') { this.item.hide(); return; }

    // `auto` targets exactly the people who run out of requests.
    const visible = mode === 'always' || liveUsageEnabled() || isRequestBased(readBillingProfile());
    if (!visible) { this.item.hide(); return; }

    if (!liveUsageEnabled()) {
      this.item.text = '$(pulse) Cursor usage';
      this.item.tooltip = 'Click to enable Cursor request-usage tracking (opt-in call to Cursor).';
      this.item.command = 'cursorEngineeringCoach.enableUsageTracking';
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }

    const usage = await fetchLiveUsage(force);
    if (!usage) {
      this.item.text = '$(pulse) usage —';
      this.item.tooltip = 'Could not fetch Cursor usage. Click to retry.';
      this.item.command = 'cursorEngineeringCoach.refreshUsage';
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }

    const proj = projectUsage(usage);
    this.render(usage, proj);
    if (proj) this.maybeNotify(usage, proj);
  }

  private render(usage: LiveUsage, proj: UsageProjection | null): void {
    const count = usage.requestsLimit && usage.requestsLimit > 0
      ? `${usage.requestsUsed}/${usage.requestsLimit}`
      : `${usage.requestsUsed}`;
    const level = proj?.level ?? 'ok';
    const icon = level === 'critical' ? '$(error)' : level === 'warn' ? '$(warning)' : '$(pulse)';
    this.item.text = `${icon} ${count}`;
    this.item.command = 'cursorEngineeringCoach.openUsage';
    this.item.backgroundColor = level === 'critical'
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : level === 'warn'
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    this.item.tooltip = this.buildTooltip(usage, proj);
    this.item.show();
  }

  private buildTooltip(usage: LiveUsage, proj: UsageProjection | null): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    const limit = usage.requestsLimit && usage.requestsLimit > 0 ? usage.requestsLimit : null;
    md.appendMarkdown(`**Cursor requests** — ${usage.requestsUsed}${limit ? ` / ${limit}` : ''}`);
    if (proj && limit) {
      md.appendMarkdown(` (${proj.pctUsed}%)\n\n`);
      md.appendMarkdown(`$(calendar) ${proj.daysRemaining} day${proj.daysRemaining === 1 ? '' : 's'} left · $(flame) ${proj.perDay}/day\n\n`);
      md.appendMarkdown(`${paceSummary(proj)}`);
    } else {
      md.appendMarkdown(`\n\n${usage.requestsUsed} requests this cycle`);
    }
    md.appendMarkdown(`\n\nClick to open the Usage page.`);
    return md;
  }

  private maybeNotify(usage: LiveUsage, proj: UsageProjection | null): void {
    if (!proj || !notifyEnabled()) return;
    const cycleKey = usage.cycleStart ?? 'unknown';
    if (proj.pctUsed >= 90) {
      this.notifyOnce(
        `usage.notify.90.${cycleKey}`,
        `You've used ${proj.pctUsed}% of your Cursor requests (${usage.requestsUsed}/${usage.requestsLimit}) with ${proj.daysRemaining} day${proj.daysRemaining === 1 ? '' : 's'} left this cycle.`,
      );
    } else if (proj.pace === 'behind' && proj.runOutDaysEarly != null && proj.runOutDaysEarly >= 2) {
      this.notifyOnce(
        `usage.notify.pace.${cycleKey}`,
        `At your current pace you'll run out of Cursor requests ~${proj.runOutDaysEarly} days early (projected ${proj.projectedTotal}/${usage.requestsLimit}). Open the Usage page for ways to economize.`,
      );
    }
  }

  private notifyOnce(key: string, message: string): void {
    if (this.context.globalState.get<boolean>(key)) return;
    void this.context.globalState.update(key, true);
    void vscode.window.showWarningMessage(message, 'Open Usage', 'Dismiss').then(action => {
      if (action === 'Open Usage') void vscode.commands.executeCommand('cursorEngineeringCoach.openUsage');
    });
  }
}

/** Prompt to enable the opt-in live usage fetch (and make the status bar visible). */
async function enableUsageTracking(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(BILLING_CONFIG_SECTION);
  if (cfg.get<boolean>('fetchLiveUsage') === true) {
    void vscode.window.showInformationMessage('Cursor request-usage tracking is already enabled.');
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    'Enable Cursor request-usage tracking? This periodically calls Cursor\'s own usage API using your local token (sent only to Cursor over HTTPS, never stored or logged). Turn it off anytime in Settings.',
    'Enable', 'Cancel',
  );
  if (choice !== 'Enable') return;
  await cfg.update('fetchLiveUsage', true, vscode.ConfigurationTarget.Global);
  const usageCfg = vscode.workspace.getConfiguration(USAGE_CONFIG_SECTION);
  if (usageCfg.get<string>('statusBar') === 'off') {
    await usageCfg.update('statusBar', 'auto', vscode.ConfigurationTarget.Global);
  }
}

/** Create the status bar gauge and register its commands. */
export function registerUsageStatusBar(context: vscode.ExtensionContext): void {
  const bar = new UsageStatusBar(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorEngineeringCoach.enableUsageTracking', async () => {
      await enableUsageTracking();
      void bar.refresh(true);
    }),
    vscode.commands.registerCommand('cursorEngineeringCoach.refreshUsage', () => bar.refresh(true)),
  );
  bar.start();
}
