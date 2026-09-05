# Clipboard image → vision-gated native passthrough

Date: 2026-09-05
Status: COMPLETE (2026-09-05) — all tasks done, oracles PASS
Branch: Local_Development

## Goal

Pasted clipboard images (data: URL file parts) must reach the model **as an image part**
when the model has image-input capability, and only fall back to markdownify text
conversion when it does not. Today the data: branch in `SessionPrompt.resolveUserPart`
unconditionally converts every non-text/plain data URL via `convertDocument` and **drops
the file part entirely** — so even vision-capable models never see the image.

User-verified reproduction: clipboard paste produced only
`Called the Read tool with the following input: {"filePath":"clipboard"}` + `![Image]()`
(markdownify metadata for a filename without extension) — the image bytes never reached the model.

## Root cause

`packages/opencode/src/session/prompt.ts` (~line 1303, `case "data:"` in
`createUserMessage → resolveUserPart`): the non-text/plain branch decodes the base64,
runs `convertDocument`, and returns only synthetic text parts — `{ ...part }` is never
returned, unlike the `text/plain` branch (line 1300) and the `file:` branch (line 1421/1478).

Downstream is already capable: `message-v2.ts:942-956` passes persisted user file parts
(data: URLs included) into `convertToModelMessages` → image content blocks. The capability
pattern already exists: `model.capabilities?.input?.image`
(`message-v2.ts:853`, `attachment/handlers/image.ts:106`, populated at `provider.ts:1226`).

## Tasks

1. **prompt.ts — vision gate in data: branch**
   - If `part.mime.startsWith("image/") && !part.mime.includes("svg")`:
     resolve `provider.getModel(info.model.providerID, info.model.modelID)` via `Effect.exit`
     (same pattern as the `file:` branch, line 1397). On success AND
     `model.capabilities?.input?.image` → return `[Read synthetic text, { ...part, messageID, sessionID }]`
     (native passthrough).
   - Otherwise (non-vision model, svg, getModel failure) → keep existing markdownify
     conversion unchanged as the fallback.
2. **TUI — clipboard filename extension**
   - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` lines 293 and 1083:
     `filename: "clipboard"` → derive extension from mime (`clipboard.png`), so the Read
     synthetic text and markdownify metadata carry a meaningful name.
3. **Tests — `packages/opencode/test/session/prompt.test.ts`**
   - Vision model variant (config models entry with `modalities: { input: ["text","image"], output: ["text"] }`,
     supported by `src/config/provider.ts:45`).
   - Test A (vision): prompt with `data:image/png;base64,<1x1 png>` file part, `noReply: true`,
     explicit `model:` override → stored message KEEPS the file part (original data URL) + Read synthetic text.
   - Test B (non-vision, default cfg): same prompt → NO file part; synthetic text contains
     `![clipboard.png](clipboard.png)` (markdownify output; probe-verified in this env:
     `convertDocument(png, "clipboard.png")` → `"# Image\n\n![clipboard.png](clipboard.png)"`).

## Smoke Tests

- Baseline (SMOKE.BEFORE): probe `convertDocument(png, "clipboard.png")` → `"# Image\n\n![clipboard.png](clipboard.png)"`
  [Exact, executed via cmd_runner, exit 0].
- Baseline for new behavior: Test A FAILED before Task 1 (`filePart: undefined` — image dropped, bug reproduced);
  Test B passed before Task 1. [Exact, exit 1, 1 pass / 1 fail]
- Post-change oracle: `bun test test/session/prompt.test.ts -t "clipboard image"` → **2 pass / 0 fail** [Exact];
  `bun test test/session/prompt.test.ts -t "file part"` → **3 pass / 0 fail** [Exact];
  `bun run typecheck` (tsgo --noEmit) → **exit 0** [Exact].

## Outcome

- `src/session/prompt.ts`: image data URLs now pass through natively when the resolved model
  has `capabilities.input.image`; svg, unknown models and non-vision models keep the
  markdownify fallback (unchanged).
- `src/cli/cmd/tui/component/prompt/index.tsx`: clipboard attachments named
  `clipboard.<ext>` (e.g. `clipboard.png`) instead of extensionless `clipboard`.
- Scratch probe deleted; unrelated dirty work in the tree untouched.

## Claims

- C1: data: image parts are dropped for all models today (code-read: return paths of the branch).
- C2: `model.capabilities.input.image` is the established vision flag (provider.ts:1226, message-v2.ts:853).
- C3: markdownify works in the bun test env (probe [Exact]).
- C4: noReply prompts persist parts without LLM calls (existing missing-file tests [Exact]).

## Risks

- R1: `convertDocument` throw dies the prompt for non-vision models (pre-existing, unchanged scope).
- R2: SVG excluded from native path deliberately (vision APIs reject svg; markdownify handles it as text).
- R3: `getModel` failure falls back to markdownify — safe default, no regression.
