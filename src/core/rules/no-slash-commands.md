---
id: no-slash-commands
name: No Slash Commands
group: tool-mastery
severity: low
scope: requests
requiresIdeContext: true
version: 1
tags: [tools, slash, commands]
thresholds:
  minRate: 0.02
  minReqs: 20
---

# Description
Detects low usage of slash commands. Custom commands and skills let you trigger a repeatable multi-step workflow with a single `/` instead of re-typing the same prompt every time.

# When Triggered
Only {{extra.withSlash}} of {{total}} requests use slash commands. Slash commands produce more targeted responses.

# How to Improve
Create reusable commands as Markdown files in `.cursor/commands/` for workflows you repeat (e.g. `/review`, `/pr`, `/fix-issue`) and check them into git so your team can use them. Run a skill with `/skill-name`, or scaffold one with `/create-skill`.

# Examples
/review - Run linters and summarize issues to fix
/pr - Commit, push, and open a pull request
/fix-issue 123 - Fetch an issue, implement a fix, open a PR

# Detection Logic
```detect
scan: requests
match: slashCommand == ""
aggregate: count
usageRate: (total - count) / total
withSlash: total - count
check: usageRate < thresholds.minRate AND total > thresholds.minReqs
```
