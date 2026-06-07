---
id: model-overreliance
name: Model Overreliance
group: tool-mastery
severity: medium
scope: requests
billing: usage-based
version: 1
tags: [tools, model, diversity]
thresholds:
  maxTopModelRate: 0.8
  minSample: 10
  minModels: 3
---

# Description
Detects when the vast majority of requests use a single model, missing opportunities to use lighter models for simple tasks.

# When Triggered
{{pct}} of requests use {{extra.topModel}}. Different tasks benefit from different models.

# How to Improve
Let Auto pick for everyday work, or run Cursor's own Composer 2.5 — both draw from Cursor's cheaper included usage pool. Reserve a pinned frontier model (Claude Opus/Sonnet, GPT-5.x) for hard reasoning, and drop to a lightweight model (GPT-5 Mini, Gemini Flash, Claude Haiku) for simple lookups and boilerplate.

# Examples
{{extra.model}}: {{extra.reqCount}} requests

# Detection Logic
```detect
scan: requests
match: true
aggregate: count
models: modelStats(allReqs)
emitCount: models.topCount
emitTotal: models.total
topModel: models.topModel
check: models.topShare > thresholds.maxTopModelRate AND models.modelCount < thresholds.minModels AND models.total > thresholds.minSample
```
