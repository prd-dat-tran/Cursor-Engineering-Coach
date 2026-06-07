---
id: no-plan-mode
name: Never Uses Plan Mode
group: tool-mastery
severity: medium
scope: requests
requiresIdeContext: true
version: 1
tags: [tools, planning, agent]
thresholds:
  minReqs: 30
  agentRate: 0.3
---

# Description
Detects heavy agentic usage with no use of plan mode, which helps the agent understand scope before implementation.

# When Triggered
{{extra.agenticReqs}} agentic requests but no use of plan mode. Jumping straight to implementation often leads to wrong approaches.

# How to Improve
Use Plan mode (press Shift+Tab in the agent input, or pick it from the mode dropdown) before complex tasks. Cursor researches the codebase, asks clarifying questions, and produces a reviewable plan — saved under `.cursor/plans/` — before any code is written. Edit the plan, then build from it.

# Examples
Press Shift+Tab to enter Plan mode before starting large features
Review and edit the generated plan, then build it when ready
Plan first, then build — Cursor suggests Plan mode automatically for complex tasks

# Detection Logic
```detect
scan: requests
match: agentMode == "agent" OR agentName != ""
aggregate: count
agentRatio: count / total
planUsage: someWhere(all, "agentMode", "matches", "(?i)plan") OR \
  someWhere(all, "slashCommand", "matches", "(?i)plan")
agenticReqs: count
check: planUsage == 0 AND total >= thresholds.minReqs AND agentRatio >= thresholds.agentRate
```
