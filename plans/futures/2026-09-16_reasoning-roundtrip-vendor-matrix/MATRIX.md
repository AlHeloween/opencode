# Vendor reasoning round-trip matrix — primary sources

status: in progress (built 2026-09-18). Every cell carries its source URL and effective date.
`not documented` is a finding, not a gap — per the brief it is the answer we need most.

## Questions

- **Q1 Replay requirement** — in a multi-turn conversation, must the assistant's prior reasoning be sent back? `required | optional-but-used | optional-but-ignored | forbidden | not defined`
- **Q2 Tool dependence** — does Q1 change when the request carries tool/function definitions?
- **Q3 Per-turn granularity** — if required, does it apply to every prior assistant turn, or only to tool-call turns?
- **Q4 Integrity** — is an opaque signature / id / encrypted blob required? field name; behaviour when absent or stale; does it survive a model switch mid-conversation?
- **Q5 Billing / cache** — do replayed reasoning tokens enter `prompt_tokens`; do they participate in the prompt-cache prefix?

---

## Anthropic (Claude)

Primary: `https://platform.claude.com/docs/en/build-with-claude/thinking` (read 2026-09-18)
Corroborating: `https://platform.claude.com/docs/en/build-with-claude/extended-thinking` (read 2026-09-18)

| Q | Answer | Evidence (verbatim, short) |
|---|--------|----------------------------|
| Q1 | **required** | "Each thinking block also carries a `signature` field, an encrypted copy of the full reasoning that you pass back unchanged in multi-turn and tool-use conversations." |
| Q2 | **not qualified in the passage read** — the requirement is stated for "multi-turn and tool-use conversations" together; whether it flips on the presence of tool definitions (DeepSeek-style) is **not documented** on the pages read. | — |
| Q3 | **every prior assistant turn** (blocks are preserved, not only tool turns) — see preservation section on the extended-thinking page. | (anchor `thinking#preserving-thinking-blocks` — not fully read) |
| Q4 | field **`signature`**, opaque/encrypted. Pass blocks back **unchanged**; the server decrypts the signature to reconstruct the original thinking. With `display:"omitted"` the `thinking` field is empty but the signature still carries the full encrypted reasoning, so round-tripping still works. Any text placed in a round-tripped omitted block's `thinking` field is **ignored**. | "If you pass thinking blocks back in multi-turn conversations, pass them unchanged. The server decrypts the `signature` to reconstruct the original thinking for prompt construction." |
| Q5 | thinking tokens are billed as **output** tokens on the generating request and count toward `max_tokens`; omitting the display reduces latency, not cost. | "the tokens Claude spends reasoning are billed as output tokens, even when the thinking text isn't returned to you, and they count toward max_tokens" |
| Q-cache | **not documented** on the pages read (prompt caching interaction with replayed thinking blocks). | — |

Model-switch / signature-staleness: **not documented** on the pages read — still open.

---

## OpenAI (reasoning models)

Primary: `https://platform.openai.com/docs/guides/reasoning` (read 2026-09-18)

| Q | Answer | Evidence (verbatim, short) |
|---|--------|----------------------------|
| Q1 | **optional-but-used** — reasoning items persist and may be rendered into later turns; selected by `reasoning.context` (`current_turn` \| `all_turns`). Not required for the call to succeed. | "Persisted reasoning provides continuity; it does not expose the model's raw reasoning. The reasoning items remain opaque, and the API does not return their reasoning text." |
| Q2 | **not documented** as a flip on tools. | — |
| Q3 | **all prior turns** when `all_turns`: "Renders available, compatible reasoning items from earlier turns into the next sample." Not restricted to tool-call turns. | — |
| Q4 | field **`encrypted_content`**, a property of the output reasoning items in stateless mode (`store:false` or ZDR). Survives **within a model family only**. | "Persisted reasoning can be reused only within the same model family... When you switch model families, the API omits incompatible reasoning from the model's context, even when `reasoning.context` is `all_turns`." |
| Q5 | reasoning tokens occupy context and are billed as **output** tokens; usage reports `output_tokens_details.reasoning_tokens`. | "reasoning tokens are not visible via the API, they still occupy space in the model's context window and are billed as output tokens" |
| Q-cache | `input_tokens_details.cached_tokens` exists; whether replayed reasoning participates in the prefix cache — **not documented** in this guide. | — |
| Diff | **Chat Completions vs Responses**: the reasoning-item / `encrypted_content` / `reasoning.context` machinery is Responses-only. | "Reasoning models work better with the Responses API. While the Chat Completions API is still supported..." + "Use the Responses API for function calling. Chat Completions does not support function calling with GPT-6 Astra." |

