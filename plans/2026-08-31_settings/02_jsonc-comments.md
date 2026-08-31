# Subplan 02: jsonc everywhere — `//` comments in ALL settings files

plan_id: 2026-08-31-settings-02-jsonc
state: PLANNED
parent: [master.md](master.md)
policy: "Yeah, all setting must have // comments, format jsonc" (Alexander, 2026-08-31 04:36 UTC)

## Abstract

Every settings file must be jsonc and every loader must tolerate `//` comments. Today the loaders are inconsistent: the main config loader uses jsonc-parser (config.ts:13 `import { applyEdits, modify } from "jsonc-parser"`, `ConfigParse.jsonc`), while persisted TUI state files are strict JSON — a user comment would crash them or be silently wiped on rewrite.

## Current loader matrix (dependent code)

| File | Format today | Loader | Comment-tolerant | Rewrite preserves comments |
|---|---|---|---|---|
| `Global.Path.config/opencode.jsonc` | jsonc | `loadGlobal`/`readConfigFile` (config.ts:145+ gateway variant; config Parse jsonc) | ✅ | ✅ `patchJsonc` (config.ts:466-478, 1084) |
| project `opencode.json(c)` / `config.json` | jsonc | `loadFile` → ConfigParse | ✅ | ⚠️ `Config.update` writes plain `JSON.stringify` (config.ts:1042-1044) — comments LOST on update — **BUG** |
| `sessions/{sid}.jsonc` | jsonc-named | strict `JSON.parse` (session-settings.ts:229-231 — comment says "jsonc-parser not needed") | ❌ **crash on comment** — BUG | ❌ writeJson (session-settings.ts:310) |
| `model.json` (worktree state) | strict JSON | `Filesystem.readJson` (local.tsx:273) | ❌ | ❌ |
| auth / encrypted global mirror | encrypted JSON | EncryptedJsonStorage (config.ts:512-530) | n/a (machine-managed) | n/a |

## Implementation sketch

1. **sessions loader → jsonc-parser**: session-settings.ts `loadSessionSettings` — replace `JSON.parse` with `jsonc-parser`'s `parse` (errors tolerated → `{}` + warn, keep the existing warn-bug path at :233). Keep `saveSessionSettings` writing JSON but SWALLOW-PRESERVING: simplest correct v1 = keep writing clean JSON (machine-managed file), loader must simply not crash on hand-added comments. Document in the file header comment.
2. **`Config.update` comment preservation**: rewrite config.ts:1042-1044 to use `patchJsonc(existingText, patch)` over the file TEXT (mirror updateGlobal:1078-1087) instead of `JSON.stringify(mergeDeep(...))`. Acceptance: comments in project config survive a TUI-driven update.
3. **model.json**: stays machine-managed strict JSON (header comment written once is optional v2); loader hardening not required (no user editing). Decision recorded here to bound scope.
4. **Generated configs get `//` section headers**: any code that CREATES a config template (onboarding, `--template`) emits jsonc with grouped `//` section comments.

## I/O

- In: any settings file text with `//`/`/* */`.
- Out: parsed object identical to JSON.parse for the JSON subset; warnings (not crashes) on malformed jsonc.

## Test cases

1. `loadSessionSettings` on a file containing `// comment` → parses, comment ignored (unit test in test/session or a new settings test).
2. `Config.update` after adding a comment to project config → comment still present (integration test on temp dir).
3. typecheck + existing config tests green.
