<!-- intention: repeated schema-rejected edit calls loop ~50-475 times because the error names no shape and no guard spans turns -> the validation error states the expected shape from the schema itself, and a validation-layer repeat guard STALLs the Nth consecutive identical rejection -->
<!-- goal_sv:
Keywords: schema-loop 0.35, actionable-error 0.25, validation-guard 0.25, cross-turn Stall 0.15
Semantic dominant: A model that keeps sending the wrong edit shape gets an error that shows the right shape and, on the Nth identical rejection, a STALL refusal instead of turn 48 of the same failure.
md5: e7a1b3c4d5f60718293a4b5c6d7e8f90
prev-md5: 00000000000000000000000000000000
parent-goal-md5: bb33c8057b8b8034611310aae9bb9f85
-->

# t57 — the edit-tool schema loop: actionable error + validation-layer repeat guard

## Ground (2026-10-15, this session; DB + wire, not testimony)

- Schema requires `files` (`packages/opencode/src/tool/edit.ts:494-500`, `Parameters =
  Schema.Struct({ files: Schema.Array(FileChange) })`). Description (`src/tool/edit.txt:5-15`)
  advertises exactly `{"files": [...]}` — **no description/schema mismatch found**; nothing to
  repair there. The models' wrong shapes contradict the description, they are not taught by it.
- Wire (gateway perRequest capture is ON, `.opencode/gateway.jsonc:58`; payloads under
  `.opencode/data/log/*_payload_*.md`):
  - t46 (`ses_ec2961e15ffefWEjqE2WOQOj10`, glm-5.3-flash): `{"edits":"[{\"filePath\":...,
    \"edits\":[...]}]"}` (edits as STRING with nested filePath/edits) then
    `{"edits":"[{edits:[...], filePath:...}]"}` (nested) → always
    `SchemaError(Missing key at ["files"])`.
  - t56 (`ses_ec0e750eeffe9eXHP4zA4j177P`): 49x `{"edits":...}` top-level, 1x
    `{"edits","filePath"}` top-level (the write-tool shape; `edit.txt:5` already warns
    `filePath` is nested only for `edit`).
- Counts from `opencode.db` `part` table (state, not API projection):
  - t46: 886 edit parts, **872 schema errors, 2 distinct inputs run 475x then 390x consecutively**.
  - t56: 59 edit parts, **50 schema errors, one input run 47x**; plus 4x
    `no changes to apply — the result is identical` (execute-phase, error parts, also retried
    byte-identical — residual, out of scope for the validation-layer guard).
  - Correction to the brief: schema-rejected calls DO leave error parts with `state.input`
    recorded — a watcher reading state CAN see them. What cannot see them is the in-message
    doom-loop guard.
- Why the model does not recover: the error text (`src/tool/tool.ts:130`) is
  `The {id} tool was called with invalid arguments: {error}. Please rewrite the input so it
  satisfies the expected schema.` — names the missing key, shows no expected shape.
- Why no guard fires: `DOOM_LOOP_THRESHOLD = 3` (`src/session/processor.ts:70`) and
  `MAX_TOOL_CALLS_PER_MESSAGE = 64` (`:89`) are **per assistant message** (`ctx` rebuilt per
  message); each retry is a new turn, so 475 consecutive identical calls never meet 3-in-a-row
  in one window. The `experimental_repairToolCall` path (`src/session/tool-call-repair.ts`)
  only repairs JSON syntax, never schema shape.
- Shared error path: `wrap()` in `src/tool/tool.ts:103-154` — one place for all tools
  (`formatValidationError` override respected where defined; `edit` defines none).

## Tasks

- [x] T1 — Tests first: new `packages/opencode/test/tool/tool-validation-guard.test.ts`
  driving `Tool.define` + `info.init()` (as in `test/tool/tool-define.test.ts`), RED on today:
  RED receipt `20261015T105412Z_c1b911e4` exit 1 (2 fail on predicted assertions; received text
  is today's unshaped `SchemaError(Missing key at ["files"])`); GREEN receipt
  `20261015T105707Z_ff82028d` exit 0 (3 pass) after T2.
  <!-- sv:
  Keywords: test-first 0.45, red-baseline 0.30, guard-contract 0.25
  Semantic dominant: A named-file test pins the actionable error shape and the STALL-on-third-identical-rejection contract, and fails on today's unshaped text and unbounded repeats.
  md5: a1b2c3d4e5f60718293a4b5c6d7e8f91
  -->
- [x] T2 — Implement: new `packages/opencode/src/tool/validation-guard.ts` + `wrap()` wiring
  (`src/tool/tool.ts:126-137`); N = 3 consecutive identical rejections → STALL via the existing
  error-part path. No description/schema mismatch found (recorded in Ground).
  <!-- sv:
  Keywords: validation-guard 0.40, schema-example 0.30, stall-route 0.30
  Semantic dominant: One shared validation path emits a shape-showing error and refuses the third consecutive identical rejection with a STALL that lands in state.
  md5: b2c3d4e5f60718293a4b5c6d7e8f9012
  -->
- [x] T3 — Oracles: new tests GREEN (`20261015T105707Z_ff82028d`, 3 pass);
  `test/tool/tool-define.test.ts` GREEN (`20261015T105750Z_ab9ce1ce`, 5 pass);
  `test/tool/svm.test.ts` GREEN (`20261015T105830Z_28619a37`, 8 pass — the one consumer matching
  the error prefix); `bun typecheck` clean (`20261015T105907Z_fd761b38`, exit 0).
  <!-- sv:
  Keywords: oracle 0.40, regression 0.30, typecheck 0.30
  Semantic dominant: The change is proven by the new file green, the shared-path neighbor green, and typecheck clean.
  md5: c3d4e5f60718293a4b5c6d7e8f90123
  -->
- [ ] T4 — Close: commit naming the plan (own paths only), one `_progress_log.md` entry
  (shared file — keep BOTH on conflict), mandatory `_build.ps1` receipt. Untried named in the
  final message.
  <!-- sv:
  Keywords: commit 0.40, progress-log 0.30, build-receipt 0.30
  Semantic dominant: The work lands as one named commit with a shared-log entry and a build receipt, or the gap is named.
  md5: d4e5f60718293a4b5c6d7e8f9012345
  -->

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/tool/tool-validation-guard.test.ts` —
  RED first (today: no received-keys line, no example, no STALL on repeats), then GREEN after T2.
- `cmd_runner start --cwd packages/opencode -- bun test test/tool/tool-define.test.ts` — green
  before and after (shared-path regression).
- `bun typecheck` from `packages/opencode` — clean.
- `pwsh -NoProfile -File _build.ps1` from repo root — exit 0.

## Bounds

steps 60, tools 140, loops 4, depth 2, time 3 600 000 ms. G4: MODIFY_PROJECT
(`src/tool/tool.ts` + new `src/tool/validation-guard.ts` + new test + plan file PLAN_WRITE),
ALLOW under brief authority + build_mode `* allow`; no build by this robot except the mandatory
final `_build.ps1`; never `bin/`; never `--no-verify`.

## Constraints

- Branch `Local_Development`; no worktree; stage by path only (`git add <path>`), never `-A`.
- `_progress_log.md` is shared: append one entry; on conflict keep BOTH.
- Tests: one file per call, through cmd_runner; read `state.json` and the whole output.
- A red test is first a question about the TEST against the requirement; never weaken it.
- `packages/opencode/test/tool/universalsearch.test.ts` is another robot's surface (t56 left it
  red-adjacent with LSP errors) — do NOT touch it.