Defaults: GPT-5.6 family defaults to `all_turns`; earlier models default to `current_turn`. `none` effort returns HTTP 400 on GPT-6 Astra. Legacy `reasoning.encrypted_content` in `include` is still accepted but not required.

## Google Gemini (thought signatures)

Primary: `https://ai.google.dev/gemini-api/docs/thinking` (read 2026-09-18); dedicated page also exists at `/gemini-api/docs/thought-signatures`.

| Q | Answer | Evidence (verbatim, short) |
|---|--------|----------------------------|
| Q1 | **required** (stateless mode) | "Thought signatures are encrypted representations of the model's internal reasoning. They are required to maintain reasoning continuity across multi-turn interactions." + "You **MUST** always resend all `thought` blocks exactly as they were received from the model." |
| Q2 | tool blocks carry their **own** signatures that must also be resent — not a flip of Q1 on tool presence | "Built-in tools such as Google Search can carry their own distinct signatures on the call/result blocks. In stateless mode, you must also resend these tool result signatures in subsequent turns." |
| Q3 | **all prior thought blocks** ("all `thought` blocks"), plus built-in-tool block signatures. Note: in the Interactions API signatures live ONLY on `thought` steps or built-in tool steps — never on user inputs, model outputs or standard function calls. | lines 2933, 3513 |
| Q4 | field **`thought_signature`** ("The cryptographic signature"); may be present with no summary. Must not be removed or modified. **Model switch: supported** — "When switching models within a session, you should still resend the previous model's thought blocks. The backend manages compatibility." | lines 3145, 3514, 3515 |
| Q5 | billed: "response pricing is the sum of output tokens and thinking tokens"; total via `total_thought_tokens`. Prompt-cache participation — **not documented** on this page. | line 3520-3522 |
| Mode | **stateful mode** (`store:true` + `previous_interaction_id`) = server manages signatures entirely — nothing to replay. **stateless** = caller must resend. | line 3506 |

## Z.AI / Zhipu GLM

Primary: `https://docs.z.ai/guides/llm/glm-4.6` (read 2026-09-18)

| Q | Answer | Evidence |
|---|--------|----------|
| Q1 | **not documented on the request side** — the GLM-4.6 guide documents `reasoning_content` only as a streaming *response* delta field (`chunk.choices[0].delta.reasoning_content`); no rule about sending it back was found. | grep found no `multi-turn` / `pass back` / `should not` guidance |
| Q2 | **not documented** | — |
| Q3 | **not documented** | — |
| Q4 | **not documented** (no signature field mentioned) | — |
| Q5 | **not documented** on this page | — |

Caveat: only the GLM-4.6 guide page was read — a request-side rule on another Z.AI page is not excluded.

## Alibaba Qwen

Primary: `https://www.alibabacloud.com/help/en/model-studio/deep-thinking` (read 2026-09-18)

