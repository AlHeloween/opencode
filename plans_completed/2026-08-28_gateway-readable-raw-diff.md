# Gateway: raw-byte divergence reports + readable wire dumps + reasoning .md

Created: 2026-08-28T11:50Z
Status: EXECUTING — T1-T4 DONE (typecheck PASS 20260828T120226Z/123410Z, targeted
gateway tests 32/0 PASS 20260828T123410Z_82aee936; backlog 231 diff + 152 md).
Follow-up opened from RCA: dual-field reasoning round-trip (reasoning + reasoning_details,
100% of assistant messages, ~69k tok dup per request) — vendor contract per
api-docs.deepseek.com/guides/thinking_mode + docs.z.ai: SINGLE native field
`reasoning_content`; with tools round-trip mandatory, without — ignored. Fix site:
transform.ts (openrouter excluded from all vendor reasoning rules at :195-204) +
message-v2 providerOptions feed. SDK pristine (tarball FC: no differences — no patch).

## Why

Wire-truth RCA showed pretty-diff masks the true divergence point (whitespace/key-order
normalization aliases bytes). The cache-kill analysis needs: first byte offset where
consecutive request bodies diverge (raw), which message contains it, and prettified
context around it. Additionally: raw-wire envelopes store `body` as escaped string
(reads as «not prettified» — f9630e3a false alarm), and per-response reasoning is
buried in SSE chunks.

## Tasks

### T1 — raw-diff module (`provider/gateway/raw-diff.ts`, NEW)

- `analyzeRawDiff(prevRaw, currRaw)`: byte-true common prefix/suffix/inserted; verdict
  IDENTICAL | PURE-APPEND | MUTATION | VANISHED; divergenceOffset D (in curr_raw).
- Message-span scanner: brace-depth scan of curr_raw → raw spans of each `messages[]`
  element (start/end + role). messageIndex = span containing D.
- Sections: BEFORE = pretty(messages[k-1]), AFTER = pretty(messages[k]) — parse the raw
  span, JSON.stringify indent 2. RAW context slices prev/curr around D.
- `renderRawDiff(...)`: text report with cache estimate (uncached bytes/tokens from D).

### T2 — adaptive-client wiring

- raw-wire envelope: `body` = parsed object (tryParse), `body_raw` unchanged (byte truth).
- per-request .diff → renderRawDiff(prevRequestBody.body, rawBody) — replaces createPatch.
- per-response .diff → renderRawDiff(prevResponseBody.body, fullRaw) — same.
- per-response .md sidecar: assembled reasoning from stream chunks (delta.reasoning +
  reasoning_details[].text) with header (id/status/model/usage).

### T5 — single-field native reasoning round-trip (user-ordered 2026-08-28T12:35)

- SDK v2.10.0 == v3.0.0 dialect: `reasoning` + `reasoning_details` dual emission is
  PUBLISHED SDK behavior (tarball FC: no differences — no node_modules patch; the
  "agent patched the SDK" story disproven).
- Fix seam: adaptive-client wrapFetch — GLM/DeepSeek bodies rewritten BEFORE dispatch
  and dump: `reasoning` + `reasoning_details` -> single `reasoning_content`
  (DeepSeek/Z.AI native; smoke on live body: −334k chars = −19.4% of body, 121 msgs,
  ~91k tok reasoning now single-copy). Non-target providers untouched (test-verified).
- Oracles: targeted gateway tests 33/0 PASS (20260828T124334Z_aeda96bf); typecheck.

- For existing raw-wire/*.json: pairwise raw-divergence .diff (same format as logger).
- For existing per-response/*.json: reasoning .md (chunks array or SSE-string fallback).

### T4 — tests + oracles

- NEW test/provider/raw-diff.test.ts: PURE-APPEND (D at insertion, messageIndex last),
  MUTATION inside message k (span/offset/pretty sections), VANISHED, role extraction.
- bun typecheck + bun test test/provider (baseline/post compare).

## Out of scope

- `!`-dir (user's manual extraction workspace — not a logger bug; restore/prettify
  scripts already in experiments/).
- Changing analyzer python tools (they stay byte-based).

## Smoke Tests

smoke_na: false
baseline:
- label: provider tests (pre-edit)
  cmd: bun test test/provider
  workdir: packages/opencode
  expected_exit: 0
  tolerance: 17
  tolerance_reason: 17 env-timeout fails pre-exist on loaded Windows box (baseline
  20260828T095050Z_8850ba19: 364 pass / 17 fail); compare deterministic set, not count.
post_checks:
- label: provider tests (post-edit)
  cmd: bun test test/provider
  workdir: packages/opencode
  expected_exit: 0
  tolerance: 17
  tolerance_reason: same timeout-flakiness budget; no NEW deterministic failures allowed.
- label: typecheck
  cmd: bun run typecheck
  workdir: packages/opencode
  expected_exit: 0
blast_radius: NEW raw-diff.ts; adaptive-client.ts (dump/diff writers); tests.
  No request-body change; logging only. Backlog script touches .opencode/data only.
