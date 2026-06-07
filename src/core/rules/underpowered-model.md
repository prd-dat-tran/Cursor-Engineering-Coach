---
id: underpowered-model
name: Underpowered Model on Flat-Rate Billing
group: tool-mastery
severity: medium
scope: requests
billing: request-based
version: 1
tags: [model, request-billing, capability]
thresholds:
  maxLightShare: 0.4
  minSample: 20
---

# Description
On request-based billing every request costs the same flat amount regardless of which model handles it. This rule detects heavy reliance on lightweight or auto-routed models, where you trade away capability for savings that do not exist under flat-rate billing.

# When Triggered
{{count}} requests ({{pct}}) used a lightweight or auto-routed model. On request-based billing a weaker model costs exactly the same as the most capable one — you are leaving quality on the table for no savings.

# How to Improve
Set your default to the most capable model available (e.g. Claude Opus 4.8, GPT-5.5, or the latest frontier model) and let it handle everything. Only drop to a lighter model when you specifically need lower latency, not to save cost. Because each request is a flat charge, the win comes from landing tasks in fewer, higher-quality requests — not from picking a cheaper model.

# Examples
{{normalizeModel(modelId)}}: "{{messageText | truncate:50}}"

# Detection Logic
```detect
scan: requests
match: modelId != "" AND (matches(modelId, "(?i)auto") OR (modelTier(modelId) > 0 AND modelTier(modelId) < 1))
aggregate: ratio
check: ratio > thresholds.maxLightShare AND count > thresholds.minSample
examples: {{normalizeModel(modelId)}}: "{{messageText | truncate:50}}"
```
