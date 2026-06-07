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
Create a skill for any multi-step workflow you repeat: run `/create-skill` in chat, or add a `.cursor/skills/<name>/SKILL.md` file. Invoke a skill with `/skill-name` (or attach it with `@skill-name`), and check skills into git so your team shares them.

# Examples
/create-skill - scaffold a new skill from a description
.cursor/skills/deploy-staging/SKILL.md - a reusable workflow

# Detection Logic
```detect
scan: requests
match: skillsUsed.length == 0
aggregate: count
check: count == total AND total > thresholds.minReqs
```
