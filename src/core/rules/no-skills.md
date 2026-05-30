---
id: no-skills
name: No Skills Usage
group: tool-mastery
severity: low
scope: requests
requiresIdeContext: true
version: 1
tags: [tools, skills, domain]
thresholds:
  minReqs: 50
---

# Description
Detects when no requests use Cursor skills, missing out on specialized domain knowledge.

# When Triggered
No requests use Cursor skills. Skills provide specialized domain knowledge beyond general coding.

# How to Improve
Explore available skills in Cursor. Skills can help with specific frameworks, cloud providers, and development workflows. Drop reusable instructions into `.cursor/rules/` or `.cursor/skills/`.

# Examples
Skills extend Cursor with domain expertise
Check the Cursor community catalog for available skills

# Detection Logic
```detect
scan: requests
match: skillsUsed.length == 0
aggregate: count
check: count == total AND total > thresholds.minReqs
```
