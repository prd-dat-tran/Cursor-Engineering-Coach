/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure, dependency-free builders for OpenAI-compatible `/chat/completions`
 * requests. Kept free of `vscode`/`fetch` so it can be unit-tested and shared
 * between the host provider ([src/llm-provider.ts]) and the panel LLM layer.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMsg {
  role: ChatRole;
  content: string;
}

/** Shape used to request structured (JSON-schema) output from a model. */
export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface OpenAiMessage {
  role: ChatRole;
  content: string;
}

/** Drop empty messages and return plain OpenAI chat message objects. */
export function toOpenAiMessages(messages: ChatMsg[]): OpenAiMessage[] {
  return messages
    .filter(m => m.content.trim().length > 0)
    .map(m => ({ role: m.role, content: m.content }));
}

/**
 * Build an OpenAI-compatible `/chat/completions` request body. When `jsonSchema`
 * is supplied we ask for structured output via `response_format`; providers that
 * don't support it will error, and the caller retries without it.
 */
export function buildChatBody(
  model: string,
  messages: ChatMsg[],
  jsonSchema?: JsonSchemaSpec,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(messages),
    stream: false,
  };
  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema },
    };
  }
  return body;
}

function partToText(part: unknown): string {
  if (part && typeof part === 'object' && 'text' in part) {
    const text: unknown = (part).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

function pickMessageContent(json: unknown): unknown {
  if (!json || typeof json !== 'object') return undefined;
  const choices = (json as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first: unknown = choices[0];
  if (!first || typeof first !== 'object') return undefined;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return undefined;
  return (message as { content?: unknown }).content;
}

/** Extract assistant text from an OpenAI-compatible chat completion response. */
export function extractContent(json: unknown): string {
  const content = pickMessageContent(json);
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(partToText).join('');
  throw new Error('AI provider returned an empty or unrecognized response');
}

/** Join a base URL and path, tolerating trailing/leading slashes. */
export function joinUrl(baseUrl: string, pathPart: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const tail = pathPart.replace(/^\/+/, '');
  return `${base}/${tail}`;
}

/* ---- provider presets (pure; shared by the host provider + the setup command) ---- */

/**
 * Which backend powers the coach's in-panel AI. `auto` = host `vscode.lm` only
 * (no external call). The rest are OpenAI-compatible `/chat/completions` targets:
 *   - `ollama` — local server, fully on-device.
 *   - `gemini` — Google's OpenAI-compatible endpoint, authed with a Google AI
 *     Studio key. Lets the coach review prompts/context without spending the
 *     user's Cursor request/token budget.
 *   - `openai-compatible` — any other OpenAI-compatible service.
 */
export type AiProvider = 'auto' | 'ollama' | 'gemini' | 'openai-compatible';

/**
 * Default base URL for a provider, used when the user hasn't set
 * `cursorEngineeringCoach.ai.baseUrl`. `auto` makes no external call, so its
 * value is only a harmless placeholder. We use `127.0.0.1` (not `localhost`)
 * for Ollama because Node's fetch can resolve `localhost` to IPv6 (::1) while
 * Ollama listens on IPv4 only.
 */
export function defaultBaseUrlFor(provider: AiProvider): string {
  switch (provider) {
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'openai-compatible':
      return 'https://api.openai.com/v1';
    case 'ollama':
    case 'auto':
    default:
      return 'http://127.0.0.1:11434/v1';
  }
}

/** An example model id to pre-fill the setup prompt / cite in messages. */
export function modelHintFor(provider: AiProvider): string {
  switch (provider) {
    case 'gemini':
      return 'gemini-2.5-pro';
    case 'ollama':
      return 'qwen2.5-coder';
    default:
      return 'gpt-4o-mini';
  }
}

/**
 * Base URL to pre-fill during setup. Keep the prior URL only when re-configuring
 * the *same* provider (so a user's custom URL survives); when **switching**
 * providers, start from the new provider's default. This prevents a stale value —
 * e.g. an old Ollama base (`127.0.0.1:11434`) left from a previous setup — from
 * silently routing Gemini requests to Ollama (which surfaces as Ollama's models,
 * like `qwen2.5-coder`, showing up under a Gemini setup).
 */
export function suggestedBaseUrl(prevProvider: AiProvider, prevBaseUrl: string, chosen: AiProvider): string {
  if (prevProvider === chosen && prevBaseUrl.trim()) return prevBaseUrl.trim();
  return defaultBaseUrlFor(chosen);
}

/** Model id to pre-fill during setup. Same rule: keep the prior model only when the provider is unchanged. */
export function suggestedModel(prevProvider: AiProvider, prevModel: string, chosen: AiProvider): string {
  if (prevProvider === chosen && prevModel.trim()) return prevModel.trim();
  return modelHintFor(chosen);
}

/** Provider-specific guidance appended to a connection-failure message. */
export function providerHelpText(provider: AiProvider): string {
  switch (provider) {
    case 'ollama':
      return 'Make sure Ollama is installed and running (open the Ollama app or run `ollama serve`), pull a model with `ollama pull <model>`, then retry. If Ollama is running but this persists, set cursorEngineeringCoach.ai.baseUrl to http://127.0.0.1:11434/v1.';
    case 'gemini':
      return 'Check your Google Gemini setup: a valid API key from Google AI Studio (set it with "Cursor Engineering Coach: Set AI API Key") and a supported model id in cursorEngineeringCoach.ai.model (e.g. gemini-2.5-pro).';
    default:
      return 'Check that the endpoint is running and that cursorEngineeringCoach.ai.baseUrl is correct.';
  }
}

/**
 * Turn a non-2xx chat-completions response into an actionable message. The
 * common, recoverable cases get tailored guidance:
 *   - 4xx that mentions the model → the model id isn't available to this key
 *     (the most common Gemini stumble: copying a preview id like
 *     `gemini-3.5-flash` that a standard AI Studio key can't use).
 *   - 429 → rate limit / quota exhausted. For Gemini this is the usual Pro
 *     stumble: the free API tier caps Pro at a few requests/day (Flash is far
 *     higher), and a consumer "Gemini Advanced" subscription grants no API
 *     quota — only Cloud Billing (Tier 1) does.
 *   - 401/403 → the API key was rejected.
 * Anything else returns the raw status + (truncated) body.
 */
export function describeProviderHttpError(
  status: number,
  statusText: string,
  bodyText: string,
  provider: AiProvider,
  model: string,
): string {
  const detail = bodyText ? `: ${bodyText}` : '';
  const base = `AI provider returned ${status} ${statusText}${detail}`;
  const lower = `${statusText} ${bodyText}`.toLowerCase();
  const mentionsModel = lower.includes('model');

  if ((status === 404 || status === 400) && mentionsModel) {
    if (provider === 'gemini') {
      return `${base}. The model "${model}" isn't available to your Google AI Studio key (ids like \`gemini-3.5-flash\` are preview/limited). Re-run "Cursor Engineering Coach: Set Up AI Provider" and pick a model from the list — for Gemini Pro use \`gemini-2.5-pro\`. To see what your key supports: GET https://generativelanguage.googleapis.com/v1beta/openai/models.`;
    }
    return `${base}. The model "${model}" isn't available at this endpoint — set cursorEngineeringCoach.ai.model to a model your provider supports.`;
  }

  if (status === 429) {
    if (provider === 'gemini') {
      return `${base}. Your Google Gemini API key hit its rate limit / quota. On the free API tier, Pro models like \`${model}\` are capped at roughly 5 requests/min and ~50-100/day, while Flash models get far higher limits — which is why Flash works but Pro returns 429. A consumer "Gemini Advanced" (Google One) subscription does NOT include API quota. To run Pro through the API, enable Cloud Billing on the key's Google Cloud project (Google AI Studio -> Get API key -> enable billing; Tier 1 is instant, no minimum spend), or set cursorEngineeringCoach.ai.model to \`gemini-2.5-flash\`. Details: https://ai.google.dev/gemini-api/docs/rate-limits.`;
    }
    return `${base}. The provider rate-limited the request (429 - quota exhausted). Wait and retry with backoff, lower the request rate, or raise your plan's quota.`;
  }

  if (status === 401 || status === 403) {
    const keyHint = provider === 'gemini' ? ' with a valid Google AI Studio key' : '';
    return `${base}. The API key was rejected — re-run "Cursor Engineering Coach: Set AI API Key"${keyHint}.`;
  }

  return base;
}

/**
 * Extract model ids from an OpenAI-compatible `GET /models` response
 * (`{ data: [{ id }] }`, a bare array, or an array of strings). Strips Google's
 * `models/` id prefix so the id can be used directly as the chat `model`. Returns
 * a de-duplicated list; `[]` when the shape is unrecognized.
 */
function modelIdFromItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') return item.id;
  return '';
}

export function extractModelIds(json: unknown): string[] {
  let container: unknown = json;
  if (json && typeof json === 'object' && 'data' in json) container = json.data;
  if (!Array.isArray(container)) return [];

  const ids: string[] = [];
  for (const item of container) {
    const id = modelIdFromItem(item).trim().replace(/^models\//, '');
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}
