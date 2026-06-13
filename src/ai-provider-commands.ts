/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Commands for configuring the opt-in AI provider (see src/llm-provider.ts):
 *   - setupAi:       guided quick-pick (Local Ollama / Google Gemini /
 *                    OpenAI-compatible / Off), with a connection check at the end
 *   - setAiApiKey:   store a hosted-provider key in SecretStorage
 *   - clearAiApiKey: remove it
 * The API key is only ever held in SecretStorage — never written to settings.
 */

import * as vscode from 'vscode';
import { defaultBaseUrlFor, modelHintFor, suggestedBaseUrl, suggestedModel } from './core/llm-request';
import {
  AI_CONFIG_SECTION,
  AiProvider,
  clearApiKey,
  completeChat,
  getLlmConfig,
  hasApiKey,
  listModels,
  setAiSecretAccessor,
  setApiKey,
} from './llm-provider';

/** Human-readable provider name for notifications and progress titles. */
function providerLabel(provider: AiProvider): string {
  switch (provider) {
    case 'ollama': return 'Local Ollama';
    case 'gemini': return 'Google Gemini';
    case 'openai-compatible': return 'OpenAI-compatible endpoint';
    default: return 'AI provider';
  }
}

async function promptForApiKey(provider?: AiProvider): Promise<void> {
  const prompt = provider === 'gemini'
    ? 'Your Google Gemini API key from Google AI Studio. Stored securely in SecretStorage; never written to settings.'
    : 'API key for your OpenAI-compatible provider. Stored securely in SecretStorage; never written to settings. (Local Ollama needs no key.)';
  const key = await vscode.window.showInputBox({
    title: 'Set AI API Key',
    prompt,
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) return; // cancelled
  if (key.trim() === '') {
    await clearApiKey();
    void vscode.window.showInformationMessage('Cursor Engineering Coach: AI API key cleared.');
    return;
  }
  await setApiKey(key.trim());
  void vscode.window.showInformationMessage('Cursor Engineering Coach: AI API key saved securely.');
}

interface ProviderPick extends vscode.QuickPickItem {
  value: AiProvider;
}

async function pickBaseUrl(provider: AiProvider, suggested: string): Promise<string | undefined> {
  const fallback = defaultBaseUrlFor(provider);
  const baseUrl = await vscode.window.showInputBox({
    title: 'AI Provider Base URL',
    prompt: 'OpenAI-compatible base URL. The extension POSTs to <baseUrl>/chat/completions.',
    value: suggested || fallback,
    ignoreFocusOut: true,
  });
  if (baseUrl === undefined) return undefined;
  return baseUrl.trim() || fallback;
}

function modelPrompt(provider: AiProvider): string {
  switch (provider) {
    case 'ollama':
      return 'Model name (run `ollama pull <model>` first), e.g. qwen2.5-coder.';
    case 'gemini':
      return 'Gemini model id, e.g. gemini-2.5-pro (your Pro tier) or gemini-2.5-flash for cheaper/faster runs.';
    default:
      return 'Model name supported by your endpoint, e.g. gpt-4o-mini.';
  }
}

/** Free-text model entry — the fallback when discovery returns nothing. */
async function promptModelText(provider: AiProvider, value: string): Promise<string | undefined> {
  const model = await vscode.window.showInputBox({
    title: 'AI Model',
    prompt: modelPrompt(provider),
    value,
    ignoreFocusOut: true,
  });
  return model === undefined ? undefined : model.trim();
}

/** Surface likely chat models first (Gemini lists many image/embedding/tts ids too). */
function rankModels(provider: AiProvider, ids: string[]): string[] {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  if (provider !== 'gemini') return sorted;
  const isChat = (id: string) => !/embedding|image|tts|audio|veo|vision/i.test(id);
  const chat = sorted.filter(isChat);
  const rest = sorted.filter(id => !isChat(id));
  const flagship = chat.filter(id => /pro|flash/i.test(id));
  const otherChat = chat.filter(id => !/pro|flash/i.test(id));
  return [...flagship, ...otherChat, ...rest];
}

/** Sentinel returned when the user opts out of the list to type an id by hand. */
const ENTER_CUSTOM = Symbol('enter-custom');

/** Quick-pick over discovered models, with an explicit "enter manually" escape. */
async function pickModelFromList(provider: AiProvider, ids: string[], current: string): Promise<string | undefined | typeof ENTER_CUSTOM> {
  const items: vscode.QuickPickItem[] = rankModels(provider, ids).map(id => ({
    label: id,
    description: id === current ? '(current)' : undefined,
  }));
  const customItem: vscode.QuickPickItem = { label: '$(edit) Enter a model id manually…', alwaysShow: true };
  const choice = await vscode.window.showQuickPick([...items, customItem], {
    title: `${providerLabel(provider)} — choose a model`,
    placeHolder: `${ids.length} model(s) available to your key. Pick one, or enter an id manually.`,
    ignoreFocusOut: true,
    matchOnDescription: true,
  });
  if (!choice) return undefined;
  return choice === customItem ? ENTER_CUSTOM : choice.label;
}

/**
 * Choose the model. Tries to fetch the provider's available models first (so the
 * user can't pick an id their key lacks — the cause of "model not found"); falls
 * back to manual entry when discovery isn't supported or returns nothing.
 */
async function pickModel(provider: AiProvider, suggested: string): Promise<string | undefined> {
  const fallbackValue = suggested || modelHintFor(provider);
  const ids = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching ${providerLabel(provider)} models\u2026` },
    () => listModels(),
  );
  if (ids.length > 0) {
    const picked = await pickModelFromList(provider, ids, fallbackValue);
    if (picked === undefined) return undefined; // cancelled
    if (picked !== ENTER_CUSTOM) return picked;
  }
  return promptModelText(provider, fallbackValue);
}

/**
 * Send a tiny test request to confirm the freshly-saved provider config actually
 * works (right key, model, reachable endpoint). On failure we warn but keep the
 * settings — the user can fix the issue and re-run an analysis. For local Ollama
 * this stays on-device; for Gemini it makes the user's first (opted-in) call.
 */
async function verifyProvider(): Promise<void> {
  const cfg = getLlmConfig();
  const ok = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Verifying ${providerLabel(cfg.provider)}\u2026` },
    async () => {
      try {
        await completeChat([{ role: 'user', content: 'Reply with the single word: OK.' }]);
        return true;
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'request failed';
        void vscode.window.showWarningMessage(
          `Cursor Engineering Coach: couldn't verify the AI provider \u2014 ${detail} The setting was saved; fix the issue and re-run an analysis.`,
        );
        return false;
      }
    },
  );
  if (!ok) return;
  const keyNote = (await hasApiKey()) ? ', key saved' : '';
  void vscode.window.showInformationMessage(
    `Cursor Engineering Coach: AI provider verified \u2713 (${cfg.provider}, ${cfg.model || 'no model'}${keyNote}). In-panel AI will use it.`,
  );
}

