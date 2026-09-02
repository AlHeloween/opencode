# Bug: CLI dies on invalid plaintext auth.json at raw start (defect escape from fsys.readJson)

plan_id: 2026-09-02-auth-json-raw-start-crash
state: IMPLEMENTED (2026-09-02)
origin: Alexander 2026-09-02 10:07 UTC — `opencode` in `d:\!Smit\Smit2-Pasha` dies with `UnknownError: SyntaxError: JSON Parse error: Property name must be a string literal` (stack: `~effect/Effect/successCont` → `runLoop` → `node:fs:159:13`). Context: raw-start phase — `auth.json` exists as plaintext/hand-seeded; the `.enc` mirror is created only later.

## Diagnosis [Exact — code]

1. `packages/core/src/filesystem.ts:75-78` — `readJson` runs `JSON.parse(text)` as a raw throw inside an Effect.fn generator → becomes a **defect** (die channel), while the declared error type is `Effect<unknown, Error>` (E channel). The type is a lie for parse errors.
2. `packages/opencode/src/auth/index.ts:65` — `fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))`: `orElseSucceed` catches ONLY the E channel; the parse defect escapes → propagates to the CLI top → printed as `UnknownError` JSON dump. Stack matches (`successCont` = continuation after the successful `readFileString`).
3. `Global.Path.config` = `exeDir` (`core/src/global.ts:16`) → portable exe in the project root → `authFile()` = `D:\!Smit\Smit2-Pasha\auth.json`. Confirms the reported path.
4. Raw-start semantics: plaintext `auth.json` exists before any successful parse ever created `auth.json.enc` + `.opencode.encryption.key`.
5. Secondary defect (same site): on parse failure the current code proceeds with `data = {}` and **mirrors the empty object** into `auth.json.enc` — poisoning the encrypted store; when the user later deletes the plaintext file, auth silently resets to empty.

Same defect class (healed by the core fix, no per-site changes needed): `core/src/npm.ts:154,155,199` (orElseSucceed / Effect.option), `opencode/src/provider/provider.ts:1738`, `opencode/src/mcp/auth.ts:58`, `opencode/src/storage/storage.ts:71`.

## Fix (smallest cohesive)

1. `core/filesystem.ts readJson` — wrap `JSON.parse` in `Effect.try` → typed `FileSystemError({ method: "readJson", cause })`. Signature unchanged (E channel finally matches the declared type).
2. `auth/index.ts readAuthData` — parse failure → `warn` log + return `{}` (unauthenticated) and **skip mirrorJson** (no empty-mirror poisoning).

## Smoke Tests

- Baseline (must FAIL before fix): `packages/core/test/filesystem/filesystem.test.ts` new case — readJson on a file with an unquoted property name piped through `Effect.orElseSucceed` must produce `Exit.isSuccess` (pre-fix: defect → Failure → FAIL). **Baseline confirmed: 24 pass / 1 fail (`20260902T101856Z_0df82d5e`) — defect escaped as predicted.**
- Auth oracle: `packages/opencode/test/auth/auth-raw-start.test.ts` — invalid plaintext `auth.json` (via `OPENCODE_TEST_CONFIG` tmp dir) → `Auth.all()` returns `{}`, no `auth.json.enc` created; valid plaintext → parsed record + `.enc` mirror created. **PASS: 2/2 (`20260902T102318Z_e55b32c1`).**
- Core suite post-fix **PASS: 25/25 (`20260902T102318Z_c43e0b3c`)** — baseline fail converted to pass by the typed-error fix.
- typecheck exit 0 in `packages/core` (`20260902T102341Z_ef436b2e`) and `packages/opencode` (`20260902T102341Z_be7e55f6`, exit_code.txt = 0).
- Live (user rebuild): invalid/hand-seeded `auth.json` in exe dir → CLI starts unauthenticated with a warning, no crash; valid file → auth works and mirror appears.

## Open items

- None for this bug. The defect class elsewhere is closed by the core fix (typed error), verified by the same test pattern.
