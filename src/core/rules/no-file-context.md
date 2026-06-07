---
id: no-file-context
name: Missing File Context
group: prompt-quality
severity: medium
scope: requests
requiresIdeContext: true
version: 1
tags: [prompt, context, files]
thresholds:
  maxNoContextRate: 0.7
  minSample: 10
---

# Description
Detects requests that almost never reference a specific file. Cursor's agent can find context on its own (grep + semantic search), but when you already know the exact file, pointing the agent at it is faster and more precise than making it search.

# When Triggered
{{pct}} of requests reference no specific file. When you know where the work is, naming the file gets the agent there in one step instead of searching for it.

# How to Improve
When you already know the file, use `@file` (or open it in the editor) so the agent starts in the right place. When you don't, skip the guessing — describe the goal clearly and let the agent search the codebase. Avoid bulk-attaching files you're unsure about; that just adds noise.

# Examples
"{{message}}..."

# Detection Logic
```detect
scan: requests
match: referencedFiles.length == 0 AND editedFiles.length == 0
aggregate: ratio
check: ratio > thresholds.maxNoContextRate AND count > thresholds.minSample
examples: "{{messageText | clip:80}}"
```