async function runSetup(): Promise<void> {
  const picks: ProviderPick[] = [
    { label: '$(server) Local Ollama', detail: 'Runs on your machine — prompts never leave your computer (recommended)', value: 'ollama' },
    { label: '$(sparkle) Google Gemini', detail: 'Use your Google AI Studio (Gemini) API key — keeps your Cursor request/token budget free', value: 'gemini' },
    { label: '$(cloud) OpenAI-compatible endpoint', detail: 'OpenAI, OpenRouter, Azure, LiteLLM… (sends prompts + session summaries to that service)', value: 'openai-compatible' },
    { label: '$(circle-slash) Off (auto)', detail: 'No external calls; in-panel AI hands off to Cursor Chat or ranks locally', value: 'auto' },
  ];
  const choice = await vscode.window.showQuickPick(picks, {
    title: 'Set Up AI Provider for Cursor Engineering Coach',
    placeHolder: 'Where should in-panel AI analyses run?',
    ignoreFocusOut: true,
  });
  if (!choice) return;

  // Snapshot the existing config BEFORE we overwrite `provider`, so we can tell
  // whether the user is switching providers (and must drop the old provider's
  // stale baseUrl/model) or just re-configuring the same one.
  const prev = getLlmConfig();

  const cfg = vscode.workspace.getConfiguration(AI_CONFIG_SECTION);
  await cfg.update('provider', choice.value, vscode.ConfigurationTarget.Global);

  if (choice.value === 'auto') {
    void vscode.window.showInformationMessage('Cursor Engineering Coach: AI provider set to Off (auto). No external calls.');
    return;
  }

  const baseUrl = await pickBaseUrl(choice.value, suggestedBaseUrl(prev.provider, prev.baseUrl, choice.value));
  if (baseUrl === undefined) return;
  await cfg.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);

  // Ask for the key before the model, so model discovery can query the key's
  // available models (and avoid the "model not found" stumble).
  const needsKey = choice.value === 'gemini' || choice.value === 'openai-compatible';
  if (needsKey && !(await hasApiKey())) {
    const ask = choice.value === 'gemini'
      ? 'Add your Google Gemini API key now? (Stored securely in SecretStorage.)'
      : 'Add an API key for this provider now? (Stored securely in SecretStorage.)';
    const action = await vscode.window.showInformationMessage(ask, 'Set API Key', 'Skip');
    if (action === 'Set API Key') await promptForApiKey(choice.value);
  }

  const model = await pickModel(choice.value, suggestedModel(prev.provider, prev.model, choice.value));
  if (model === undefined) return;
  await cfg.update('model', model, vscode.ConfigurationTarget.Global);

  await verifyProvider();
}

/** Register the AI-provider commands and wire SecretStorage. */
export function registerAiProviderCommands(context: vscode.ExtensionContext): void {
  setAiSecretAccessor(context.secrets);
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorEngineeringCoach.setupAi', () => runSetup()),
    vscode.commands.registerCommand('cursorEngineeringCoach.setAiApiKey', () => promptForApiKey()),
    vscode.commands.registerCommand('cursorEngineeringCoach.clearAiApiKey', async () => {
      await clearApiKey();
      void vscode.window.showInformationMessage('Cursor Engineering Coach: AI API key cleared.');
    }),
  );
}
