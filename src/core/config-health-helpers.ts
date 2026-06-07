/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Config health scanning and scoring helpers. */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigFileInfo, HookCoverageInfo, Workspace } from './types';
import { fileUriToPath } from './helpers';
import {
  OVERSIZED_INSTRUCTION_LINES,
  CURSOR_RULE_FILE_MAX_CHARS,
} from './constants';

interface FilePattern {
  relativePath: string;
  kind: ConfigFileInfo['kind'];
  isDir?: boolean;
  dirGlob?: RegExp;
  recurse?: boolean;
  fileValidator?: (fullPath: string, relativePath: string) => boolean;
  skipWhenRootIsHome?: boolean;
}

const KNOWN_FILES: FilePattern[] = [
  { relativePath: 'AGENTS.md', kind: 'instruction' },
  { relativePath: '.cursorrules', kind: 'instruction' },
  { relativePath: '.cursor/rules', kind: 'instruction', isDir: true, dirGlob: /\.mdc?$/i, recurse: true },
  { relativePath: '.cursor/skills', kind: 'skill', isDir: true, dirGlob: /SKILL\.md$/i, recurse: true },
  { relativePath: '.cursor/hooks.json', kind: 'hook-config' },
  { relativePath: '.cursor/mcp.json', kind: 'other' },
];

const CLOUD_PATH_PATTERNS = [
  /onedrive/i,
  /google\s*drive/i,
  /dropbox/i,
  /icloud/i,
  /\.cloudstorage/i,
  /CloudStorage/,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

function firstStringProperty(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return '';
}

export function resolveWorkspaceRoot(_id: string, ws: Workspace): string | null {
  // Cursor workspaces use the same workspaceStorage layout as VS Code: each
  // storage directory contains a workspace.json with a `folder` URI pointing to
  // the project root. Fall back to the path the parser already resolved if the
  // workspace.json is missing or stale.
  return resolveVsCodeRoot(ws.path) ?? (fs.existsSync(ws.path) ? ws.path : null);
}

function resolveVsCodeRoot(storagePath: string): string | null {
  const wsJson = path.join(storagePath, 'workspace.json');
  const data = readJsonFile(wsJson);
  if (!isRecord(data)) return null;
  const raw = firstStringProperty(data, 'folder', 'workspace');
  const decoded = fileUriToPath(raw).replace(/\/+$/, '');
  return decoded && fs.existsSync(decoded) ? decoded : null;
}

export function isCloudPath(p: string): boolean {
  return CLOUD_PATH_PATTERNS.some(re => re.test(p));
}

export function scanConfigFiles(rootPath: string): ConfigFileInfo[] {
  const files: ConfigFileInfo[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const rootIsHome = home !== '' && path.resolve(rootPath) === path.resolve(home);

  for (const pattern of KNOWN_FILES) {
    if (pattern.skipWhenRootIsHome && rootIsHome) continue;
    const fullPath = path.join(rootPath, pattern.relativePath);
    if (pattern.isDir) {
      files.push(...scanDirectoryPattern(fullPath, pattern));
      continue;
    }
    const file = scanSingleFilePattern(fullPath, pattern);
    if (file) files.push(file);
  }

  return dedupeConfigFiles(files);
}

function scanDirectoryPattern(fullPath: string, pattern: FilePattern): ConfigFileInfo[] {
  try {
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) return [];
    if (pattern.recurse) {
      const files: ConfigFileInfo[] = [];
      scanDirRecursive(fullPath, pattern.relativePath, pattern.kind, pattern.dirGlob, files, 4, pattern.fileValidator);
      return files;
    }
    return scanFlatDirectory(fullPath, pattern);
  } catch {
    return [];
  }
}

function scanFlatDirectory(fullPath: string, pattern: FilePattern): ConfigFileInfo[] {
  const files: ConfigFileInfo[] = [];
  for (const entry of fs.readdirSync(fullPath)) {
    const analyzed = scanFlatDirectoryEntry(fullPath, pattern, entry);
    if (analyzed) files.push(analyzed);
  }
  return files;
}

function scanFlatDirectoryEntry(fullPath: string, pattern: FilePattern, entry: string): ConfigFileInfo | null {
  if (pattern.dirGlob && !pattern.dirGlob.test(entry)) return null;
  const filePath = path.join(fullPath, entry);
  if (!fs.statSync(filePath).isFile()) return null;
  const fileRelative = path.join(pattern.relativePath, entry);
  if (pattern.fileValidator && !pattern.fileValidator(filePath, fileRelative)) return null;
  return analyzeFile(filePath, fileRelative, pattern.kind);
}

function scanSingleFilePattern(fullPath: string, pattern: FilePattern): ConfigFileInfo | null {
  try {
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
    return analyzeFile(fullPath, pattern.relativePath, pattern.kind);
  } catch {
    return null;
  }
}

function scanDirRecursive(
  fullPath: string,
  relativeBase: string,
  kind: ConfigFileInfo['kind'],
  dirGlob: RegExp | undefined,
  files: ConfigFileInfo[],
  depth: number,
  fileValidator?: (fullPath: string, relativePath: string) => boolean,
): void {
  if (depth < 0) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fullPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childPath = path.join(fullPath, entry.name);
    const childRelative = path.join(relativeBase, entry.name);
    if (entry.isDirectory()) {
      scanDirRecursive(childPath, childRelative, kind, dirGlob, files, depth - 1, fileValidator);
      continue;
    }
    if (!entry.isFile()) continue;
    if (dirGlob && !dirGlob.test(entry.name)) continue;
    if (fileValidator && !fileValidator(childPath, childRelative)) continue;
    files.push(analyzeFile(childPath, childRelative, kind));
  }
}

