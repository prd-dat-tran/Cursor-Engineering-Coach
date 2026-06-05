/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Resolves the user's Cursor billing profile from (1) VS Code settings and
 * (2) auto-detected local Cursor account data. Kept out of `core/billing.ts`
 * so that module stays free of the `vscode` dependency and can run in worker
 * threads.
 *
 * Precedence:
 *   - plan:  explicit setting  >  auto-detected membership  >  unknown
 *   - model: explicit setting  >  default for plan (usage-based)
 */

import * as vscode from 'vscode';
import {
  BillingProfile,
  cursorPlanLabel,
  defaultBillingModelForPlan,
  mapMembershipToPlan,
  planBillingIsAmbiguous,
  resolveBillingModel,
  resolveCursorPlan,
} from './core/billing';
import { readCursorMembershipType } from './core/parser-cursor';

/** Config section watched for changes (used with `event.affectsConfiguration`). */
export const BILLING_CONFIG_SECTION = 'cursorEngineeringCoach.billing';

/** Memento key recording that we've already offered the one-time billing prompt. */
const PROMPTED_KEY = 'billing.promptedForModel.v1';

interface ConfigInspect {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

function isExplicitlySet(inspect: ConfigInspect | undefined): boolean {
  return !!inspect && (
    inspect.globalValue !== undefined ||
    inspect.workspaceValue !== undefined ||
    inspect.workspaceFolderValue !== undefined
  );
}

// Membership detection shells out to sqlite3; cache it for the session since
// the plan rarely changes while the editor is open.
let cachedMembership: string | null | undefined;
function detectMembership(): string | null {
  if (cachedMembership === undefined) {
    try { cachedMembership = readCursorMembershipType(); }
    catch { cachedMembership = null; }
  }
  return cachedMembership;
}

/** Resolve the current billing profile from settings + local detection. */
export function readBillingProfile(): BillingProfile {
  const cfg = vscode.workspace.getConfiguration(BILLING_CONFIG_SECTION);
  const modelSet = isExplicitlySet(cfg.inspect('model'));
  const planSet = isExplicitlySet(cfg.inspect('plan'));

  const detectedPlan = planSet ? 'unknown' : mapMembershipToPlan(detectMembership());
  const plan = planSet ? resolveCursorPlan(cfg.get('plan')) : detectedPlan;
  const model = modelSet ? resolveBillingModel(cfg.get('model')) : defaultBillingModelForPlan(plan);

  return {
    model,
    plan,
    configured: modelSet,
    planDetected: !planSet && detectedPlan !== 'unknown',
  };
}

/**
 * One-time prompt: when we detect a Teams/Enterprise plan and the user hasn't
 * chosen a billing model, ask whether they're billed per request or per token.
 * Writes the choice to settings (which the panel watches and re-tunes on). Any
 * interaction — including dismissal — suppresses future prompts.
 */
export async function maybePromptForBillingModel(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(BILLING_CONFIG_SECTION);
  if (isExplicitlySet(cfg.inspect('model'))) return;
  if (context.globalState.get<boolean>(PROMPTED_KEY)) return;

  const plan = mapMembershipToPlan(detectMembership());
  if (!planBillingIsAmbiguous(plan)) return;

  const label = cursorPlanLabel(plan) || 'paid';
  const perRequest = 'Per request';
  const perToken = 'Per token';
  const dontAsk = "Don't ask again";
  const choice = await vscode.window.showInformationMessage(
    `Cursor Engineering Coach detected a ${label} plan. How is your Cursor usage billed? ` +
    'This tailors model-selection and cost coaching (you can change it later in Settings → Cursor Engineering Coach → Billing).',
    perRequest, perToken, dontAsk,
  );

  if (choice === perRequest) {
    await cfg.update('model', 'request-based', vscode.ConfigurationTarget.Global);
  } else if (choice === perToken) {
    await cfg.update('model', 'usage-based', vscode.ConfigurationTarget.Global);
  }
  await context.globalState.update(PROMPTED_KEY, true);
}
