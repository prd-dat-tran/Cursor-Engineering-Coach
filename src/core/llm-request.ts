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
    const text: unknown = (part as { text: unknown }).text;
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
