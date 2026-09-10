# Tool-Result Deliver-Once: ID-addressed replay instead of content cloning

Date: 2026-09-07
Status: DONE (C1-C3; C4 deferred by design; C5 continues under
plans/2026-09-07_video-context-fractal-program.md)
Owner: Smit / Alexander

## Goal

A tool result's heavy content (video, images, long text reads, long outputs) must be
delivered to the model **once** and then addressed by its part ID (`prt_...`) in every
subsequent request serialization. Today every request rebuild re-materializes the full
content (and in two different, unstable serializations), which caused:

- Z.AI `视频输入格式/解析错误` — video_url block inside a tool message (7ea4159d);
- HTTP 400 context overflow — 963,583 text tokens (base64 counted as text) on the
  next-turn rebuild (b91da99d);
- emergency compaction firing on top (5c15561b) — the model NEVER saw the video;
- provider-side prompt cache destroyed every turn (cached_tokens: 0 at ~100k prompt).

Root cause: tool results are re-serialized (cloned) per request build from mutable
state; the wire has no notion of "already delivered".

## Design: deliver once, then placeholder-by-ID

1. **Delivery gate** (`message-v2.ts` `toModelMessagesEffect`): serializing a tool part
   whose state carries heavy content (any `data:` attachment, or output text over a
   threshold, e.g. > 2,000 chars):
   - if the part has no `delivered` marker → first serialization delivers:
     tool message = short digest; media rides its proven, provider-accepted path
     (synthetic user message — the `media` array already exists for
     openai-compatible; video must use it too, never tool role);
   - if delivered → wire placeholder, byte-stable:
     `[read id=prt_xxx — result delivered earlier (345 lines, D:\file.ts); re-read with offset if needed]`.
2. **Persistence**: `ToolStateCompleted` gains `delivered: Schema.optional(Schema.Boolean)`
   (schema + SQL column via migration + projector), so later rebuilds know delivery
   already happened. The placeholder is a pure function of (tool, id, digest) — stable
   across builds → prefix cache stays warm.
3. **Token estimate fix** (`util/token.ts`): `data:` URLs / long base64 payloads must not
   count as text (4 chars/token). Video ≈ small fixed cost; images by decoded size;
   this kills the phantom 688K tokens that tripped compaction.
4. **Canonical serializer**: ONE function builds the wire tool message for both build
   paths (in-turn continuation and fresh-turn history rebuild) — removes the two-forms
   divergence observed on the wire (array form vs stringified-JSON form).
5. **Light results unchanged**: outputs below the threshold keep current behavior
   (replay in full); `REPLAY_TOOL_OUTPUT_MAX_CHARS` remains as the emergency cap.

## Slices

- **C1** deliver-once for media attachments (video/images/PDF) + `delivered` flag +
  migration. Proven path: synthetic user message (Z.AI accepts video_url there —
  200 OK wire probe; rejects it in tool role).
- **C2** token estimate: skip data:/base64 payloads.
- **C3** canonical tool-message serializer + placeholder-by-ID for heavy TEXT results
  (read pages, long outputs) + placeholder byte-stability test.
- **C4** (optional, later) digest policy for medium-length outputs after K turns.
- **C5** video-as-context probe (code rendered as a slideshow):
  1. token-per-second curve — 30s / 120s / 600s clips → prompt_tokens (single point
     measured: ~6s ≈ 2610 tokens, video_tokens: 0; wire cost is inter-frame, i.e.
     duration-bounded, not content-bounded);
  2. density-accuracy curve — lines per frame × effective sampling vs OCR accuracy
     on known source files (ground-truth diffable);
  3. temporal-redundancy bonus — static pages get multiple encoder samples
     (self-ensemble → reading robustness), vs a single screenshot baseline;
  4. A/B vs the same code as text: tokens, cost, accuracy.
  Deliverable: the density/token/accuracy data that decides whether heavy code
  context moves to a video channel (tools like ripgrep/CodeGraph become the
  point-sampling layer on top).

## Smoke Tests

- unit (test/session/): serialize a tool part with a data:video attachment → build 1
  contains digest + separate user media message; build 2/3 contain the placeholder
  with the part ID and are byte-identical to each other.
- unit: `Token.estimate` on a 2.7M-char data URL ≈ fixed small value (not len/4).
- DB canary: `delivered` column migration applies; projector round-trips.
- typecheck exit 0 (provenance-verified fresh cmd_runner session).
- live (user rebuild): repeat the video scenario — HTTP 200, video in a user message,
  tool msg = digest, subsequent turns carry no blob, no emergency compaction,
  provider cached_tokens > 0.

## Rollback

Each slice is independent; revert commits individually. The `delivered` column is
additive (nullable) — old code ignores it.

## Closure (2026-09-11, reconciled — plan was stale-DRAFT despite shipped code)

- **C1** (media once + `mediaDelivered` metadata marker on the tool part,
  pointing at the user message carrying the actual media) — shipped in
  `4db8001bae`. Code: `processor.ts:584`, gated in
  `message-v2.ts:1077-1084`.
- **C2** (media never counted as text/chars-4) — shipped alongside C1 in
  `4db8001bae` as a provider-calibrated per-model EMA
  (`session/overflow.ts` `estimateMediaTokens` / `MediaTokenCalibration`),
  not the literal `Token.estimate` patch this doc originally sketched —
  `overflow.ts:109-121`'s docstring cites the same 2.7M-char / ~688K
  phantom-token numbers this plan's root cause used.
- **C3** (canonical placeholder-by-ID for heavy text results) — shipped in
  `be9ace3ed2`. Code: `message-v2.ts:847` (`[<tool> id=<partID> — result
  delivered earlier ...]`).
- Oracle: `bun test test/session/compaction.test.ts test/session/message-v2.test.ts`
  → 113 pass / 0 fail (`packages/opencode`, 2026-09-11); `bun typecheck`
  exit 0 (repo-wide, same session).
- **C4** (digest policy for medium-length outputs after K turns) — not
  implemented; explicitly optional/deferred in this plan's own text, not a
  gap.
- **C5** (video-as-context measurement program) — NOT part of this
  closure; it has its own plan (`plans/2026-09-07_video-context-fractal-program.md`,
  still Status: DRAFT/staged, Stage 1 probes ongoing) and stays open there.
