# Subplan 02: jsonc everywhere — `//` comments in ALL settings files

plan_id: 2026-08-31-settings-02-jsonc
state: IMPLEMENTED (2026-09-06, rev 1 — sessions loader jsonc + Config.update text-patch writer; step 4 N/A: no config template creator exists in the product, grep-verified — requirement activates when one appears)
parent: [master.md](master.md)
policy: "Yeah, all setting must have // comments, format jsonc" (Alexander, 2026-08-31 04:36 UTC)

## Abstract

Every settings file must be jsonc and every loader must tolerate `//` comments. Today the loaders are inconsistent: the main config loader uses jsonc-parser (config.ts:13 `import { applyEdits, modify } from "jsonc-parser"`, `ConfigParse.jsonc`), while persisted TUI state files are strict JSON — the jsonc FORMAT is fine, but these loaders use `JSON.parse`, which REJECTS comments: the throw is caught, settings come back null, and the next save rewrites the file without them (silent loss, not a crash — wording corrected 05:45 UTC per Alexander's challenge).

## Current loader matrix (dependent code)

| File | Format today | Loader | Comment-tolerant | Rewrite preserves comments |
|---|---|---|---|---|
| `Global.Path.config/opencode.jsonc` | jsonc | `loadGlobal`/`readConfigFile` (config.ts:145+ gateway variant; config Parse jsonc) | ✅ | ✅ `patchJsonc` (config.ts:466-478, 1084) |
| project `opencode.json(c)` / `config.json` | jsonc | `loadFile` → ConfigParse | ✅ | ⚠️ `Config.update` writes plain `JSON.stringify` (config.ts:1042-1044) — comments LOST on update — **BUG** |
| `sessions/{sid}.jsonc` | jsonc-named | strict `JSON.parse` (session-settings.ts:229-231 — comment says "jsonc-parser not needed") | ❌ comments REJECTED: JSON.parse throws SyntaxError → caught (:232-238) → settings silently null → next save overwrites the file (comment + settings wiped) — BUG | ❌ writeJson (session-settings.ts:310) |
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

## Prior art (REUSE.BEFORE)

- **In-repo jsonc text editing** — `patchJsonc` (config.ts:473-485) + `updateGlobal` jsonc branch (config.ts:1122-1126): jsonc-parser `modify`/`applyEdits` with `formattingOptions {insertSpaces, tabSize: 2}`. Same pattern in `plugin/install.ts` `patch()`. No new dependency — jsonc-parser already ships.
- **RFC 7386 mergePatch** (config.ts:493-508, subplan 05 rev 2) — null = delete at the object level. This plan lifts null=delete to the TEXT level: jsonc `modify(text, path, undefined)` removes the property while keeping every other comment/format byte.
- **Comment-tolerant parse** — `ConfigParse.jsonc` (config/parse.ts) wraps jsonc-parser `parse`, already the product loader standard.
- **$schema injection contract** — `loadConfig` (config.ts:582-586) injects `$schema` into the file text when missing; the new writer must reproduce it (pollution-guard test asserts the key set).
- reuse: local — all surfaces are in-repo patterns; no universalsearch hit needed for a jsonc writer.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (recorded before any implementation edit)
| # | Command (cwd packages/opencode) | Expected before fix | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `cmd_runner start -- bun test --timeout 30000 test/session/session-settings-persist.test.ts test/server/httpapi-config.test.ts -t comments` | NEW tests FAIL: commented session file → settings null; PATCH rewrite drops `//` | FAIL `20260906T035458Z_ab102b37`: 2 fail / 1 pass — jsonc-load null ✓, PATCH comment dropped ✓; malformed-jsonc invariant passed (must stay passing) |
| 2 | typecheck | exit 0 (tree was green pre-edit) | exit 0 — `20260906T014652Z_e91dd478` (provider-turn final oracle, same tree before 02 edits) |

### Post-implementation oracles
| # | Command (cwd packages/opencode) | Pass criteria |
|---|---------------|--------------|
| 1 | same as baseline 1 | jsonc case passes: settings load with comments present |
| 2 | same as baseline 2 | comment survives BOTH patches (set + null-delete); values patched |
| 3 | `cmd_runner start -- bun test --timeout 30000 test/server/httpapi-config.test.ts test/session/session-settings-persist.test.ts` | full both files 0 fail (rev-2 merge-patch suite stays green) | PASS `20260906T035954Z_f216ef3d`: 30 pass / 0 fail |
| 4 | `cmd_runner start -- bun run typecheck` | exit 0 | PASS `20260906T040113Z_ed2f5d45` |

### Gate
- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Implementation (landed 2026-09-06)

- `session-settings.ts` `loadSessionSettings`: `JSON.parse` → jsonc-parser `parse(raw, errors)`; comments tolerated, malformed jsonc → warn + null (never crash). Writer unchanged (clean JSON) — v1 trade-off documented in the module docstring. Gap C (master) closed.
- `config.ts` `patchJsonc`: RFC 7386 null = DELETE at the text level (`modify(path, undefined)` removes the property, all other comments/format bytes preserved; top-level null = no-op). `Config.update` rewritten: `readConfigFile` text → `patchJsonc(before, writable(patch))` → validate via `ConfigParse.effectSchema(Info, ConfigParse.jsonc(next))` → `$schema` injection when missing (mirrors `loadConfig` load-time normalization) → write. The old `JSON.stringify(mergePatch(...))` writer is gone; dead `mergePatch` removed — its semantics now live in `patchJsonc`.
- **Side unlock (01/04 gap):** the server-side global set-only limitation is GONE — `updateGlobal` uses the same `patchJsonc` and now accepts null = clear. TUI wiring (clear variant/routing in global scope) remains a follow-up for the dialog callers (`writeGlobalAgentField` / `setProviderRouting` don't send nulls yet).
- Behavior compatibility proven by the untouched rev-2 suite (30/0): set, null-delete, wholesale array replace, pollution guard ($schema + seeded keys intact).
- Step 4 (generated config templates with `//` headers): **N/A** — no template-creating code exists (`grep --template|initCommand` in src → nothing).

## Test cases

1. `loadSessionSettings` on a file containing `// comment` → parses, comment ignored (unit test in test/session or a new settings test).
2. `Config.update` after adding a comment to project config → comment still present (integration test on temp dir).
3. typecheck + existing config tests green.
