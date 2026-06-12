/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Commands for configuring the opt-in AI provider (see src/llm-provider.ts):
 *   - setupAi:       guided quick-pick (Local Ollama / OpenAI-compatible / Off)
 *   - setAiApiKey:   store a hosted-provider key in SecretStorage
 *   - clearAiApiKey: remove it
 * The API key is only ever held in SecretStorage — never written to settings.
 */

import * as vscode from 'vscode';
import {
  AI_CONFIG_SECTION,
  AiProvider,
  clearApiKey,
  getLlmConfig,
  hasApiKey,
  setAiSecretAccessor,
  setApiKey,
} from './llm-provider';

async function promptForApiKey(): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'Set AI API Key',
    prompt: 'API key for your OpenAI-compatible provider. Stored securely in SecretStorage; never written to settings. (Local Ollama needs no key.)',
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

async function pickBaseUrl(provider: AiProvider): Promise<string | undefined> {
  const fallback = provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'https://api.openai.com/v1';
  const baseUrl = await vscode.window.showInputBox({
    title: 'AI Provider Base URL',
    prompt: 'OpenAI-compatible base URL. The extension POSTs to <baseUrl>/chat/completions.',
    value: getLlmConfig().baseUrl || fallback,
    ignoreFocusOut: true,
  });
  if (baseUrl === undefined) return undefined;
  return baseUrl.trim() || fallback;
}

async function pickModel(provider: AiProvider): Promise<string | undefined> {
  const hint = provider === 'ollama' ? 'qwen2.5-coder' : 'gpt-4o-mini';
  const prompt = provider === 'ollama'
    ? 'Model name (run `ollama pull <model>` first), e.g. qwen2.5-coder.'
    : 'Model name supported by your endpoint, e.g. gpt-4o-mini.';
  const model = await vscode.window.showInputBox({ title: 'AI Model', prompt, value: getLlmConfig().model || hint, ignoreFocusOut: true });
  return model === undefined ? undefined : model.trim();
}

async function runSetup(): Promise<void> {
  const picks: ProviderPick[] = [
    { label: '$(server) Local Ollama', detail: 'Runs on your machine — prompts never leave your computer (recommended)', value: 'ollama' },
    { label: '$(cloud) OpenAI-compatible endpoint', detail: 'OpenAI, OpenRouter, Azure, LiteLLM… (sends prompts + session summaries to that service)', value: 'openai-compatible' },
    { label: '$(circle-slash) Off (auto)', detail: 'No external calls; in-panel AI hands off to Cursor Chat or ranks locally', value: 'auto' },
  ];
  const choice = await vscode.window.showQuickPick(picks, {
    title: 'Set Up AI Provider for Cursor Engineering Coach',
    placeHolder: 'Where should in-panel AI analyses run?',
    ignoreFocusOut: true,
  });
  if (!choice) return;

  const cfg = vscode.workspace.getConfiguration(AI_CONFIG_SECTION);
  await cfg.update('provider', choice.value, vscode.ConfigurationTarget.Global);

  if (choice.value === 'auto') {
    void vscode.window.showInformationMessage('Cursor Engineering Coach: AI provider set to Off (auto). No external calls.');
    return;
  }

  const baseUrl = await pickBaseUrl(choice.value);
  if (baseUrl === undefined) return;
  await cfg.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);

  const model = await pickModel(choice.value);
  if (model === undefined) return;
  await cfg.update('model', model, vscode.ConfigurationTarget.Global);

  if (choice.value === 'openai-compatible' && !(await hasApiKey())) {
    const action = await vscode.window.showInformationMessage(
      'Add an API key for this provider now? (Stored securely in SecretStorage.)',
      'Set API Key', 'Skip',
    );
    if (action === 'Set API Key') await promptForApiKey();
  }

  const cfgNow = getLlmConfig();
  const keyNote = (await hasApiKey()) ? ', key saved' : '';
  void vscode.window.showInformationMessage(
    `Cursor Engineering Coach: AI provider ready (${cfgNow.provider}, ${cfgNow.model || 'no model set'}${keyNote}). Re-run an analysis to use it.`,
  );
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
