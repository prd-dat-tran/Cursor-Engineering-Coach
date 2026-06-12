/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildChatBody, extractContent, joinUrl, toOpenAiMessages } from './llm-request';

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
