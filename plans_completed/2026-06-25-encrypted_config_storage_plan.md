---
status: completed
owner: codex
last_verified: 2026-06-25
reproduce:
  - cd packages/opencode
  - bun test test/auth/auth.test.ts test/config/config.test.ts test/session/checkpoint.test.ts test/session/request-diff.test.ts
  - bun typecheck
  - ../../tools/adm.exe --verify-all src/auth src/config src/util test/auth test/config test/session
---

# Encrypted Config Storage Plan

## Goal

Provide encrypted mirror storage for global `auth.json` and `opencode` config files while preserving existing plaintext behavior when plaintext files are present.

## Abstract Definition

Let `P` be a plaintext JSON or JSONC path under `Global.Path.config`, and let `E = P + ".enc"`.

Read rule:

```text
read(P) =
  parse(P) when exists(P)
  decrypt_parse(E) when !exists(P) and exists(E)
  empty/default otherwise
```

Write rule:

```text
write(P, value) =
  write(P, value) and mirror(E, value) when exists(P)
  encrypt_write(E, value) when !exists(P)
```

## Structural Diagram

```text
Auth.set/remove ─┬─ plaintext auth.json exists ── write auth.json + auth.json.enc
                 └─ plaintext auth.json absent ── write auth.json.enc only

Config.load ─────┬─ global config plaintext exists ── load plaintext + mirror .enc
                 └─ plaintext absent, .enc exists ── decrypt .enc

Config.updateGlobal ─┬─ selected plaintext exists ── preserve JSON/JSONC + mirror
                     └─ no plaintext selected ───── encrypted-only opencode.jsonc.enc
```

## Tasks

- [x] Add reusable encrypted JSON helper with AES-GCM payloads and local key material.
- [x] Route auth read/write through plaintext-first encrypted mirror semantics.
- [x] Route global config read/write through plaintext-first encrypted mirror semantics.
- [x] Add auth/config/checkpoint regression tests for encrypted-only fallback and storage isolation.
- [x] Run focused Bun tests.
- [x] Run typecheck.
- [x] Run ADM verification.

## Test Cases

- Plaintext `auth.json` mirrors into `auth.json.enc`, and encrypted fallback works after plaintext removal.
- Missing `auth.json` causes writes to use encrypted storage only.
- Plaintext `opencode.jsonc` mirrors into `opencode.jsonc.enc`, and encrypted fallback works after plaintext removal.
- Missing global config causes `updateGlobal` to write encrypted-only `opencode.jsonc.enc`.
- Legacy global config migration writes encrypted-only `config.json.enc` when no plaintext `config.json` exists.
- Stale checkpoint key failure does not delete request-diff baselines.
