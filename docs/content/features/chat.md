---
title: "Chat Participant"
weight: 30
description: "Conversational access to all coaching data via @coach in Cursor's chat panel"
---

# Chat Participant

The `@coach` chat participant gives you conversational access to all Cursor Engineering Coach data directly in Cursor's chat panel. Ask questions in natural language and get data-driven coaching responses without leaving your editor.

## Getting Started

Before using `@coach`, open the Cursor Engineering Coach sidebar at least once to load your session data.

> **Note:** When you use `@coach`, your question and the results returned by coaching tools are sent to Cursor's selected chat model so it can synthesize a response. The underlying coaching data is gathered locally, but the final chat answer is not produced purely through local processing.

Type `@coach` in Cursor's chat panel followed by your question:

```
@coach how am I doing this week?
```

The participant is sticky — once invoked, follow-up messages in the same thread continue the conversation without needing to type `@coach` again.

## Slash Commands

| Command | Description | Default prompt |
|---|---|---|
| `/summary` | Quick usage overview | Highlights strengths and top areas to improve |
| `/improve` | Improvement recommendations | Top 3 things to improve with specific actions |
| `/compare` | Mode/model comparison | Compare your Cursor agent modes and models |
| `/flow` | Flow & focus analysis | Deep work patterns and best productivity hours |

Use a slash command with no additional text to get the default analysis, or add your own question:

```
@coach /flow Am I more productive in the morning or afternoon?
```

## Available Tools

The participant has access to backend tools that it selects automatically based on your question:

| Tool | Domain | What it returns |
|---|---|---|
| `coach_summary` | Observe | Session counts, recommendations, top anti-patterns |
| `coach_activity` | Observe | Daily requests, LOC, and session breakdown |
| `coach_credits` | Measure | Usage estimates, per-model breakdown, daily trend, and costly requests |
| `coach_codeProduction` | Measure | AI vs user LOC, language breakdown, workspace distribution |
| `coach_flow` | Measure | Deep work scores, best hours, follow-up latency |
| `coach_patterns` | Improve | Anti-patterns and practice recommendations with severity |
| `coach_insights` | Improve | Learning velocity, intent classification, prompt maturity |
| `coach_wellbeing` | Improve | Work-life balance score, time distribution, burnout risk |
| `coach_workflows` | Improve | Repeated workflow clusters with automation suggestions |
| `coach_modeComparison` | Observe | Side-by-side comparison of agent versus ask mode |
| `coach_sessions` | Observe | Browse or search individual sessions by ID or keyword |
| `coach_contextHealth` | Improve | Context utilization, compaction, config health, and rules-file quality |

All tools accept optional `fromDate`, `toDate`, and `workspaceId` filters. The participant resolves relative time references ("last week", "past month") automatically.

## How It Works

The participant runs an **agentic loop** that:

1. Sends your question along with a coaching persona and tool-selection heuristics to the language model
2. The model decides which tools to call based on your intent
3. Tool results are fed back into the conversation for the model to synthesize
4. The model may call additional tools if needed (up to 8 rounds)
5. A final, synthesized coaching response is streamed back to you

This means a single question like "compare my productivity this week vs last week" can trigger multiple tool calls (activity, flow, code production) and produce a unified answer.

## Example Conversations

**Broad check-in:**
```
@coach Give me a quick health check
```
→ Calls `coach_summary`, returns practice scores, session count, top anti-pattern, and a suggested next step.

**Specific investigation:**
```
@coach Why is my prompt quality score dropping?
```
→ Calls `coach_patterns` with recent date range, surfaces the specific anti-patterns driving the score down with example prompts from your sessions.

## Follow-ups

After each response, the participant suggests follow-up prompts to guide deeper analysis:

- **Improve** — "What should I improve next?"
- **Compare modes** — "Compare agent vs ask mode"
- **Flow state** — "How is my focus & flow?"

Click any follow-up to continue the conversation without typing.
