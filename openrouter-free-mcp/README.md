# openrouter-free-mcp

A small MCP server: isolated, bounded LLM calls routed to **free-tier
OpenRouter models by default** — the same idea as opencode's `aicall` tool,
standalone and wired into Claude Code the same way opencode wires `codegraph`
(`.mcp.json`, stdio transport).

It is **not** a subagent: no repo tools, no working-tree authority, no
multi-step tool use inside the call. One prompt (+ optionally some files
read and embedded) goes in, one answer comes out. Good for bounded,
low-stakes work — drafting, summarizing, proposing a diff on attached files —
never as a substitute for a real test/build/oracle.

## Why free-first matters

Every call defaults to the OpenRouter model with cost `0/0` and the largest
context window, refreshed from OpenRouter's live model list (cached 10
minutes). If you pass an explicit `model` that turns out to be paid, the call
is **refused** unless you also pass `allow_paid: true` — mirroring the guard
`aicall` added after a real incident where a bot's paid default silently
drained an API balance. Nothing here can spend money by accident.

## Setup

```bash
cd openrouter-free-mcp
npm install
```

Get an API key at https://openrouter.ai/keys (free-tier models still need a
key to authenticate, even though they cost nothing to call).

## Wire it into Claude Code

Add to your project's `.mcp.json` (same shape as your `codegraph` entry):

```json
{
  "mcpServers": {
    "openrouter-free": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path-to>/openrouter-free-mcp/src/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-...",
        "OPENROUTER_SITE_URL": "https://your-project-or-site (optional, sent as HTTP-Referer)",
        "OPENROUTER_APP_NAME": "your-app-name (optional, sent as X-Title)"
      }
    }
  }
}
```

Then `claude mcp list` / restart Claude Code to pick it up.

## Tools

### `list_free_models`

Lists every currently free (`0/0` pricing) OpenRouter model, grouped by
output modality (text first — the only group `call_model`'s auto-select can
use — then text+image, image, audio, video) and sorted by context window
within each group. Non-text-output models are shown, not hidden — like
opencode's own `capability` tool, which lists every model's modality rather
than filtering by it, so you can deliberately pick one via `call_model`'s
`model` param (e.g. a free music/lyrics model) when you actually want that
modality. Params: `min_context` (optional), `refresh` (optional, bypasses
the 10-minute cache).

### `call_model`

| Param | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | yes | The instructions/question |
| `files` | string[] | no | Paths read and embedded before the prompt |
| `system` | string | no | Optional system prompt (omit for a fully isolated call) |
| `model` | string | no | Explicit OpenRouter model id. Omit for free-first auto-select |
| `allow_paid` | boolean | no | Must be `true` to use a non-free model |
| `output_file` | string | no | Save the response here instead of returning it inline |
| `temperature`, `top_p`, `max_tokens`, `presence_penalty`, `frequency_penalty`, `seed` | number | no | Forwarded to OpenRouter |

Every response is prefixed with an envelope (model id, free/paid, context
size, files/chars sent) — the same transparency habit `aicall` uses, so you
always know what actually answered before trusting the content.

`output_file` carries the same guard `aicall` has: if the target path looks
like source code (`.py`, `.ts`, `.go`, ...) but the model returned prose/
markdown instead, the file is **not** written — the call comes back
`REJECTED` with a preview instead of silently corrupting the file.

## What's been verified

`smoke_test.mjs` is the sandboxed variant (blocked egress: proves the server
starts, completes the MCP `initialize` handshake, lists both tools, and
fails cleanly — not crashes — with no API key). `live_smoke_test.mjs` is the
real one, run against the live OpenRouter API (2026-09-10):

- `list_free_models` returns real free-tier models (19 text-output models
  with ≥8000 ctx at time of test).
- `call_model` with no explicit `model` auto-selects a free model and
  returns a real completion.
- `call_model` with an explicit paid model (`openai/gpt-4o`) and no
  `allow_paid` is refused before any request reaches OpenRouter — confirmed
  no spend.

That first live run caught two real bugs, both now fixed:

1. **Some free models reject direct chat calls.** The largest-context free
   candidate (`thinkingmachines/inkling-small:free`, 1M ctx) 403'd with
   "only available on agentic harnesses" on a plain chat-completions call.
   Auto-select now falls through the sorted free-candidate list (up to 4
   tries) instead of failing on the first one.
2. **Free ≠ chat-capable.** `google/lyria-3-pro-preview` is free-priced with
   a 1M context window but is a music/lyrics-generation model
   (`output_modalities: ["text","audio"]`) — it returned generated song
   lyrics instead of following the instruction. Both `list_free_models` and
   `call_model`'s auto-select now filter to `output_modalities === ["text"]`
   (`isTextGeneration` in `src/index.js`).

Re-run the live check any time with:

```bash
OPENROUTER_API_KEY=sk-or-v1-... node live_smoke_test.mjs
```
