/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opt-in, OpenAI-compatible LLM provider. This lets the coach's in-panel AI work
 * in Cursor (where `vscode.lm` exposes no models) by calling a chat-completions
 * endpoint directly. Supported presets: a LOCAL Ollama server (default, fully
 * on-device), Google Gemini (Google's OpenAI-compatible endpoint, authed with a
 * Google AI Studio key), or any other OpenAI-compatible service. A hosted provider
 * like Gemini lets the coach review prompts/context without spending the user's
 * Cursor request/token budget.
 *
 * Privacy contract (mirrors src/billing-usage.ts and the project's local-first stance):
 *   - Nothing is sent unless the user sets `cursorEngineeringCoach.ai.provider`
 *     to something other than `auto` (default `auto` = no external call).
 *   - With `ollama` (default base URL) the request never leaves localhost.
 *   - An optional API key (hosted providers) is read from SecretStorage, used
 *     transiently as a Bearer credential, and never stored elsewhere or logged.
 *   - Errors are sanitized — the key is never surfaced.
 */

import * as vscode from 'vscode';
import {
  AiProvider,
  buildChatBody,
  ChatMsg,
  defaultBaseUrlFor,
  describeProviderHttpError,
  extractContent,
  extractModelIds,
  JsonSchemaSpec,
  joinUrl,
  modelHintFor,
  providerHelpText,
} from './core/llm-request';

/** Config section watched for changes (used with `event.affectsConfiguration`). */
export const AI_CONFIG_SECTION = 'cursorEngineeringCoach.ai';
/** SecretStorage key holding the optional hosted-provider API key. */
export const AI_API_KEY_SECRET = 'cursorEngineeringCoach.ai.apiKey';

// Generous timeout: local models on modest hardware can take a while to respond.
const FETCH_TIMEOUT_MS = 120_000;

// Provider id + per-provider presets live in the (vscode-free) core module so
// they can be unit-tested; re-exported here so existing importers are unchanged.
export type { AiProvider };

export interface LlmConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

/** Read the AI provider settings. `provider: 'auto'` means "use vscode.lm only". */
export function getLlmConfig(): LlmConfig {
  const cfg = vscode.workspace.getConfiguration(AI_CONFIG_SECTION);
  const provider = (cfg.get<string>('provider') ?? 'auto') as AiProvider;
  // Fall back to the provider's documented default so a half-configured provider
  // (e.g. Gemini selected but baseUrl left blank) still points at the right host.
  const baseUrl = (cfg.get<string>('baseUrl') || '').trim() || defaultBaseUrlFor(provider);
  const model = (cfg.get<string>('model') || '').trim();
  return { provider, baseUrl, model };
}

/** True when the user opted into an external OpenAI-compatible provider. */
export function externalProviderConfigured(): boolean {
  return getLlmConfig().provider !== 'auto';
}

/* ---- API key (SecretStorage) ---- */

let secretStore: vscode.SecretStorage | undefined;

/** Wire up SecretStorage during activation so the provider can read the key. */
export function setAiSecretAccessor(secrets: vscode.SecretStorage): void {
  secretStore = secrets;
}

export async function getApiKey(): Promise<string | undefined> {
  if (!secretStore) return undefined;
  try {
    return (await secretStore.get(AI_API_KEY_SECRET)) || undefined;
  } catch {
    return undefined;
  }
}

export async function setApiKey(key: string): Promise<void> {
  await secretStore?.store(AI_API_KEY_SECRET, key);
}

export async function clearApiKey(): Promise<void> {
  await secretStore?.delete(AI_API_KEY_SECRET);
}

export async function hasApiKey(): Promise<boolean> {
  return !!(await getApiKey());
}

/* ---- completion ---- */

async function readErrorBody(resp: Response): Promise<string> {
  try {
    return (await resp.text()).trim().slice(0, 300);
  } catch {
    return '';
  }
}

/** Best-effort OS error code (e.g. ECONNREFUSED) from a thrown fetch error. */
function fetchErrorCode(err: unknown): string {
  if (!(err instanceof Error)) return '';
  const cause = err.cause;
  if (!cause || typeof cause !== 'object') return '';
  const code = (cause as Record<string, unknown>).code;
  return typeof code === 'string' ? code : '';
}

/** Turn a thrown fetch/timeout into an actionable message (no raw "fetch failed"). */
function describeFetchError(err: unknown, url: string, provider: AiProvider): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return `AI provider request to ${url} timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s. The model may be slow or stuck — try a smaller model.`;
  }
  const code = fetchErrorCode(err);
  const codeSuffix = code ? ` (${code})` : '';
  return `Couldn't reach the AI provider at ${url}${codeSuffix}. ${providerHelpText(provider)}`;
}

/**
 * Call the configured OpenAI-compatible chat-completions endpoint and return the
 * assistant text. Throws on misconfiguration, network failure, or non-2xx — the
 * panel LLM layer retries / falls back. The API key (if any) is never logged.
 */
export async function completeChat(
  messages: ChatMsg[],
  opts: { jsonSchema?: JsonSchemaSpec } = {},
): Promise<string> {
  const { provider, baseUrl, model } = getLlmConfig();
  if (!model) {
    throw new Error(
      `No AI model configured. Set "cursorEngineeringCoach.ai.model" (e.g. ${modelHintFor(provider)}). ` +
      'Re-run "Cursor Engineering Coach: Set Up AI Provider" for a guided setup.',
    );
  }

  const url = joinUrl(baseUrl, '/chat/completions');
  const body = buildChatBody(model, messages, opts.jsonSchema);
  const key = await getApiKey();
  // Gemini always requires a key; surface that up front rather than as an opaque 401.
  if (provider === 'gemini' && !key) {
    throw new Error(
      'No API key set for Google Gemini. Run "Cursor Engineering Coach: Set AI API Key" and paste your Google AI Studio key.',
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Network/timeout failures arrive as an opaque "fetch failed" — make it actionable.
    throw new Error(describeFetchError(err, url, provider), { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const bodyText = await readErrorBody(resp);
    throw new Error(describeProviderHttpError(resp.status, resp.statusText, bodyText, provider, model));
  }
  return extractContent(await resp.json());
}

/** Generous-but-bounded timeout for the `GET /models` discovery call (setup-time). */
const MODELS_FETCH_TIMEOUT_MS = 15_000;

/**
 * Best-effort: list the model ids the configured provider/key exposes via
 * `GET <baseUrl>/models` (OpenAI-compatible). Used by the setup command to offer
 * a pick-list instead of a free-text box, so users don't guess an unavailable id.
 * Returns `[]` on any failure (endpoint unsupported, network, auth) — callers then
 * fall back to manual entry. The API key is sent only as a Bearer header.
 */
export async function listModels(): Promise<string[]> {
  const { baseUrl } = getLlmConfig();
  const url = joinUrl(baseUrl, '/models');
  const key = await getApiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!resp.ok) return [];
    return extractModelIds(await resp.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
