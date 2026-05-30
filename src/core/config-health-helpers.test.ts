/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  scanConfigFiles,
  isCloudPath,
  analyzeHookCoverage,
  computeProgressiveDisclosureScore,
  computeInstructionQualityScore,
  generateWorkspaceSuggestions,
  safeFileExists,
  buildFileTree,
  readSnippet,
  resolveWorkspaceRoot,
} from './config-health-helpers';
import { ConfigFileInfo } from './types';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-engineering-coach-config-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveWorkspaceRoot', () => {
  it('uses the resolved root path when the activity workspace has one', () => {
    const root = makeTempDir();
    expect(resolveWorkspaceRoot('ws-1234', { id: 'ws-1234', name: 'proj', path: root })).toBe(root);
  });
});

describe('scanConfigFiles', () => {
  it('detects AGENTS.md at the workspace root', () => {
    const root = makeTempDir();
    writeFile(root, 'AGENTS.md', '# Project conventions\n\nUse TypeScript.');
    const files = scanConfigFiles(root);
    expect(files.some(f => f.kind === 'instruction' && f.relativePath === 'AGENTS.md')).toBe(true);
  });

  it('detects .cursorrules at the workspace root', () => {
    const root = makeTempDir();
    writeFile(root, '.cursorrules', 'Always prefer named exports.');
    const files = scanConfigFiles(root);
    expect(files.some(f => f.kind === 'instruction' && f.relativePath === '.cursorrules')).toBe(true);
  });

  it('detects scoped rules under .cursor/rules/', () => {
    const root = makeTempDir();
    writeFile(root, '.cursor/rules/react.md', '# React rules\n\nUse hooks.');
    const files = scanConfigFiles(root);
    expect(files.some(f => f.kind === 'instruction' && f.relativePath.includes('react.md'))).toBe(true);
  });

  it('detects skills under .cursor/skills/', () => {
    const root = makeTempDir();
    writeFile(root, '.cursor/skills/my-skill/SKILL.md', '# Skill\n\nDo things.');
    const files = scanConfigFiles(root);
    expect(files.some(f => f.kind === 'skill')).toBe(true);
  });

  it('does not include personal skill files in per-workspace scans', () => {
    const root = makeTempDir();
    const home = makeTempDir();
    const prevHome = process.env.HOME;

    try {
      process.env.HOME = home;
      writeFile(home, '.cursor/skills/test-skill/SKILL.md', '# Personal skill');

      const files = scanConfigFiles(root);
      expect(files.some(file => file.kind === 'skill')).toBe(false);
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it('marks oversized instruction files', () => {
    const root = makeTempDir();
    const longContent = '# Title\n' + 'x\n'.repeat(600);
    writeFile(root, 'AGENTS.md', longContent);
    const files = scanConfigFiles(root);
    const instrFile = files.find(f => f.relativePath === 'AGENTS.md');
    expect(instrFile).toBeDefined();
    expect(instrFile!.sizeVerdict).toBe('oversized');
  });
});

describe('isCloudPath', () => {
  it('returns true for OneDrive paths', () => {
    expect(isCloudPath('/Users/me/OneDrive/project')).toBe(true);
  });
  it('returns true for Dropbox paths', () => {
    expect(isCloudPath('/Users/me/Dropbox/project')).toBe(true);
  });
  it('returns true for iCloud paths', () => {
    expect(isCloudPath('/Users/me/Library/Mobile Documents/iCloud~com~apple/project')).toBe(true);
  });
  it('returns false for local paths', () => {
    expect(isCloudPath('/Users/me/projects/my-app')).toBe(false);
  });
});

describe('analyzeHookCoverage', () => {
  it('returns null when .cursor/hooks.json does not exist', () => {
    const root = makeTempDir();
    expect(analyzeHookCoverage(root)).toBeNull();
  });

  it('detects camelCase Cursor hook events', () => {
    const root = makeTempDir();
    writeFile(root, '.cursor/hooks.json', JSON.stringify({
      hooks: {
        beforeToolUse: [{ command: 'echo pre' }],
        afterToolUse: [{ command: 'echo post' }],
      },
    }));
    const result = analyzeHookCoverage(root);
    expect(result).not.toBeNull();
    expect(result!.hasPreToolUse).toBe(true);
    expect(result!.hasPostToolUse).toBe(true);
    expect(result!.totalHooks).toBe(2);
    expect(result!.hookEvents).toContain('beforeToolUse');
  });

  it('recognizes legacy PascalCase hook events for back-compat', () => {
    const root = makeTempDir();
    writeFile(root, '.cursor/hooks.json', JSON.stringify({
      hooks: {
        PreToolUse: [{ command: 'echo pre' }],
        SessionStart: [{ command: 'echo session' }],
      },
    }));
    const result = analyzeHookCoverage(root);
    expect(result).not.toBeNull();
    expect(result!.hasPreToolUse).toBe(true);
    expect(result!.hasSessionStart).toBe(true);
  });
});

describe('computeProgressiveDisclosureScore', () => {
  it('returns 0 for empty files list', () => {
    expect(computeProgressiveDisclosureScore([])).toBe(0);
  });

  it('gives 25 points for having instructions', () => {
    const files: ConfigFileInfo[] = [
      { relativePath: 'AGENTS.md', kind: 'instruction', lines: 10, chars: 100, isMarkdown: true, markdownIssues: [], sizeVerdict: 'compact', lastModified: null },
    ];
    expect(computeProgressiveDisclosureScore(files)).toBeGreaterThanOrEqual(25);
  });

  it('gives max score for comprehensive setup', () => {
    const files: ConfigFileInfo[] = [
      { relativePath: 'AGENTS.md', kind: 'instruction', lines: 10, chars: 100, isMarkdown: true, markdownIssues: [], sizeVerdict: 'compact', lastModified: null },
      { relativePath: '.cursor/rules/ts.md', kind: 'instruction', lines: 10, chars: 80, isMarkdown: true, markdownIssues: [], sizeVerdict: 'compact', lastModified: null },
      { relativePath: '.cursor/rules/py.md', kind: 'instruction', lines: 10, chars: 80, isMarkdown: true, markdownIssues: [], sizeVerdict: 'compact', lastModified: null },
      { relativePath: '.cursor/skills/lint/SKILL.md', kind: 'skill', lines: 20, chars: 200, isMarkdown: true, markdownIssues: [], sizeVerdict: 'compact', lastModified: null },
    ];
    expect(computeProgressiveDisclosureScore(files)).toBe(100);
  });
});

describe('computeInstructionQualityScore', () => {
  it('returns 0 when no markdown files', () => {
    expect(computeInstructionQualityScore([])).toBe(0);
  });

  it('returns 100 for a perfect compact file with no issues', () => {
    const files: ConfigFileInfo[] = [
      { relativePath: 'file.md', kind: 'instruction', lines: 20, chars: 200, isMarkdown: true, markdownIssues: [], sizeVerdict: 'compact', lastModified: null },
    ];
    expect(computeInstructionQualityScore(files)).toBe(100);
  });

  it('penalizes oversized files', () => {
    const files: ConfigFileInfo[] = [
      { relativePath: 'file.md', kind: 'instruction', lines: 600, chars: 6000, isMarkdown: true, markdownIssues: [], sizeVerdict: 'oversized', lastModified: null },
    ];
    expect(computeInstructionQualityScore(files)).toBe(70);
  });

  it('penalizes markdown issues', () => {
    const files: ConfigFileInfo[] = [
      { relativePath: 'file.md', kind: 'instruction', lines: 20, chars: 200, isMarkdown: true, markdownIssues: ['issue1', 'issue2'], sizeVerdict: 'compact', lastModified: null },
    ];
    expect(computeInstructionQualityScore(files)).toBe(70);
  });
});

describe('generateWorkspaceSuggestions', () => {
  it('suggests creating instructions when none exist', () => {
    const suggestions = generateWorkspaceSuggestions([], null, false);
    expect(suggestions.some(s => s.includes('AGENTS.md') || s.includes('.cursor/rules'))).toBe(true);
  });

  it('suggests configuring hooks when no .cursor/hooks.json is present', () => {
    const files: ConfigFileInfo[] = [
      { relativePath: 'AGENTS.md', kind: 'instruction', lines: 10, chars: 100, isMarkdown: true, markdownIssues: [], sizeVerdict: 'compact', lastModified: null },
    ];
    const suggestions = generateWorkspaceSuggestions(files, null, false);
    expect(suggestions.some(s => s.includes('hooks'))).toBe(true);
  });

  it('suggests splitting oversized instruction files', () => {
    const files: ConfigFileInfo[] = [
      { relativePath: 'AGENTS.md', kind: 'instruction', lines: 600, chars: 6000, isMarkdown: true, markdownIssues: [], sizeVerdict: 'oversized', lastModified: null },
    ];
    const suggestions = generateWorkspaceSuggestions(files, null, false);
    expect(suggestions.some(s => s.includes('600 lines'))).toBe(true);
  });
});

describe('safeFileExists', () => {
  it('returns true for existing files', () => {
    const root = makeTempDir();
    writeFile(root, 'test.txt', 'hi');
    expect(safeFileExists(path.join(root, 'test.txt'))).toBe(true);
  });

  it('returns false for non-existent paths', () => {
    expect(safeFileExists('/nonexistent/path/file.txt')).toBe(false);
  });

  it('returns false for directories', () => {
    const root = makeTempDir();
    expect(safeFileExists(root)).toBe(false);
  });
});

describe('buildFileTree', () => {
  it('lists files and dirs with indentation', () => {
    const root = makeTempDir();
    writeFile(root, 'src/main.ts', 'export {}');
    writeFile(root, 'README.md', '# Hello');
    const tree = buildFileTree(root, 2, 100);
    expect(tree).toContain('README.md');
    expect(tree).toContain('src/');
    expect(tree).toContain('main.ts');
  });

  it('respects maxEntries', () => {
    const root = makeTempDir();
    for (let i = 0; i < 10; i++) writeFile(root, `file${i}.txt`, 'x');
    const tree = buildFileTree(root, 1, 5);
    const lines = tree.split('\n');
    expect(lines.length).toBeLessThanOrEqual(6); // 5 + possible "..."
  });

  it('excludes node_modules', () => {
    const root = makeTempDir();
    writeFile(root, 'node_modules/pkg/index.js', 'x');
    writeFile(root, 'src/app.ts', 'x');
    const tree = buildFileTree(root, 2, 100);
    expect(tree).not.toContain('node_modules');
    expect(tree).toContain('src/');
  });
});

describe('readSnippet', () => {
  it('reads first matching candidate', () => {
    const root = makeTempDir();
    writeFile(root, 'package.json', '{"name":"test"}');
    const snippet = readSnippet(root, ['missing.json', 'package.json'], 100);
    expect(snippet).toContain('"name"');
  });

  it('returns empty string when no candidates exist', () => {
    const root = makeTempDir();
    expect(readSnippet(root, ['nope.txt'], 100)).toBe('');
  });

  it('truncates to maxChars', () => {
    const root = makeTempDir();
    writeFile(root, 'big.txt', 'x'.repeat(1000));
    const snippet = readSnippet(root, ['big.txt'], 50);
    expect(snippet.length).toBe(50);
  });
});
