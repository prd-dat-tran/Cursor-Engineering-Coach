---
title: "AI Provider"
weight: 30
description: "Optionally power in-panel AI analyses with a local or hosted model"
---

# AI Provider

A few Cursor Engineering Coach features run a small AI analysis *inside the panel* — Skill Finder triage, the anti-pattern **Why?** explainer, the Learning Center, and Context Health review. In stock VS Code these use the editor's built-in model. **Cursor does not expose its models to extensions**, so by default those features hand off to Cursor Chat or fall back to a local heuristic.

To run them directly in the panel, point the coach at an **OpenAI-compatible** model. The recommended choice is a **local model via Ollama**, which keeps everything on your machine.

## What is sent — and what is not

This is **opt-in**. With the default setting (`provider: auto`) the coach makes **no external AI calls**.

When you enable a provider, each request contains:

- the analysis prompt, and
- a compact **summary** of the relevant sessions (prompt counts, models used, anti-pattern names, cancel/correction rates).

It does **not** send your source code. With **local Ollama** nothing leaves your machine. With a hosted endpoint, the summary is sent only to that endpoint; an API key (if any) is stored in the editor's secret storage and sent only as an `Authorization` header — never written to settings or logs.

## Option A — Local Ollama (recommended)

1. Install [Ollama](https://ollama.com) and pull a coding model:

```bash
ollama pull qwen2.5-coder
```

2. In Cursor, open the Command Palette and run **Cursor Engineering Coach: Set Up AI Provider**.
3. Choose **Local Ollama**, accept the default base URL (`http://127.0.0.1:11434/v1`), and enter the model name (`qwen2.5-coder`).

Make sure the Ollama server is actually running first — open the Ollama app, or run `ollama serve` in a terminal. Setting the provider in Cursor does **not** start Ollama for you. Verify it is up with:

```bash
curl http://127.0.0.1:11434/api/tags
```

Re-run an analysis (e.g. Skill Finder → **Analyze**) and it will use the local model.

## Option B — Hosted (OpenAI-compatible)

1. Run **Cursor Engineering Coach: Set Up AI Provider** and choose **OpenAI-compatible endpoint**.
2. Enter the base URL, for example:

| Provider | Base URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Azure OpenAI | your resource's OpenAI base URL |
| LiteLLM / self-hosted gateway | your gateway's base URL |

3. Enter a model name your endpoint supports (e.g. `gpt-4o-mini`, or a namespaced name like `openai/gpt-4o-mini` on OpenRouter).
4. When prompted, set your API key. It is stored securely via the editor's secret storage.

Change the key later with **Set AI API Key**, or remove it with **Clear AI API Key**.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `cursorEngineeringCoach.ai.provider` | `auto` | `auto` (no external calls), `ollama`, or `openai-compatible`. |
| `cursorEngineeringCoach.ai.baseUrl` | `http://127.0.0.1:11434/v1` | OpenAI-compatible base; requests are POSTed to `<baseUrl>/chat/completions`. |
| `cursorEngineeringCoach.ai.model` | *(empty)* | Model name to request. Required for a non-`auto` provider. |

The API key is **not** a setting — manage it only through the commands above so it stays in secret storage.

## If the provider is unreachable

If you see **"Couldn't reach the AI provider…"** (or the older `fetch failed`), the endpoint isn't responding. Most often the Ollama server simply isn't running. Check, in order:

1. Is Ollama running? Open the Ollama app or run `ollama serve`, then test with `curl http://127.0.0.1:11434/api/tags`.
2. Is the model pulled? `ollama list` should show the name you set in `cursorEngineeringCoach.ai.model` (pull it with `ollama pull qwen2.5-coder`).
3. Is the URL right? Prefer `http://127.0.0.1:11434/v1` over `http://localhost:11434/v1` — Node can resolve `localhost` to IPv6 while Ollama listens on IPv4, which looks like a connection failure.

Even when a provider fails, the coach does not dead-end:

- Skill Finder ranks candidates **locally** and tells you it did so.
- The anti-pattern **Why?** hands the question to **Cursor Chat**.

Start your provider — or switch `provider` back to `auto` — and re-run to get full in-panel AI output.
