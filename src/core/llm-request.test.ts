/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildChatBody, defaultBaseUrlFor, describeProviderHttpError, extractContent, extractModelIds, joinUrl, modelHintFor, providerHelpText, suggestedBaseUrl, suggestedModel, toOpenAiMessages } from './llm-request';

describe('toOpenAiMessages', () => {
  it('keeps roles and drops blank messages', () => {
    const out = toOpenAiMessages([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'hi' },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
  });
});

describe('buildChatBody', () => {
  it('produces a non-streaming body without response_format by default', () => {
    const body = buildChatBody('qwen2.5-coder', [{ role: 'user', content: 'hi' }]);
    expect(body.model).toBe('qwen2.5-coder');
    expect(body.stream).toBe(false);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('adds a json_schema response_format when a schema is supplied', () => {
    const body = buildChatBody('gpt-4o', [{ role: 'user', content: 'hi' }], {
      name: 'thing',
      schema: { type: 'object' },
    });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'thing', strict: true, schema: { type: 'object' } },
    });
  });
});

describe('extractContent', () => {
  it('reads string content from the first choice', () => {
    expect(extractContent({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });

  it('concatenates array-of-parts content', () => {
    const json = { choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] };
    expect(extractContent(json)).toBe('ab');
  });

  it('throws on an empty or unrecognized response', () => {
    expect(() => extractContent({})).toThrow();
    expect(() => extractContent({ choices: [] })).toThrow();
    expect(() => extractContent(null)).toThrow();
  });
});

describe('joinUrl', () => {
  it('normalizes trailing and leading slashes', () => {
    expect(joinUrl('http://localhost:11434/v1', '/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
    expect(joinUrl('http://localhost:11434/v1/', 'chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
    expect(joinUrl('https://api.openai.com/v1//', '//chat/completions')).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('defaultBaseUrlFor', () => {
  it('maps each provider to its documented endpoint', () => {
    expect(defaultBaseUrlFor('ollama')).toBe('http://127.0.0.1:11434/v1');
    expect(defaultBaseUrlFor('gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(defaultBaseUrlFor('openai-compatible')).toBe('https://api.openai.com/v1');
  });

  it('falls back to the local Ollama URL for auto (never used — auto makes no call)', () => {
    expect(defaultBaseUrlFor('auto')).toBe('http://127.0.0.1:11434/v1');
  });
});

describe('Gemini routes through the OpenAI-compatible builders', () => {
  it("joins Gemini's base URL to /chat/completions without doubling the slash", () => {
    expect(joinUrl(defaultBaseUrlFor('gemini'), '/chat/completions'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    // Google documents the base URL with a trailing slash; joinUrl must tolerate it.
    expect(joinUrl('https://generativelanguage.googleapis.com/v1beta/openai/', '/chat/completions'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });

  it('builds a Gemini chat body like any other OpenAI-compatible model', () => {
    const body = buildChatBody('gemini-2.5-pro', [{ role: 'user', content: 'hi' }]);
    expect(body.model).toBe('gemini-2.5-pro');
    expect(body.stream).toBe(false);
  });
});

describe('modelHintFor', () => {
  it('suggests a Gemini Pro model for the gemini provider', () => {
    expect(modelHintFor('gemini')).toBe('gemini-2.5-pro');
    expect(modelHintFor('ollama')).toBe('qwen2.5-coder');
    expect(modelHintFor('openai-compatible')).toBe('gpt-4o-mini');
  });
});

describe('suggestedBaseUrl / suggestedModel (setup pre-fill)', () => {
  it('switches to the new provider default instead of reusing a stale value', () => {
    // Regression: configured for Ollama, now choosing Gemini — must NOT keep the
    // Ollama URL/model (which made discovery list qwen2.5-coder under Gemini).
    expect(suggestedBaseUrl('ollama', 'http://127.0.0.1:11434/v1', 'gemini'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(suggestedModel('ollama', 'qwen2.5-coder:latest', 'gemini')).toBe('gemini-2.5-pro');
  });

  it('keeps a custom URL/model when re-configuring the same provider', () => {
    expect(suggestedBaseUrl('gemini', 'https://my-proxy/v1', 'gemini')).toBe('https://my-proxy/v1');
    expect(suggestedModel('gemini', 'gemini-2.5-flash', 'gemini')).toBe('gemini-2.5-flash');
  });

  it('uses the provider default when the prior value is blank', () => {
    expect(suggestedBaseUrl('auto', '', 'ollama')).toBe('http://127.0.0.1:11434/v1');
    expect(suggestedModel('gemini', '   ', 'gemini')).toBe('gemini-2.5-pro');
  });
});

describe('providerHelpText', () => {
  it('gives Gemini-specific guidance (API key + model id)', () => {
    const text = providerHelpText('gemini');
    expect(text).toMatch(/Google AI Studio/);
    expect(text).toMatch(/gemini-2\.5-pro/);
  });

  it('gives Ollama-specific guidance for ollama', () => {
    expect(providerHelpText('ollama')).toMatch(/ollama serve/);
  });
});

describe('describeProviderHttpError', () => {
  it('explains a Gemini model-not-found 404 with a concrete fix', () => {
    const body = '{"error":{"message":"model \'gemini-3.5-flash\' not found","type":"not_found_error"}}';
    const msg = describeProviderHttpError(404, 'Not Found', body, 'gemini', 'gemini-3.5-flash');
    expect(msg).toMatch(/isn't available to your Google AI Studio key/);
    expect(msg).toMatch(/gemini-2\.5-pro/);
    expect(msg).toMatch(/\/models/);
  });

  it('explains a Gemini 429 quota error with billing + Flash guidance', () => {
    const body = '{"error":{"code":429,"message":"You exceeded your current quota"}}';
    const msg = describeProviderHttpError(429, 'Too Many Requests', body, 'gemini', 'gemini-2.5-pro');
    expect(msg).toMatch(/rate limit|quota/i);
    expect(msg).toMatch(/billing/i);
    expect(msg).toMatch(/Gemini Advanced/);
    expect(msg).toMatch(/gemini-2\.5-flash/);
  });

  it('gives a generic 429 rate-limit message for non-Gemini providers', () => {
    const msg = describeProviderHttpError(429, 'Too Many Requests', '', 'openai-compatible', 'gpt-4o-mini');
    expect(msg).toMatch(/429/);
    expect(msg).toMatch(/rate-limited|quota/i);
    expect(msg).not.toMatch(/Gemini Advanced/);
  });

  it('flags a rejected key on 401/403', () => {
    expect(describeProviderHttpError(401, 'Unauthorized', 'bad key', 'gemini', 'gemini-2.5-pro'))
      .toMatch(/API key was rejected/);
    expect(describeProviderHttpError(403, 'Forbidden', '', 'openai-compatible', 'gpt-4o-mini'))
      .toMatch(/API key was rejected/);
  });

  it('falls back to the raw status + body for other errors', () => {
    expect(describeProviderHttpError(500, 'Internal Server Error', 'boom', 'ollama', 'qwen2.5-coder'))
      .toBe('AI provider returned 500 Internal Server Error: boom');
  });

  it('does not give model advice for a 404 that never mentions a model', () => {
    expect(describeProviderHttpError(404, 'Not Found', 'page missing', 'gemini', 'gemini-2.5-pro'))
      .toBe('AI provider returned 404 Not Found: page missing');
  });
});

describe('extractModelIds', () => {
  it('reads ids from an OpenAI-style { data: [...] } list and strips the models/ prefix', () => {
    const json = { object: 'list', data: [{ id: 'models/gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }] };
    expect(extractModelIds(json)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
  });

  it('accepts a bare array and an array of strings, de-duplicating', () => {
    expect(extractModelIds([{ id: 'a' }, { id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
    expect(extractModelIds(['x', 'y'])).toEqual(['x', 'y']);
  });

  it('returns [] for unrecognized shapes', () => {
    expect(extractModelIds({})).toEqual([]);
    expect(extractModelIds(null)).toEqual([]);
    expect(extractModelIds('nope')).toEqual([]);
  });
});
