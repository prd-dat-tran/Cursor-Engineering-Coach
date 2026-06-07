---
id: pasted-code-over-references
name: Pasted Code Instead of File References
group: prompt-quality
severity: low
scope: requests
version: 1
tags: [context, files, paste, tokens]
thresholds:
  minPastedLoc: 40
  minSample: 10
  maxRatio: 0.2
---

# Description
Detects prompts that paste a large block of code inline while referencing no file. Cursor's agent reads files on demand, so pasting code that already lives in your repo is usually unnecessary: the pasted copy can go stale, it adds noise the agent has to reconcile against the real file, and on usage-based billing it is re-sent (and re-billed) every turn. Pointing the agent at the file instead lets it read the current version.

# When Triggered
{{count}} requests ({{pct}}) pasted {{thresholds.minPastedLoc}}+ lines of code inline without referencing any file. If that code is already in your repo, `@file` is shorter, always current, and cheaper.

# How to Improve
When the code is already in your codebase, reference it with `@file` (or `@folder`) instead of pasting — the agent reads the live version and you avoid stale copies. Reserve pasting for snippets that aren't in the repo (an error log, a doc excerpt, a design). For wider context, describe the area and let the agent search.

# Examples
{{sum(userCode, "loc")}} lines pasted: "{{messageText | truncate:50}}"

# Detection Logic
```detect
scan: requests
match: sum(userCode, "loc") >= thresholds.minPastedLoc AND length(referencedFiles) == 0
aggregate: ratio
check: ratio > thresholds.maxRatio AND count > thresholds.minSample
examples: {{sum(userCode, "loc")}} lines pasted: "{{messageText | truncate:50}}"
```

# Tests
```test
{userCode: [{language: "ts", loc: 60}], referencedFiles: []} -> triggered
{userCode: [{language: "ts", loc: 5}], referencedFiles: []} -> clean
{userCode: [{language: "ts", loc: 60}], referencedFiles: ["src/a.ts"]} -> clean
{userCode: [], referencedFiles: []} -> clean
```
