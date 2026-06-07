/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Webview panel manager -- creates and manages the dashboard webview shell */

import * as vscode from 'vscode';
import { Analyzer } from '../core/analyzer';
import { BILLING_CONFIG_SECTION, readBillingProfile } from '../billing-vscode';
import { saveSidebarStats } from '../core/cache';
import { clearCache, findLogsDirs, parseAllLogsViaWorker, ParseResult } from '../core/parser';
import { findCursorEditions } from '../core/parser-cursor';
import { runtimeDebug } from '../core/runtime-debug';
import { WebviewMessage } from '../core/types';
import { panelCache } from './panel-cache';
import { clearCatalogCache } from './panel-catalog';
import { getDashboardHtml, getErrorHtml } from './panel-html';
import { getRpcHandler } from './panel-rpc';
import { PanelRequestService } from './panel-request-service';
import { DashboardSidebarProvider } from './panel-sidebar';
import { isRequestMessage, postResponse, errorResult } from './panel-shared';

export { DashboardSidebarProvider } from './panel-sidebar';

export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private static readonly viewType = 'cursorEngineeringCoach';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly requestService: PanelRequestService;
  private readonly globalState: vscode.Memento;
  private readonly disposables: vscode.Disposable[] = [];

  private analyzer: Analyzer | undefined;
  private parseResult: ParseResult | undefined;
  private pendingMessages: Extract<WebviewMessage, { type: 'request' }>[] = [];
  private dataReady = false;
  private disposed = false;
  private loading = false;
  private loadCompletedAt = 0;
  private initialNavPage: string | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.globalState = context.globalState;
    this.requestService = new PanelRequestService(
      this.panel.webview,
      () => this.analyzer,
      () => this.parseResult,
    );

    runtimeDebug('panel', 'constructor');
    this.panel.webview.html = getDashboardHtml(this.panel.webview, this.extensionUri);
    this.panel.onDidChangeViewState((e) => {
      runtimeDebug('panel', 'view-state', `visible=${e.webviewPanel.visible} active=${e.webviewPanel.active}`);
    }, null, this.disposables);
    this.panel.onDidDispose(() => {
      runtimeDebug('panel', 'disposed');
      this.dispose();
    }, null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg: unknown) => this.handleMessage(msg), null, this.disposables);

    // Re-tune coaching when the user changes their billing plan settings.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(BILLING_CONFIG_SECTION)) {
        runtimeDebug('panel', 'billing-config-changed');
        this.reload(true);
      }
    }, null, this.disposables);

    void this.loadData();
  }

  public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel.instance) {
      runtimeDebug('panel', 'reveal-existing');
      DashboardPanel.instance.panel.reveal(column);
      return;
    }

    runtimeDebug('panel', 'create-new');

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Cursor Engineering Coach',
      column,
      {
        enableScripts: true,
        // Retaining context prevents expensive re-parse on tab switch.
        // Trade-off: ~10-20MB extra memory when tab is hidden.
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    DashboardPanel.instance = new DashboardPanel(panel, extensionUri, context);
  }

  public static get current(): DashboardPanel | undefined {
    return DashboardPanel.instance;
  }

  public reload(force = false): void {
    if (this.loading) {
      runtimeDebug('panel', 'reload-skipped-loading');
      return;
    }
    // Suppress watcher-triggered reloads within 10s of a completed load
    if (!force && Date.now() - this.loadCompletedAt < 10_000) {
      runtimeDebug('panel', 'reload-skipped-cooldown');
      return;
    }
    runtimeDebug('panel', 'reload');
    clearCache();
    clearCatalogCache();
    panelCache.clear();
    this.analyzer = undefined;
    this.parseResult = undefined;
    this.pendingMessages = [];
    this.dataReady = false;
    this.disposed = false;
    this.panel.webview.html = getDashboardHtml(this.panel.webview, this.extensionUri);
    void this.loadData();
  }

  /** Reveal the panel and navigate to a specific page (queued until data is ready). */
  public revealPage(page: string): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    try { this.panel.reveal(column); } catch { /* disposed */ }
    if (this.dataReady) {
      try { this.panel.webview.postMessage({ type: 'navigate', page }); } catch { /* disposed */ }
    } else {
      this.initialNavPage = page;
    }
  }

  private flushInitialNav(): void {
    if (!this.initialNavPage) return;
    const page = this.initialNavPage;
    this.initialNavPage = undefined;
    try { this.panel.webview.postMessage({ type: 'navigate', page }); } catch { /* disposed */ }
  }

  private updateSidebarStats(): void {
    if (!this.parseResult) return;
    const harnesses = new Set<string>();
    for (const session of this.parseResult.sessions) {
      harnesses.add(session.harness);
    }
    saveSidebarStats({
      harnesses: Array.from(harnesses).sort(),
      savedAt: Date.now(),
    });
    DashboardSidebarProvider.instance?.refresh();
  }

  private async loadData(): Promise<void> {
    this.loading = true;
    const t0 = Date.now();
    runtimeDebug('panel', 'loadData-start');
    const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

    // Throttle progress messages to the webview: at most once per 250ms.
    let lastProgressTime = 0;
    let pendingProgress: Parameters<typeof sendRaw>[0] | undefined;
    let progressFlushTimer: ReturnType<typeof setTimeout> | undefined;
    const sendRaw = (progress: { phase: number; detail?: string; pct: number; sessions?: number; linesOfCode?: number; toolCalls?: number; imagesAnalyzed?: number; filesEdited?: number; requests?: number; workspacePlan?: string[]; workspaceDone?: string }) => {
      if (this.disposed) return;
      try {
        this.panel.webview.postMessage({ type: 'progress', ...progress });
      } catch {
        // Webview may have been disposed between the flag check and the call.
      }
    };
    const sendProgress = (progress: Parameters<typeof sendRaw>[0]) => {
      if (this.disposed) {
        clearTimeout(progressFlushTimer);
        return;
      }
      const now = Date.now();
      // Always send immediately for phase changes, workspace grid updates, and the final "Ready".
      if (progress.phase !== pendingProgress?.phase || progress.workspacePlan || progress.workspaceDone || progress.pct >= 100) {
        clearTimeout(progressFlushTimer);
        sendRaw(progress);
        lastProgressTime = now;
        pendingProgress = progress;
        return;
      }
      pendingProgress = progress;
      if (now - lastProgressTime >= 250) {
        clearTimeout(progressFlushTimer);
        sendRaw(progress);
        lastProgressTime = now;
      } else if (!progressFlushTimer) {
        progressFlushTimer = setTimeout(() => {
          progressFlushTimer = undefined;
          if (pendingProgress && !this.disposed) {
            sendRaw(pendingProgress);
            lastProgressTime = Date.now();
          }
        }, 250 - (now - lastProgressTime));
      }
    };

    const safePost = (msg: Record<string, unknown>) => {
      if (this.disposed) return;
      try {
        this.panel.webview.postMessage(msg);
      } catch {
        // Webview disposed between check and call.
      }
    };

    try {
      if (panelCache.analyzerInstance && panelCache.result) {
        runtimeDebug('panel', 'loadData-cache-hit');
        this.parseResult = panelCache.result;
        this.analyzer = panelCache.analyzerInstance;
        this.updateSidebarStats();
        this.dataReady = true;
        safePost({ type: 'dataReady', currentWorkspace: vscode.workspace.name || '' });
        this.flushInitialNav();
        return;
      }

      sendProgress({ phase: 0, detail: 'Discovering log directories', pct: 0 });
      await flush();
      if (this.disposed) return;

      const dirs = findLogsDirs();
      // Cursor's native Composer/Agent sessions live in the global SQLite DB,
      // which is discovered separately from workspaceStorage. Only show the
      // empty state when neither source exists.
      const hasComposerDb = findCursorEditions().length > 0;
      runtimeDebug('panel', 'logs-dirs-found', `count=${dirs.length} composerDb=${hasComposerDb}`);
      if (dirs.length === 0 && !hasComposerDb) {
        runtimeDebug('panel', 'loadData-no-dirs');
        if (!this.disposed) {
          try { this.panel.webview.html = getErrorHtml('No Cursor session logs found. Looked in the Cursor workspaceStorage directory (~/Library/Application Support/Cursor/User/workspaceStorage on macOS, ~/.config/Cursor/User/workspaceStorage on Linux, %APPDATA%\\Cursor\\User\\workspaceStorage on Windows).'); } catch { /* disposed */ }
        }
        return;
      }

      this.parseResult = await parseAllLogsViaWorker(dirs, progress => sendProgress(progress));
      if (this.disposed) return;
      runtimeDebug('panel', 'parse-complete', `sessions=${this.parseResult.sessions.length} workspaces=${this.parseResult.workspaces.size}`);
      const sessionCount = this.parseResult.sessions.length;

      sendProgress({ phase: 4, detail: 'Building analyzer', pct: 90, sessions: sessionCount });
      await flush();
      if (this.disposed) return;

      this.analyzer = new Analyzer(this.parseResult.sessions, this.parseResult.editLocIndex, this.parseResult.workspaces, readBillingProfile());
      runtimeDebug('panel', 'analyzer-built', `elapsedMs=${Date.now() - t0}`);

      sendProgress({ phase: 5, detail: 'Ready', pct: 100, sessions: sessionCount });
      await flush();
      if (this.disposed) return;

      panelCache.store(this.parseResult, this.analyzer);
      this.updateSidebarStats();

      // Mark data ready BEFORE notifying webview, so incoming RPC calls
      // are handled immediately instead of being queued behind warmUp().
      this.dataReady = true;

      safePost({ type: 'dataReady', currentWorkspace: vscode.workspace.name || '' });
      this.flushInitialNav();
      runtimeDebug('panel', 'data-ready-sent', `elapsedMs=${Date.now() - t0}`);

      try {
        await this.analyzer.warmUp();
      } catch (error) {
        runtimeDebug('panel', 'warmUp-failed', error);
      }
      runtimeDebug('panel', 'warmUp-done', `elapsedMs=${Date.now() - t0}`);
      if (this.disposed) return;

      for (const message of this.pendingMessages) {
        this.handleMessage(message);
      }
      this.pendingMessages = [];
    } catch (error: unknown) {
      runtimeDebug('panel', 'loadData-error', error);
      if (!this.disposed) {
        try { this.panel.webview.html = getErrorHtml(error instanceof Error ? error.message : 'Failed to load data'); } catch { /* disposed */ }
      }
    } finally {
      this.loading = false;
      this.loadCompletedAt = Date.now();
    }
  }

  /**
   * Command-style messages handled directly (no analyzer/data needed). Returns
   * true when the message was consumed.
   */
  private tryHandleCommand(msg: Extract<WebviewMessage, { type: 'request' }>): boolean {
    if (msg.method === 'openExternal') {
      const url = (msg.params as Record<string, unknown> | undefined)?.url;
      if (typeof url === 'string') {
        void vscode.env.openExternal(vscode.Uri.parse(url));
        postResponse(this.panel.webview, msg.id, { ok: true });
      }
      return true;
    }
    // Enable opt-in live usage tracking from the Usage page CTA.
    if (msg.method === 'enableUsageTracking') {
      void vscode.commands.executeCommand('cursorEngineeringCoach.enableUsageTracking');
      postResponse(this.panel.webview, msg.id, { ok: true });
      return true;
    }
    // Budget persistence — handled before data readiness check.
    if (msg.method === 'saveModelBudgets' || msg.method === 'loadModelBudgets') {
      this.handleBudgetMessage(msg);
      return true;
    }
    return false;
  }

  private handleMessage(msg: unknown): void {
    if (this.disposed) return;
    if (!isRequestMessage(msg)) return;

    if (this.tryHandleCommand(msg)) return;
    if (this.requestService.tryHandle(msg)) return;

    if (!this.dataReady || !this.analyzer || !this.parseResult) {
      this.pendingMessages.push(msg);
      return;
    }

    const handler = getRpcHandler(msg.method);
    if (!handler) {
      if (!this.disposed) {
        try { postResponse(this.panel.webview, msg.id, errorResult(`Unknown method: ${msg.method}`)); } catch { /* disposed */ }
      }
      return;
    }

    try {
      const result = handler(this.analyzer, this.parseResult, (msg.params ?? {}) as Record<string, unknown>);
      // Support async RPC handlers (e.g. getSessionDetail loads from disk)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(
          (data) => {
            if (!this.disposed) {
              try { postResponse(this.panel.webview, msg.id, data); } catch { /* disposed */ }
            }
          },
          (error) => {
            if (!this.disposed) {
              try { postResponse(this.panel.webview, msg.id, errorResult(error instanceof Error ? error.message : 'Internal error')); } catch { /* disposed */ }
            }
          },
        );
      } else {
        if (!this.disposed) {
          try { postResponse(this.panel.webview, msg.id, result); } catch { /* disposed */ }
        }
      }
    } catch (error: unknown) {
      const data = errorResult(error instanceof Error ? error.message : 'Internal error');
      if (!this.disposed) {
        try { postResponse(this.panel.webview, msg.id, data); } catch { /* disposed */ }
      }
    }
  }

  private static readonly BUDGET_STATE_KEY = 'modelBudgets';

  private handleBudgetMessage(msg: Extract<WebviewMessage, { type: 'request' }>): void {
    if (msg.method === 'saveModelBudgets') {
      const budgets = (msg.params as Record<string, unknown>)?.budgets;
      this.globalState.update(DashboardPanel.BUDGET_STATE_KEY, budgets).then(
        () => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, { ok: true }); } catch { /* disposed */ } },
        () => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, errorResult('Failed to save budgets')); } catch { /* disposed */ } },
      );
    } else {
      const budgets = this.globalState.get<Record<string, number>>(DashboardPanel.BUDGET_STATE_KEY, {});
      if (!this.disposed) try { postResponse(this.panel.webview, msg.id, budgets); } catch { /* disposed */ }
    }
  }

  private dispose(): void {
    runtimeDebug('panel', 'dispose');
    this.disposed = true;
    DashboardPanel.instance = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}
