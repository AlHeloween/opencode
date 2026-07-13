# Subplan 03: Restore Strict OpenTUI Typechecking

## Objective

Fix all OpenTUI diagnostics instead of globally suppressing `noImplicitOverride` or filtering errors.

## Current Status — 2026-07-14

 `bun typecheck` from `packages/opencode` now passes with ZERO diagnostics.

## Target Area

`external/opentui/packages/core/src/`, specifically all TS4114 diagnostics plus `lib/tree-sitter/client.ts` TS2451.

## Steps

1. [x] Run the OpenTUI package typecheck independently and save the exact diagnostic inventory.
2. [x] Add `override` only to members confirmed by TypeScript to override a base-class member; preserve existing visibility/static/accessor ordering.
3. [x] Investigate both declarations of `OTUI_TREE_SITTER_WORKER_PATH` and consolidate the declaration ownership without changing runtime worker-path behavior.
4. [x] Run OpenTUI tests/build checks required by its local `AGENTS.md` after TypeScript changes.
5. [x] Run `bun typecheck` from `packages/opencode` to ensure the consuming package is clean.

## Guardrails

- Do not turn off `noImplicitOverride` in `packages/opencode/tsconfig.json`.
- Do not add blanket `@ts-ignore` or broaden `skipLibCheck`.
- Preserve portable Node/Bun/Deno behavior in OpenTUI FFI and runtime code.

## Acceptance Tests

- All TS4114 errors are resolved by real `override` modifiers.
- TS2451 has one canonical declaration.
- OpenTUI and `packages/opencode` typecheck report zero errors.
