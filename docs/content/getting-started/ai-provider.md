---
title: "AI Provider"
weight: 30
description: "Optionally power in-panel AI analyses with a local or hosted model"
---

# AI Provider

A few Cursor Engineering Coach features run a small AI analysis *inside the panel* — Skill Finder triage, the anti-pattern **Why?** explainer, the Learning Center, and Context Health review. In stock VS Code these use the editor's built-in model. **Cursor does not expose its models to extensions**, so by default those features hand off to Cursor Chat or fall back to a local heuristic.

To run them directly in the panel, point the coach at an **OpenAI-compatible** model. The recommended choice for privacy is a **local model via Ollama**, which keeps everything on your machine. If you already have a **Google Gemini** API key, you can use that instead — it runs the coach's analyses on Google's models without spending your Cursor request/token budget.

## What is sent — and what is not

This is **opt-in**. With the default setting (`provider: auto`) the coach makes **no external AI calls**.

When you enable a provider, each request contains:

- the analysis prompt, and
- a compact **summary** of the relevant sessions (prompt counts, models used, anti-pattern names, cancel/correction rates).

It does **not** send your source code. With **local Ollama** nothing leaves your machine. With a hosted endpoint (including **Google Gemini**), the summary is sent only to that endpoint; an API key is stored in the editor's secret storage and sent only as an `Authorization: Bearer` header — never written to settings or logs.

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

## Option B — Google Gemini

Use your existing Google Gemini API key. The coach talks to Gemini through its OpenAI-compatible endpoint, so setup is a one-liner — and because it's your own Gemini key, it doesn't touch your Cursor request/token budget.

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. In Cursor, run **Cursor Engineering Coach: Set Up AI Provider** and choose **Google Gemini**.
3. Accept the default base URL (`https://generativelanguage.googleapis.com/v1beta/openai`) and paste your API key when prompted.
4. The coach fetches the models **your key can actually use** and shows them in a list — pick a `*-pro` id (e.g. `gemini-2.5-pro`) for the Pro tier, or a `*-flash` id for cheaper/faster runs. (You can still enter an id by hand if you prefer.)

The coach then sends a tiny **test request** to confirm the key and model work, so you find out at setup time rather than the first time you run an analysis.

Picking from the fetched list avoids the most common Gemini stumble: a `model ... not found` error from copying a preview id (like `gemini-3.5-flash`) that a standard key can't access.

When set up, Gemini takes priority over Ollama and the host editor — the coach routes its in-panel AI through it. Switch back any time by re-running setup and choosing **Local Ollama** or **Off (auto)**.

## Option C — Hosted (OpenAI-compatible)

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
| `cursorEngineeringCoach.ai.provider` | `auto` | `auto` (no external calls), `ollama`, `gemini`, or `openai-compatible`. A non-`auto` provider is used in preference to the host editor's model. |
| `cursorEngineeringCoach.ai.baseUrl` | *(blank)* | OpenAI-compatible base; requests are POSTed to `<baseUrl>/chat/completions`. **Leave blank (the default) to use the selected provider's endpoint automatically** — `http://127.0.0.1:11434/v1` (ollama), `https://generativelanguage.googleapis.com/v1beta/openai` (gemini), `https://api.openai.com/v1` (openai-compatible). Only set it to override (e.g. OpenRouter or a self-hosted gateway). |
| `cursorEngineeringCoach.ai.model` | *(empty)* | Model name to request. Required for a non-`auto` provider. |

The API key is **not** a setting — manage it only through the commands above so it stays in secret storage.

## Seeing the active provider

The dashboard's left sidebar shows an **AI Provider** badge under the workspace filter — e.g. `Google Gemini · gemini-2.5-pro` — so you always know which provider and model in-panel AI will use, and where requests are routed. A coloured dot signals health: green (ready), amber (model or API key missing), grey (off / Cursor-only). **Click the badge** to run the guided setup and switch provider or model at any time.

## If the provider is unreachable

If you see **"Couldn't reach the AI provider…"** (or the older `fetch failed`), the endpoint isn't responding. Most often the Ollama server simply isn't running. Check, in order:

1. Is Ollama running? Open the Ollama app or run `ollama serve`, then test with `curl http://127.0.0.1:11434/api/tags`.
2. Is the model pulled? `ollama list` should show the name you set in `cursorEngineeringCoach.ai.model` (pull it with `ollama pull qwen2.5-coder`).
3. Is the URL right? Prefer `http://127.0.0.1:11434/v1` over `http://localhost:11434/v1` — Node can resolve `localhost` to IPv6 while Ollama listens on IPv4, which looks like a connection failure.

For **Google Gemini**, a `model ... not found` (HTTP 404) means the configured model id isn't available to your key — preview ids like `gemini-3.5-flash` often aren't on a standard tier. Re-run **Set Up AI Provider** and pick a model from the fetched list (e.g. `gemini-2.5-pro`). A `401`/`403` instead means the key itself was rejected — re-enter it with **Set AI API Key** using your [Google AI Studio](https://aistudio.google.com/apikey) key.

### Gemini: Flash works but Pro returns `429 Too Many Requests`

A `429` is a **quota / rate-limit** error from Google, not a bug in the coach. It is the most common Gemini Pro stumble, and it comes down to two facts:

- **The free API tier throttles Pro hard.** Free-tier `gemini-2.5-pro` is capped at roughly **5 requests/min and ~50–100/day**, while Flash models get far higher limits — so Flash works while Pro 429s almost immediately.
- **A consumer "Gemini Advanced" (Google One AI Premium) subscription grants _no_ API quota.** It unlocks the Gemini *app*, not the *API*. API quota is governed only by the Google Cloud project behind your API key.

To use a Pro model through the API:

1. Open [Google AI Studio → Get API key](https://aistudio.google.com/apikey) and **enable Cloud Billing** on the key's project. Tier 1 unlocks instantly with no minimum spend (you're billed only for usage beyond the free allowance), lifting Pro to ~150–1,000 requests/min. See [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
2. Or keep the free tier and switch the model to **`gemini-2.5-flash`** (run **Set Up AI Provider** again) — plenty for the coach's short analyses.

If you *have* billing enabled and still see a 429 whose detail mentions `free_tier`, your key's project may not be linked to billing (re-link it, or create a fresh key inside the billing-enabled project).

Even when a provider fails, the coach does not dead-end:

- Skill Finder ranks candidates **locally** and tells you it did so.
- The anti-pattern **Why?** hands the question to **Cursor Chat**.

Start your provider — or switch `provider` back to `auto` — and re-run to get full in-panel AI output.
