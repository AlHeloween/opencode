# FIX: "Invalid prompt: The messages do not match the ModelMessage[] schema." (turn killed at 18:14:45)

plan_id: 2026-09-02-modelmessage-schema-invalid-prompt
state: IMPLEMENTED (2026-09-02)
origin: Alexander 2026-09-02 20:55 — «Invalid prompt: The messages do not match the ModelMessage[] schema. это что?». The error had ALREADY killed a turn in this session at 18:14:45 (the step after the TUI screenshot tool call — session.error + toast, turn died, no response after the screenshot).

## Root cause [Exact — captured payload + request diff + ai source]

The failing request is fully captured in `.opencode/data/log/1788372885351_payload_z-ai-glm-5.3-flash_*.md`
(AI_InvalidPromptError → AI_TypeValidationError → ZodError) and the request diff
`1788372885351/1788382593673_diff_*.diff` pins the failing message. The screenshot `read` tool
result produced a ModelMessage tool-result with TWO schema violations (ai@7.0.31):

1. `output = {type:"content", value:[{type:"text"...}, {type:"media", mediaType, data}]}`
   — `outputSchema` (ai/src/prompt/content-part.ts) content items accept `text | file |
   file-* | image-* | custom`. **`"media"` does not exist** — the type is a legacy shape
   that ai@7 rejects → invalid_union → whole request rejected.
   Source: `message-v2.ts toModelOutput()` emitted `type: "media"`.
2. `providerOptions = {preview: "Image read successfully", truncated: false, loaded: []}`
   — `providerMetadataSchema` is STRICT `record(provider → record(json))`; top-level
   scalars/booleans/arrays are invalid.
   Source: `message-v2.ts providerMeta()` forwarded the ENTIRE tool-part metadata
   (tool bookkeeping, not provider metadata) verbatim.

Why it was intermittent: the request that carried the FRESH tool result (same turn,
right after the tool executed) went through `toModelOutput` → media → fail. Later requests
served the same content through the fallback path (createToolModelOutput without
toModelOutput → `{type:"json", value}` — jsonValueSchema accepts any JSON) and passed,
masking the bug. The media path stayed live for every fresh tool result with an attachment.

## Fix

- `message-v2.ts toModelOutput()` — image attachments convert to the valid
  `{type:"file", mediaType, data:{type:"data", data:<base64>}}` content item (the schema's
  canonical inline-image form; the image still reaches the model).
- `message-v2.ts providerMeta()` — filters to provider-shaped record values only
  (objects, not arrays/scalars); `providerExecuted` still stripped. Tool bookkeeping
  metadata can no longer poison providerOptions.

## Smoke Tests

- Baseline (must FAIL pre-fix): new regression test in `test/session/message-v2.test.ts`
  mirrors the production tool part (image attachment + {preview,truncated,loaded} metadata)
  → **FAILED pre-fix** (`20260902T212735Z_a5d21d99`): received `{type:"media",...}` — the
  production-killing shape reproduced.
- Post-fix full `test/session/message-v2.test.ts` → **39 pass / 0 fail** (`20260902T213057Z_33cfef50`),
  including 3 tests whose assertions pinned the invalid "media" contract (updated to the
  valid file contract) and the new end-to-end check: converted messages pass the REAL
  `standardizePrompt` gate via `generateText` + `MockLanguageModelV3` (ai/test).
- Full `test/session` + typecheck `packages/opencode` → see _progress_log.md stamps.

## Open items

- Which exact path served turn-5 the json fallback (checkpoint-baked ModelMessages vs
  compaction rewrite skipping toModelOutput) — not load-bearing after the fix: both paths
  now emit schema-valid output.
- Assistant text/reasoning parts forward `part.metadata` unfiltered (message-v2.ts
  text/reasoning branches). Provider stream metadata is provider-shaped in practice; risk
  noted, unchanged in this scope.