| Q | Answer | Evidence (verbatim, short) |
|---|--------|----------------------------|
| Q1 | **optional-but-used**, gated by an explicit flag | "`preserve_thinking` controls whether the model reads `reasoning_content` from historical assistant messages. When set to `true`, that reasoning is included in the next turn's input. The client must supply historical assistant messages and their `reasoning_content` in the request's `messages`." |
| Q2 | **not documented** as a flip on tools | — |
| Q3 | the client supplies the historical assistant messages it wants replayed | — |
| Q4 | **not documented** (no signature / id field) | — |
| Q5 | **input tokens + billing**: "When enabled, `reasoning_content` from conversation history counts toward input tokens and billing." | — |
| Robustness | enabling the flag when history lacks `reasoning_content` is **not an error**: "enabling this parameter when history messages lack `reasoning_content` does not cause an error" (listed for Qwen3.8 Max / 3.7 / 3.6 and Kimi models). | — |

**This REFUTES the community claim** "do not add the `reasoning_content` field when you add to the context" that our code carries undocumented: the current official docs describe the opposite — an explicit opt-in that DOES add historical reasoning to the input (and bills it).

## xAI Grok / Mistral / Moonshot Kimi / MiniMax

### xAI Grok — primary: `https://docs.x.ai/docs/guides/reasoning` (read 2026-09-18; page last updated **August 12, 2026**)

| Q | Answer | Evidence (verbatim, short) |
|---|--------|----------------------------|
| Q1 | **optional-but-used** | "You can send the encrypted content back to provide more context to a previous conversation." |
| Q4 | field **`reasoning.encrypted_content`**, requested via `include: ["reasoning.encrypted_content"]` on the Responses API. No signature on the plaintext reasoning. | "The reasoning content is encrypted by us and can be returned if you pass `include: ["reasoning.encrypted_content"]`... You can send the encrypted content back..." |
| Q5 | billed: "When you use a reasoning model, the reasoning tokens are billed as part of your total consumption." Usage exposes `reasoning_tokens`. | — |
| Q2 / Q3 | **not documented** | — |

### Mistral — primary: `https://docs.mistral.ai/capabilities/reasoning/` (read 2026-09-18)

| Q | Answer | Evidence |
|---|--------|----------|
| Q1 | **not documented** — no request-side replay rule found | — |
| shape | thinking is a **`ThinkChunk`** (`type: "thinking"`) carried inside `message.content` (response side); `reasoning_effort` takes `high`/`none` | grep of the capability page |
| Q2–Q5 | **not documented** | — |

### Moonshot Kimi / MiniMax — **NOT OBTAINED**

- Kimi (`https://platform.moonshot.ai/docs/guide/use-thinking-model`) returned a docs *shell* with no article body; MiniMax (`https://platform.minimaxi.com/docs/api-reference/text-reasoning`) returned a 404 error page. The correct primary URLs were not found (web search was unavailable — see residual).
- Weak second-hand signal only: Alibaba's `preserve_thinking` doc (above) lists "Kimi models" among those that accept the parameter when history lacks reasoning **without error** — i.e. optional there too. This is NOT a Kimi primary source; treat as a lead.

## OpenRouter (intermediary)

Primary: `https://openrouter.ai/docs/use-cases/reasoning-tokens` (read 2026-09-18)

| Q | Answer | Evidence (verbatim, short) |
|---|--------|----------------------------|
| Q1 | **optional-but-used** — reasoning can be passed back; not required | "To preserve reasoning context across multiple turns, you can pass it back to the API in one of two ways:" |
| Q4 | `reasoning_details` is the structure-preserving path; `reasoning_content` is an alias. | "Use `reasoning_details` when working with models that return special reasoning types (such as encrypted or summarized) — this preserves the full structure needed for those models." |
| Portability | a vendor's contract is normalised across vendors: "The `reasoning_details` functionality works identically across all supported reasoning models. You can easily switch between OpenAI reasoning models and Anthropic reasoning models without changing your code structure." | — |
| Q2 / Q3 / Q5 | **not documented** in the page read | — |

---

## Snapshot of what would change our code

- Any vendor in the current "strip" group that in fact **requires** replay → we silently degrade it today.
- Any vendor requiring a signature we drop on model switch → latent 400.
- Any vendor billing reasoning tokens on replay → cost calculus for echo changes.
