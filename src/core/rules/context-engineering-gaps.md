---
id: context-engineering-gaps
name: Context Engineering Gaps
group: prompt-quality
severity: medium
scope: both
version: 1
tags: [context, agents, skills, mcp, instructions]
thresholds:
  minReqs: 30
  fileRefMinRate: 0.1
  instructionMinRate: 0.05
---

# Description
Audits your context engineering setup: custom agents, skills, MCP tools, file references, and custom instructions. Missing components limit AI effectiveness.

# When Triggered
{{count}} of 5 context engineering signals missing. Your AI lacks the context to be maximally effective.

# How to Improve
Level up your context engineering: add an `AGENTS.md` or `.cursor/rules/*.mdc` with your project conventions, create `.cursor/skills/<name>/SKILL.md` for repeatable workflows, connect MCP servers for external tools, use `@file`/`@folder` to give the agent precise context, and try custom subagents for focused tasks.

# Examples
{{extra.gapCount}} of 5 context engineering signals missing

# Detection Logic
```detect
scan: requests
match: true
aggregate: count
reqCount: count
hasSubAgents: someWhere(allReqs, "agentName", "!=", "") AND \
  someWhere(allReqs, "agentName", "!=", "copilot") AND \
  someWhere(allReqs, "agentMode", "agent")
hasSkills: flatCount(allReqs, "skillsUsed") > 0
hasMcp: flatSomeWhere(allReqs, "toolsUsed", ".", "mcp_", "startsWith")
fileRefRate: countWhere(allReqs, "referencedFiles.length", ">", 0) / reqCount
instrRate: countWhere(allReqs, "customInstructions.length", ">", 0) / reqCount
gap1: hasSubAgents == 0
gap2: hasSkills == 0
gap3: hasMcp == 0
gap4: fileRefRate < thresholds.fileRefMinRate
gap5: instrRate < thresholds.instructionMinRate
gapCount: gap1 + gap2 + gap3 + gap4 + gap5
emitCount: gapCount
emitTotal: 5
check: gapCount > 0 AND reqCount >= thresholds.minReqs
severity: gapCount >= 4
```
