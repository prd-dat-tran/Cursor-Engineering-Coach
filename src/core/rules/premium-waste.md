---
id: premium-waste
name: Premium Model Waste
group: tool-mastery
severity: medium
scope: requests
billing: usage-based
version: 1
tags: [tools, model, waste, premium]
thresholds:
  minSample: 10
  maxMessageLength: 50
---

# Description
Detects simple requests (short prompt, no code output) that use premium models unnecessarily.

# When Triggered
{{count}} simple requests (short prompt, no code output) used premium models.

# How to Improve
Let Auto handle quick questions and simple tasks, or pick a lightweight model (GPT-5 Mini, Gemini Flash, Claude Haiku). On usage-based billing, Auto and Composer 2.5 draw from Cursor's cheaper pool — reserve frontier models for complex code generation.

# Examples
{{extra.model}}: "{{message}}..."

# Detection Logic
```detect
scan: requests
match: modelTier(modelId) >= 1 AND messageLength < thresholds.maxMessageLength AND messageLength > 0 AND aiCode.length == 0
aggregate: count
check: count > thresholds.minSample
examples: {{normalizeModel(modelId)}}: "{{messageText | truncate:50}}"
```
