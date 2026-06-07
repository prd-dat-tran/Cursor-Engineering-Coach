---
id: light-model-on-complex-work
name: Light Model on Complex Work
group: tool-mastery
severity: medium
scope: requests
billing: usage-based
version: 1
tags: [model, capability, quality, usage-billing]
thresholds:
  minSample: 15
  maxShare: 0.3
  minToolCalls: 2
  minMessageLength: 200
---

# Description
On usage-based (token) billing it is tempting to default to a lightweight model to save money. But routing complex, multi-step work — long prompts that drive several tool calls and real edits — to an under-powered model often backfires: weaker reasoning produces wrong edits, more correction turns, and rework that burns more tokens than a capable model would have. This rule flags complex requests handled by a lightweight model.

# When Triggered
{{count}} complex requests ({{pct}}) — long prompts with multiple tool calls — ran on a lightweight model. The token savings on hard tasks are usually erased by correction turns and rework.

# How to Improve
Keep lightweight models for lookups, quick questions, and small edits. For complex, multi-file work — features, refactors, and debugging — switch to a standard or frontier model (e.g. Claude Sonnet/Opus or the latest GPT-5.x) so it lands correctly the first time. Use Plan mode to scope a big task first, then hand the plan to a capable model. The Models page shows which of your models fit which work.

# Examples
{{normalizeModel(modelId)}}: "{{messageText | truncate:50}}"

# Detection Logic
```detect
scan: requests
match: modelId != "" AND modelTier(modelId) > 0 AND modelTier(modelId) < 1 AND length(toolsUsed) >= thresholds.minToolCalls AND messageLength > thresholds.minMessageLength
aggregate: ratio
check: ratio > thresholds.maxShare AND count > thresholds.minSample
examples: {{normalizeModel(modelId)}}: "{{messageText | truncate:50}}"
```
