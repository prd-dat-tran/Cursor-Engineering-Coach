/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { tokenizeInline, splitBlocks } from './markdown';

describe('tokenizeInline', () => {
  it('returns a single text token for plain prose', () => {
    expect(tokenizeInline('just plain words')).toEqual([
      { kind: 'text', value: 'just plain words' },
    ]);
  });

  it('extracts inline code spans (the reported anti-pattern copy)', () => {
    const tokens = tokenizeInline('add an `AGENTS.md` or `.cursor/rules/*.mdc` file');
    expect(tokens).toEqual([
      { kind: 'text', value: 'add an ' },
      { kind: 'code', value: 'AGENTS.md' },
      { kind: 'text', value: ' or ' },
      { kind: 'code', value: '.cursor/rules/*.mdc' },
      { kind: 'text', value: ' file' },
    ]);
  });

  it('parses bold and italic', () => {
    expect(tokenizeInline('**Plan mode**')).toEqual([{ kind: 'strong', value: 'Plan mode' }]);
    expect(tokenizeInline('*soft*')).toEqual([{ kind: 'em', value: 'soft' }]);
    expect(tokenizeInline('_soft_')).toEqual([{ kind: 'em', value: 'soft' }]);
  });

  it('links only safe http/https/mailto targets, otherwise keeps literal text', () => {
    expect(tokenizeInline('[docs](https://cursor.com)')).toEqual([
      { kind: 'link', value: 'docs', href: 'https://cursor.com' },
    ]);
    const unsafe = tokenizeInline('[x](javascript:alert(1))');
    expect(unsafe.every((t) => t.kind === 'text')).toBe(true);
  });

  it('does not treat a lone backtick or bullet asterisk as markup', () => {
    expect(tokenizeInline('use ` carefully')).toEqual([{ kind: 'text', value: 'use ` carefully' }]);
    expect(tokenizeInline('5 * 3 = 15')).toEqual([{ kind: 'text', value: '5 * 3 = 15' }]);
  });

  it('handles code that contains slashes, dots and angle brackets verbatim', () => {
    expect(tokenizeInline('create `.cursor/skills/<name>/SKILL.md`')).toEqual([
      { kind: 'text', value: 'create ' },
      { kind: 'code', value: '.cursor/skills/<name>/SKILL.md' },
    ]);
  });
});

describe('splitBlocks', () => {
  it('joins a soft-wrapped single paragraph into one block', () => {
    expect(splitBlocks('line one\nline two')).toEqual([
      { kind: 'p', items: ['line one line two'] },
    ]);
  });

  it('groups consecutive bullet lines into one list after a paragraph', () => {
    expect(splitBlocks('Intro:\n- first\n- second')).toEqual([
      { kind: 'p', items: ['Intro:'] },
      { kind: 'ul', items: ['first', 'second'] },
    ]);
  });

  it('parses numbered lists separately from bullets', () => {
    expect(splitBlocks('1. step one\n2. step two')).toEqual([
      { kind: 'ol', items: ['step one', 'step two'] },
    ]);
  });

  it('starts a new paragraph after a blank line', () => {
    expect(splitBlocks('para one\n\npara two')).toEqual([
      { kind: 'p', items: ['para one'] },
      { kind: 'p', items: ['para two'] },
    ]);
  });

  it('captures fenced code blocks verbatim (AI explainer output)', () => {
    expect(splitBlocks('intro\n```bash\nnpm i\n```\nafter')).toEqual([
      { kind: 'p', items: ['intro'] },
      { kind: 'pre', items: ['npm i'] },
      { kind: 'p', items: ['after'] },
    ]);
  });

  it('parses ATX headings with their level', () => {
    expect(splitBlocks('## Switch to Auto routing\nbody text')).toEqual([
      { kind: 'h', items: ['Switch to Auto routing'], level: 2 },
      { kind: 'p', items: ['body text'] },
    ]);
  });

  it('keeps bold + inline code inside bullets (the reported Improve output)', () => {
    expect(splitBlocks('* **Switch to Auto routing**: use `Cmd+L`\n* **Reserve premium power**')).toEqual([
      { kind: 'ul', items: ['**Switch to Auto routing**: use `Cmd+L`', '**Reserve premium power**'] },
    ]);
  });
});
