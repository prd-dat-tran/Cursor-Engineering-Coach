/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opt-in, OpenAI-compatible LLM provider. This lets the coach's in-panel AI work
 * in Cursor (where `vscode.lm` exposes no models) by calling a chat-completions
 * endpoint directly. The default target is a LOCAL Ollama server, so prompts and
 * session summaries stay on the user's machine.
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
import { buildChatBody, ChatMsg, extractContent, JsonSchemaSpec, joinUrl } from './core/llm-request';

/** Config section watched for changes (used with `event.affectsConfiguration`). */
export const AI_CONFIG_SECTION = 'cursorEngineeringCoach.ai';
/** SecretStorage key holding the optional hosted-provider API key. */
export const AI_API_KEY_SECRET = 'cursorEngineeringCoach.ai.apiKey';

// Use 127.0.0.1 (not "localhost"): Node's fetch can resolve "localhost" to IPv6
// (::1) while Ollama listens on IPv4 only, which surfaces as a cryptic "fetch failed".
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
// Generous timeout: local models on modest hardware can take a while to respond.
const FETCH_TIMEOUT_MS = 120_000;

export type AiProvider = 'auto' | 'ollama' | 'openai-compatible';

export interface LlmConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

/** Read the AI provider settings. `provider: 'auto'` means "use vscode.lm only". */
export function getLlmConfig(): LlmConfig {
  const cfg = vscode.workspace.getConfiguration(AI_CONFIG_SECTION);
  const provider = (cfg.get<string>('provider') ?? 'auto') as AiProvider;
  const baseUrl = (cfg.get<string>('baseUrl') || DEFAULT_BASE_URL).trim();
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

async function readErrorDetail(resp: Response): Promise<string> {
  try {
    const text = (await resp.text()).trim();
    return text ? `: ${text.slice(0, 300)}` : '';
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
  const base = `Couldn't reach the AI provider at ${url}${codeSuffix}.`;
  if (provider === 'ollama') {
    return `${base} Make sure Ollama is installed and running (open the Ollama app or run \`ollama serve\`), pull a model with \`ollama pull <model>\`, then retry. If Ollama is running but this persists, set cursorEngineeringCoach.ai.baseUrl to http://127.0.0.1:11434/v1.`;
  }
  return `${base} Check that the endpoint is running and that cursorEngineeringCoach.ai.baseUrl is correct.`;
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
      'No AI model configured. Set "cursorEngineeringCoach.ai.model" ' +
      '(for Ollama, run e.g. `ollama pull qwen2.5-coder` and use that name).',
    );
  }

  const url = joinUrl(baseUrl, '/chat/completions');
  const body = buildChatBody(model, messages, opts.jsonSchema);
  const key = await getApiKey();

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
    throw new Error(`AI provider returned ${resp.status} ${resp.statusText}${await readErrorDetail(resp)}`);
  }
  return extractContent(await resp.json());
}
