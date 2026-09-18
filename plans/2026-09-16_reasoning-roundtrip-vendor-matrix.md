---
title: Vendor reasoning round-trip contract — external research brief
owner: Local_Development
status: research delivered 2026-09-18 — matrix in `plans/2026-09-16_reasoning-roundtrip-vendor-matrix/MATRIX.md` (Anthropic, OpenAI, Gemini, Qwen, Z.AI, xAI, Mistral, OpenRouter answered from primary docs; Kimi + MiniMax primary URLs not obtained)
kind: research
---

<!-- intention: per-vendor CoT replay rules are Unknown outside DeepSeek -> an authoritative, dated matrix we can encode as per-provider policy -->

# Research brief: what each vendor requires on reasoning replay

> **Result (2026-09-18):** the filled matrix is `MATRIX.md` in this folder. Actionable change found:
> Qwen's official docs describe an opt-in (`preserve_thinking`) that **does** add historical
> `reasoning_content` to the input and bills it — the undated "do not add reasoning_content to the
> context" instruction our code carries is not what the current docs say. **Anthropic and Gemini
> REQUIRE replay** (`thinking` blocks with `signature` / `thought_signature`); OpenAI, xAI, Qwen and
> OpenRouter treat it as optional-but-used via an explicit flag or field. Z.AI GLM and Mistral
> document nothing request-side (a finding, not a gap). Encoding the matrix into `transform.ts`
> branches is the next step and is not done here.

## Why this is blocked on research, not on measurement

opencode strips or echoes chain-of-thought per provider in
`packages/opencode/src/provider/transform.ts`. The DeepSeek branch is settled
from primary docs and live wire measurement. Every other branch rests on a
single undated observation or on inference, and the cost of being wrong is
asymmetric: echo something a vendor rejects and requests 400; strip something a
vendor needs and the model silently re-derives its own reasoning every turn,
which is invisible in logs and expensive in tokens.

We cannot settle these by measuring — we do not hold keys for most of them, and
a live probe answers for one model on one day. What is needed is the documented
contract with its effective date.

## What we already hold (do not re-derive; contradict it if wrong)

| claim | status | provenance |
|---|---|---|
| DeepSeek, request WITHOUT `tools`: input `reasoning_content` is ignored, not concatenated into context | Exact | api-docs.deepseek.com/guides/thinking_mode |
| DeepSeek, request WITH `tools`: `reasoning_content` of all previous turns must be passed back, **including turns with no tool call** | Exact | same page, verbatim |
| DeepSeek rejects a tool-call turn whose `reasoning_content` is missing (HTTP 400, "The reasoning_content in the thinking mode must be passed back to the API") | Inferred | third-party issue report; our own 400-guard predates it |
| The condition is on the REQUEST carrying `tools`, not on the individual message containing a tool call | Exact | verbatim wording |
| Qwen/Alibaba: "do not add the reasoning_content field when you add to the context" | Hypothetical | quoted in our source comment, undated, unverified |
| zen-proxied Kimi / GLM / MiniMax / hy3: no reasoning surfaced, no-echo replays accepted without 400 | Inferred | our own live capture, 2026-08 |
| OpenRouter emits `reasoning` + `reasoning_details` — two copies of the same text — and strips them before upstream | Inferred | our wire capture, 2026-08-28 |

## Questions, each stated so an answer can be wrong

For every vendor below, answer these five and give the documentation URL plus
the effective date or version the answer applies to. Where the docs are silent,
say "not documented" rather than inferring — silence is itself the finding we
need, because it tells us the behaviour may change without notice.

1. **Replay requirement.** In a multi-turn conversation, must the assistant's
   prior reasoning be sent back in the next request? Required, optional-and-used,
   optional-and-ignored, or forbidden?
2. **Tool dependence.** Does the answer to (1) change when the request carries
   tool definitions, versus when it does not? DeepSeek's contract flips entirely
   on this; we need to know which other vendors share that shape.
3. **Per-turn granularity.** If replay is required, does it apply to every prior
   assistant turn, or only to those that issued tool calls?
4. **Integrity.** Does the vendor require an opaque signature, id, or encrypted
   blob alongside the reasoning text? If so: what is the field, what happens
   when it is absent or stale, and does it survive a model change within the
   same conversation?
5. **Billing and cache.** Do replayed reasoning tokens enter `prompt_tokens`?
   Do they participate in the vendor's prompt-cache prefix, or are they excluded?

## Vendors, in priority order

1. **Anthropic** — extended thinking. This is the one actively blocking a code
   change. Specifically: are `thinking` blocks required on replay for tool-use
   turns, for all turns, or neither; what exactly does the `signature` field
   guard; what is the documented behaviour when a conversation switches model
   mid-thread and prior thinking blocks carry another model's signature.
2. **OpenAI** — reasoning models. Reasoning items, `previous_response_id`,
   encrypted reasoning content, and whether Chat Completions and the Responses
   API differ here. We use OpenAI-compatible routes for several providers, so
   the shape of the canonical API matters even where we do not call it directly.
3. **Google Gemini** — thinking / thought summaries. Whether thought parts are
   returned to the caller at all, whether they may or must be replayed, and
   whether "thought signatures" are required in multi-turn function calling.
4. **Z.AI / Zhipu GLM** — `reasoning_content` is documented as a response field.
   Is replay defined at all on the request side? Does GLM behave like DeepSeek
   when tools are present?
5. **Alibaba Qwen** — confirm or refute the "do not add reasoning_content to
   context" instruction, with its current URL and date. Our copy of this claim
   is undated and drives an unconditional strip for a whole route.
6. **xAI Grok**, **Mistral**, **Moonshot Kimi**, **MiniMax** — same five
   questions, briefer; we route these through OpenAI-compatible endpoints and
   currently strip reasoning for all of them on one undated observation.
7. **OpenRouter as an intermediary** — separate from the vendors behind it.
   What does it do with `reasoning` and `reasoning_details` on the request path:
   forward, rewrite, or drop before upstream? Is behaviour per-model? This
   determines whether a vendor's contract is even reachable through it.

## What would change our code

- Any vendor in the "strip" group that in fact requires replay → we are silently
  degrading it today, the same defect we just fixed for DeepSeek.
- Any vendor that requires a signature we drop on model change → a latent 400.
- Any vendor whose reasoning tokens are billed on replay → changes the cost
  calculus for echo, which we currently treat as free outside DeepSeek.

## Source rules

Primary vendor documentation, API references, changelogs, and official SDK
source only. Community posts and blog articles may be used to locate a primary
source but not to establish a claim. Where a vendor's docs and its SDK's
behaviour disagree, report both and say which you verified. Date every answer:
these contracts have changed at least twice in 2026 by our own records.

## Deliverable

A table with one row per vendor and one column per question above, each cell
carrying its source URL and effective date, plus a short list of the places
where the vendor documentation is silent. We will encode it directly into
`docs/reasoning-round-trip-contract.md` and the per-route branches in
`transform.ts`.

## Out of scope

Prompt-engineering advice, model quality comparisons, benchmark results, and
anything about how reasoning improves answers. This is purely about the wire
contract for replaying reasoning that a model already produced.
