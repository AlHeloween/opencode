# Plan: isolate the OpenCode binary build from Web UI dependency resolution

- plan_id: 3b1cd615-ef81-4bc1-9ae2-564cb8491de0
- revision: 2
- created_by: build_mode
- state: **COMPLETED** (implementation, declared oracles, and independent audit passed on 2026-08-17)
- date: 2026-08-17

## Goal

`_build.ps1` must build the current Windows OpenCode binary without re-resolving the
already-installed `packages/app` dependency `ghostty-web`. The binary intentionally embeds
the built Web UI; it may use that existing artifact, existing current-platform OpenCode
dependencies, and locally built native artifacts, but must not turn a GitHub availability
failure for the Web UI terminal into a build failure.

## Claim ledger

| ID | Claim | Status | Evidence |
|---|---|---|---|
| B1 | `packages/app` owns `ghostty-web`; it is not a direct `packages/opencode` dependency, although its built Web UI is embedded in the binary. | Exact | `packages/app/package.json:64`; `build.ts:26,208`; `packages/opencode/package.json` has no such dependency. |
| B2 | The Web UI package is already installed and its build completed before the failure. | Exact | `packages/app/node_modules/ghostty-web` is a symlink into Bun's shared store; user capture contains `built in 22.41s`. |
| B3 | `script/build.ts` calls `bun install` with package arguments after building the Web UI. | Exact | `packages/opencode/script/build.ts:138-140`. |
| B4 | Those calls trigger a workspace resolution that fetches `ghostty-web` and makes `_build.ps1` fail on GitHub 504/429. | Exact | User's 504 trace; local dry-run reproduced a `ghostty-web` GitHub 429. |
| B5 | Filtering the workspace is a safe fix for this Bun canary behavior. | Rejected | `bun install --filter ./packages/opencode --dry-run` still fetched `ghostty-web`; no mutation may rely on it. |
| B6 | The `_build.ps1` current Windows target can use declared, already-installed `@opentui/core`, `@opentui/core-win32-x64`, and `@parcel/watcher` packages without package-manager mutation. | Exact | All are locally present; the script already copies the locally-built OpenTUI DLL itself. This claim does not cover a multi-target release build. |

## Repair

- [x] **B7 — remove package-manager mutation from the single-platform binary build.** Deleted
  the two package-argument `bun install` calls. Move the deterministic local Windows
  native-DLL/package-file copy out of that conditional so it still runs. Replace
  `--skip-install` with an explicit current-platform preflight for `@opentui/core`,
  `@opentui/core-win32-x64`, and `@parcel/watcher`; it names any missing path and instructs
  the caller to run the repository bootstrap install separately, but never does it itself.

  Oracle: PASS — with present dependencies, `bun run script/build.ts --single` completed
  with exit 0, built `opencode-windows-x64`, and its output contained no
  `ghostty-web`, `bun add`, or a GitHub download in its output. With a deliberately missing
  required package in an isolated test fixture, the actual preflight failed before compilation
  with its package path in the error and did not invoke a package manager.

- [x] **B8 — regression coverage.** Extracted only the dependency-preflight decision into a
  testable module/function and add focused tests for present and absent dependencies. The
  test must execute the actual preflight, not compare build-script text.

  Oracle: PASS — `bun test --timeout 30000 test/util/build-prerequisites.test.ts` passed 2/2;
  the absent case proves that the build reports a local prerequisite rather than starting Bun
  package resolution.

## Smoke Tests

### Baseline

- [Exact] `cd packages/opencode; bun run script/build.ts --single` — observed failure after
  Web UI build: Bun re-resolves `ghostty-web` from GitHub and `_build.ps1` exits 1.
- [Exact] `bun install --filter ./packages/opencode --os="*" --cpu="*" --dry-run` — local
  reproduction still resolves `ghostty-web` and fails with GitHub 429; filtering is not the
  repair.

### Post-change oracles

1. From `packages/opencode`: `bun test --timeout 30000 <focused-build-test>` exits 0.
2. From `packages/opencode`: `bun run script/build.ts --single` exits 0 and output contains
   neither `ghostty-web` nor `bun add` nor a GitHub dependency fetch.
3. From repo root: `git diff --check` exits 0.

## Verification record

- PASS — `bun test --timeout 30000 test/util/build-prerequisites.test.ts` (2 tests).
- PASS — `bun run typecheck`.
- PASS — `bun run script/build.ts --single`: Windows binary smoke and inlined-kernel smoke.
- PASS — `git diff --check` (only line-ending notices).

## Scope and risk

Paths: `packages/opencode/script/build.ts`, a focused test/helper under
`packages/opencode`, and this plan. Scope is `_build.ps1`'s current Windows `--single` path;
the multi-target release path remains unchanged. No dependency manifest, lockfile, or Web UI
source will be changed. The repair does not alter provider transport, gateway diagnostics,
cache accounting, or the system prompt.
