<!-- intention: images pasted into a vision model silently vanish on the wire -> every image reaches the provider as WebP and the model demonstrably sees it -->

# DeepSeek image delivery + WebP ingestion + @ai-sdk family update

```yaml
status: FIXED — live API proof 2026-09-18 (model read an 8×8 WebP probe and answered "Red")
raised: 2026-09-18 by Alexander, from the built binary
scope: packages/opencode provider stack + attachment ingestion; whole @ai-sdk family bumped
```

## Context / goal

Pasted images never reached DeepSeek. The UI showed "Called the Read tool" for the
turn, the DB held the file part, and the wire held nothing — silently. Separately:
every image should be converted to WebP (quality 80, effort 6) before it is sent.
The user then directed: update the whole `@ai-sdk` family ("массовая замена на
проводах").

## Prior art

`reuse: N/A — local-only` for the wiring (the attachment package already existed
with a designed-but-unwired `normalize`); upstream reuse for the fix itself: the
newest `@ai-sdk/deepseek` (3.0.48) already serializes images as `image_url`
(gif/jpeg/png/webp) and already absorbed our fork predicate — so the fix is a
version bump + deleting the patch, not new code.

## Implementation steps

- [x] Root-cause: `@ai-sdk/deepseek@3.0.26` converter is text-only — non-text parts
      go to `warnings`, never serialized (`dist/index.js:72-88`). 183 raw-wire
      requests scanned: **zero** image parts.
- [x] Bump `@ai-sdk/deepseek` 3.0.26 → 3.0.48; delete
      `patches/@ai-sdk%2Fdeepseek@3.0.26.patch` (upstream `isDeepSeekV4Model` now
      covers `deepseek-flash`; assistant CoT kept + `reasoning_content` backfill).
- [x] Fix the stale `packages/opencode/node_modules/sharp` shadow dir (install of
      2026-07-18, no `@img/*` deps) — moved to `.temp/stale-nm-20260918/sharp`;
      resolution now climbs to the root store symlink.
- [x] `attachment/handlers/image.ts` — `normalize()` → WebP quality 80 / effort 6,
      resize cap 2000×2000, `animated: true`; never-failing fallback keeps the
      original bytes (`Effect.catch`, not `catchAll` — that API does not exist in
      effect@4.0.0-beta.57).
- [x] NEW `attachment/normalize.ts` — side-effect-registers all handlers (the
      registry had NO importer in src/ — handlers were never registered) and
      exposes `normalizeAttachment()` with a `never` error channel.
- [x] Wire ingestion: `session/prompt.ts` (every resolved user part) and
      `session/processor.ts` (tool-result media + stream-emitted files).
- [x] Whole family update to the coherent latest set — `ai` 7.0.106,
      `@ai-sdk/provider` 4.0.17, `provider-utils` 5.0.44, every `@ai-sdk/*`
      package, `ai-gateway-provider` 4.0.1, `gitlab-ai-provider` 6.15.1
      (root catalog + `packages/opencode`); `bun install` → 29 packages, clean.
- [x] Regression test `test/provider/deepseek-image.test.ts` (wire capture:
      `image_url` + `data:image/webp;base64,…`).
- [x] Packaged binary: declare `sharp` + `@img/*` platform packages in
      `packages/opencode` (mirrors the `@parcel/watcher-*` precedent) AND the
      `@img/*` set in the root `package.json` — the compiled binary resolves
      the native binding at RUNTIME from the cwd-adjacent `node_modules`
      (measured: run from `packages/opencode` loads sharp, run from the repo
      root did not until the root links existed). Handler registration is now
      LAZY (`import("./handlers/index")` on first normalisation) so an
      unresolvable native dep can never crash startup — the app degrades to
      "keep original bytes" instead.
- [x] Rebuild `pwsh _build.ps1` → smoke `10.0.1010` passed; `dist/bin/opencode.exe` refreshed.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (before the fix)

| # | Evidence | Expected now | Actual [Exact] |
|---|----------|--------------|----------------|
| 1 | raw-wire corpus scan (183 request bodies, `.opencode/data/gateway/per-request/`) | image parts present | **0 image parts**; 4-image turn went as plain text `"[Image 1]…"` |
| 2 | `@ai-sdk/deepseek@3.0.26` `dist/index.js:72-88` | — | non-text parts pushed to `warnings`, never serialized |
| 3 | `bun test test/attachment/image.test.ts` | pass | blocked: `Cannot find module '@img/colour'` (stale sharp shadow) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria | Actual [Exact] |
|---|---------------|---------------|----------------|
| 1 | `bun typecheck` (packages/opencode) | exit 0 | **exit 0** after the whole family update |
| 2 | `bun test test/attachment/` | all green | **42 pass / 0 fail** |
| 3 | `bun test test/provider/deepseek-image.test.ts` | wire body carries `image_url` | **1 pass / 0 fail** |
| 4 | live `api.deepseek.com` smoke, `deepseek-flash` | image understood | text `ok` in=37; 8×8 WebP → **"Red" in=225** |
| 5 | `bun test test/provider/` (`--timeout 30000`) | all green | **491 pass / 0 fail** (27 files) |
| 6 | `bun test` targeted session set (message-v2, llm, deepseek-defence, processor-effect, tools, structured-output ×2, finish-step, model-sampling) | all green | **117 pass / 4 skip / 0 fail** |
| 7 | `pwsh _build.ps1` | smoke passes | **Smoke test passed: 10.0.1010** + kernel asset check |
| 8 | E2E: `dist/bin/opencode.exe run "Read the image file .temp/e2e-red.png …"` (repo root) | model answers the colour | **"Red"**; stored part `prt_0b326a1810…` = **`image/webp`** (143-char data URL); wire body `1789712048905_req_57…json` carries `"image_url": {"url": "data:image/webp;base64,UklGRg…"}` |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Residual [Unknown]

- Pre-fix history images stay PNG in the DB: conversion is ingestion-time, the
  replay path is not re-encoded. A one-shot migration is possible if wanted.
- `src/config/attachment.ts` (`max_width` / `max_height` / `max_bytes`) is not
  mounted in the root Config schema — the handler always uses its 2000×2000
  default. Mounting it is a separate small task.
- `@ai-sdk/vercel@3.0.30` still pins `@ai-sdk/provider@4.0.7` (upstream lag;
  structurally assignable — typecheck green). `venice-ai-sdk-provider` remains on
  the provider 3.x line (V3 models).
- Stale sharp copy kept at `.temp/stale-nm-20260918/sharp` (reversible; gitignored).