export function scanPersonalSkillFiles(): ConfigFileInfo[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return [];
  const files: ConfigFileInfo[] = [];
  // Cursor stores user-level skills under ~/.cursor/skills/<name>/SKILL.md
  // (alongside ~/.cursor/rules/ and ~/.cursor-engineering-coach/).
  const roots = [
    path.join(home, '.cursor', 'skills'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    scanDirRecursive(root, root.replace(home + path.sep, '~/'), 'skill', /SKILL\.md$/i, files, 4);
  }
  return files;
}

function dedupeConfigFiles(files: ConfigFileInfo[]): ConfigFileInfo[] {
  const seen = new Set<string>();
  const deduped: ConfigFileInfo[] = [];
  for (const file of files) {
    const key = `${file.kind}:${file.relativePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(file);
  }
  return deduped;
}

function analyzeFile(fullPath: string, relativePath: string, kind: ConfigFileInfo['kind']): ConfigFileInfo {
  const content = fs.readFileSync(fullPath, 'utf-8');
  let lastModified: number | null = null;
  try { lastModified = fs.statSync(fullPath).mtimeMs; } catch { /* ignore */ }
  const lines = content.split('\n').length;
  const chars = content.length;
  const isMarkdown = /\.md$/i.test(fullPath);
  const markdownIssues = isMarkdown ? checkMarkdownQuality(content, relativePath) : [];

  let sizeVerdict: ConfigFileInfo['sizeVerdict'] = 'compact';
  if (lines > OVERSIZED_INSTRUCTION_LINES) {
    sizeVerdict = 'oversized';
  } else if (lines > 150) {
    sizeVerdict = 'moderate';
  }

  if (isCursorRuleFile(relativePath) && chars > CURSOR_RULE_FILE_MAX_CHARS) {
    sizeVerdict = 'oversized';
  }

  return { relativePath, kind, lines, chars, isMarkdown, markdownIssues, sizeVerdict, lastModified };
}

function checkMarkdownQuality(content: string, relativePath: string): string[] {
  const issues: string[] = [];
  const lines = content.split('\n');

  const firstNonEmpty = lines.find(l => l.trim().length > 0);
  if (firstNonEmpty && !/^#/.test(firstNonEmpty) && !/^---/.test(firstNonEmpty)) {
    issues.push('File should start with a markdown heading (# Title) or YAML frontmatter (---)');
  }

  const headingCount = lines.filter(l => /^#{1,4}\s/.test(l)).length;
  if (lines.length > 30 && headingCount < 2) {
    issues.push('Long file lacks section headings -- use ## sections to organize instructions');
  }

  const instructionLines = lines.filter(l => l.trim().length > 10 && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('---'));
  const imperativeRe = /^[-*]?\s*(Use|Do|Don't|Always|Never|Ensure|Check|Avoid|Prefer|Write|Follow|Include|Exclude|Run|Test|Create|Add|Remove|Set|Keep|Limit|Apply)/i;
  const imperativeCount = instructionLines.filter(l => imperativeRe.test(l.trim())).length;
  if (instructionLines.length > 5 && imperativeCount === 0) {
    issues.push('Instructions should use imperative phrasing (e.g., "Use TypeScript", "Avoid class components")');
  }

  const conditionalCount = lines.filter(l => /\bif\b.*\bthen\b/i.test(l) || /\bwhen\b.*\bdo\b/i.test(l)).length;
  if (conditionalCount >= 3) {
    issues.push(`${conditionalCount} conditional if/then chains detected -- LLMs handle flat, imperative rules better than nested conditions`);
  }

  const fenceOpens = content.match(/^```/gm)?.length || 0;
  if (fenceOpens % 2 !== 0) {
    issues.push('Unclosed code block (```) detected -- ensure all code fences are properly paired');
  }

  if (isCursorRuleFile(relativePath) && content.length > CURSOR_RULE_FILE_MAX_CHARS) {
    issues.push(`File exceeds ${CURSOR_RULE_FILE_MAX_CHARS} characters -- Cursor truncates oversized rule files and they bloat every request's context window. Split scoped rules into .cursor/rules/<topic>.mdc files.`);
  }

  return issues;
}

function isCursorRuleFile(relativePath: string): boolean {
  return (
    relativePath === 'AGENTS.md' ||
    relativePath === '.cursorrules' ||
    relativePath.startsWith('.cursor/rules/')
  );
}

export function analyzeHookCoverage(rootPath: string): HookCoverageInfo | null {
  const hooksPath = path.join(rootPath, '.cursor', 'hooks.json');
  if (!fs.existsSync(hooksPath)) return null;

  const data = readJsonFile(hooksPath);
  if (!isRecord(data) || !isRecord(data.hooks)) return null;

  const hookEvents: string[] = [];
  for (const event of Object.keys(data.hooks)) {
    if (!hookEvents.includes(event)) hookEvents.push(event);
  }
  if (hookEvents.length === 0) return null;

  // Cursor uses camelCase event names (beforeToolUse / afterToolUse / sessionStart),
  // but we still recognize legacy PascalCase names for forward-compatibility with
  // configs that were migrated from other AI tools.
  const has = (name: string): boolean =>
    hookEvents.some(e => e.toLowerCase() === name.toLowerCase());

  return {
    hasPreToolUse: has('beforeToolUse') || has('PreToolUse'),
    hasPostToolUse: has('afterToolUse') || has('PostToolUse'),
    hasSessionStart: has('sessionStart') || has('SessionStart'),
    hasPermissionRequest: has('permissionRequest') || has('PermissionRequest'),
    totalHooks: hookEvents.length,
    hookEvents,
  };
}

export function computeProgressiveDisclosureScore(files: ConfigFileInfo[]): number {
  let score = 0;

  const instructionFiles = files.filter(f => f.kind === 'instruction');
  if (instructionFiles.length > 0) score += 25;

  const allCompact = instructionFiles.length > 0 && instructionFiles.every(f => f.sizeVerdict !== 'oversized');
  if (allCompact && instructionFiles.length > 0) score += 25;
  else if (instructionFiles.some(f => f.sizeVerdict === 'moderate')) score += 10;

  const hasSkills = files.some(f => f.kind === 'skill');
  if (hasSkills) score += 25;

  // Scoped rules under .cursor/rules/ act as the progressive-disclosure layer
  // (per-domain or per-folder rules rather than one giant AGENTS.md).
  const scopedRuleFiles = files.filter(f => f.kind === 'instruction' && f.relativePath.startsWith('.cursor/rules/'));
  if (scopedRuleFiles.length >= 2 || (hasSkills && scopedRuleFiles.length >= 1)) score += 25;
  else if (scopedRuleFiles.length >= 1) score += 10;

  return score;
}

export function computeInstructionQualityScore(files: ConfigFileInfo[]): number {
  const mdFiles = files.filter(f => f.isMarkdown);
  if (mdFiles.length === 0) return 0;

  let totalScore = 0;
  for (const f of mdFiles) {
    let fileScore = 100;
    if (f.sizeVerdict === 'oversized') fileScore -= 30;
    else if (f.sizeVerdict === 'moderate') fileScore -= 10;
    fileScore -= Math.min(45, f.markdownIssues.length * 15);
    totalScore += Math.max(0, fileScore);
  }

  return Math.round(totalScore / mdFiles.length);
}

export function generateWorkspaceSuggestions(
  files: ConfigFileInfo[],
  hookCoverage: HookCoverageInfo | null,
  _isLegacyClaudeWorkspace: boolean,
): string[] {
  const suggestions: string[] = [];

  const hasAnyInstructions = files.some(f => f.kind === 'instruction');
  if (!hasAnyInstructions) {
    suggestions.push('Create an AGENTS.md (or .cursor/rules/*.md) file with project conventions -- this is the single most impactful context file Cursor will inject into every chat.');
  }

  for (const f of files) {
    if (f.sizeVerdict === 'oversized') {
      if (f.kind === 'instruction' && f.lines > OVERSIZED_INSTRUCTION_LINES) {
        suggestions.push(`${f.relativePath} has ${f.lines} lines -- split domain-specific rules into .cursor/rules/<topic>.md files or .cursor/skills/<name>/SKILL.md for progressive disclosure.`);
      } else if (isCursorRuleFile(f.relativePath) && f.chars > CURSOR_RULE_FILE_MAX_CHARS) {
        suggestions.push(`${f.relativePath} exceeds ${CURSOR_RULE_FILE_MAX_CHARS} chars -- oversized rule files bloat every Cursor request. Move scoped rules to .cursor/rules/<topic>.md.`);
      }
    }
  }

  for (const f of files) {
    if (f.markdownIssues.length > 0) suggestions.push(`${f.relativePath}: ${f.markdownIssues[0]}`);
  }

  const hasSkills = files.some(f => f.kind === 'skill');
  if (!hasSkills && files.some(f => f.kind === 'instruction' && f.lines > 100)) {
    suggestions.push('Consider extracting domain-specific knowledge into .cursor/skills/<name>/SKILL.md files. Skills use progressive disclosure: only the name/description is loaded initially, full instructions load only when matched.');
  }

  if (!hookCoverage) {
    suggestions.push('No hooks configured in .cursor/hooks.json. Hooks enforce deterministic boundaries: beforeToolUse for security (block sensitive file edits), afterToolUse for auto-formatting (Prettier, Ruff).');
  } else {
    if (!hookCoverage.hasPreToolUse) suggestions.push('Add a beforeToolUse hook to enforce security boundaries (e.g., block edits to .env, migrations/, or .git/ files).');
    if (!hookCoverage.hasPostToolUse) suggestions.push('Add an afterToolUse hook for auto-formatting (run Prettier/Ruff after file writes) and audit logging.');
  }

  return suggestions;
}

export function safeFileExists(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
}

export function buildFileTree(rootPath: string, maxDepth: number, maxEntries: number): string {
  const lines: string[] = [];

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > maxDepth || lines.length >= maxEntries) return;
    let entries: string[];
    try { entries = fs.readdirSync(dir).sort(); } catch { return; }
    entries = entries.filter(e => !['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', '.next', 'target', 'vendor'].includes(e));
    for (const entry of entries) {
      if (lines.length >= maxEntries) { lines.push(prefix + '...'); return; }
      const full = path.join(dir, entry);
      let isDir: boolean;
      try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
      lines.push(prefix + (isDir ? entry + '/' : entry));
      if (isDir) walk(full, prefix + '  ', depth + 1);
    }
  }

  walk(rootPath, '', 0);
  return lines.join('\n');
}

export function readSnippet(rootPath: string, candidates: string[], maxChars: number): string {
  for (const name of candidates) {
    const fullPath = path.join(rootPath, name);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fs.readFileSync(fullPath, 'utf-8').slice(0, maxChars);
      }
    } catch { /* skip */ }
  }
  return '';
}
