# Kernel / ACL alignment: fixed tool schemas and deny-only execution policy

## Goal

Make the kernel, role transition prompts, and runtime ACL describe one coherent
model: provider-visible tool schemas are immutable for every identity, and
permissions are enforced only when a tool executes.  Ordinary identities start
allowed; restrictions are explicit denies.  `reasoning_mode` remains the sole
capability-minimal exception.

This plan is deliberately about **runtime behavior**, not hiding tool schemas.
No task below may filter, reorder, or otherwise personalize the provider tool
catalogue.  That invariant preserves the byte-stable system/tool prefix needed
for prompt-cache reuse.

## Grounded current state

- `packages/opencode/src/tool/registry.ts` deliberately returns the full tool
  registry for every role.  The active registry test still contains two stale
  expectations that protected roles receive a reduced list; both now fail.
- `packages/opencode/src/agent/agent.ts` has a default `"*": "allow"` rule and
  native-role denies, but its role matrix does not yet match the kernel or the
  requested behavior.  In particular, `coder_agent` inherits `pipeline` and
  can currently change plan files; `general_agent` is denied edits; and
  `researcher_agent` is not limited to Internet search.
- `packages/opencode/src/session/prompt/reasoning_prompt.txt` currently says
  `reasoning_mode` is memory-only in the identity table but later says it has
  zero tools.  Those statements are incompatible with the required permanent
  memory capability.
- `packages/opencode/src/tool/universalsearch.ts` accepts `agent`, `web`,
  `code`, and `hybrid` sources, so a name-only ACL cannot express
  “researcher: Internet only”.

## Target contract

### Global invariants

| Invariant | Required implementation consequence |
|---|---|
| Tool schemas never vary by role or mode. | `ToolRegistry.tools` always exposes the same ordered schemas; ACL denials occur only when a tool is invoked. |
| Normal identities are permissive by default. | Do not add affirmative per-tool ACL entries merely to restore baseline access; add explicit deny rules only. |
| `reasoning_mode` is the exception. | Keep a deny-all boundary, then permit only `getmode`, `memory`, and its own `reasoning_exit`; `todowrite` remains denied. |
| `getmode` is universal. | All interactive modes and subagents may call it; hidden title/summary identities remain system-internal and toolless. |
| Todo is session-local. | Every interactive mode/subagent may use `todowrite` in its own session except `reasoning_mode`. |
| A subagent never changes a mode. | `plan_*` and `reasoning_*` transitions are denied to every specialized subagent. |

### Identity permissions to encode

“Default” means the shared permissive baseline, not an ACL `allow` override.

| Identity | Explicit execution denies / special boundary | Required capability result |
|---|---|---|
| `build_mode` | Mode transitions it does not own; existing destructive protections. | Full implementation and ordinary task delegation under the separate delegation policy. |
| `plan_mode` | Product writes and all implementation/shell/delegation paths outside its planner boundary; mode transitions it does not own. | Plan-only authoring and read/search; no implementation and no arbitrary task launch (the declared explorer discovery path remains separately bounded). |
| `reasoning_mode` | `*` denied except `getmode`, `memory`, and `reasoning_exit`, including `todowrite`. | Pure current-conversation reasoning plus permanent memory, with its controlled exit. |
| `coder_agent` | `task`, `pipeline`, job cancellation, mode transitions, and the entire edit family for `plans/**` / `plans_completed/**`. | May implement approved product changes, but cannot launch workers, alter plans, or alter control-plane state. |
| `general_agent` | `task`, `pipeline`, job cancellation, and mode transitions. | May inspect, reason, search, and edit files as a direct general-purpose duty. |
| `explorer_agent` | All mutation, task/delegation, job cancellation, and mode-transition tools. | Read-only discovery through every search mechanism available to the product. |
| `researcher_agent` | All mutation, task/delegation, job cancellation, mode transitions, and every local/non-Internet search route. | External Internet research only (`webfetch` and `universalsearch` strictly with `source: "web"`). |
| `media_agent` | `task`, pipeline/delegation, job cancellation, and mode transitions. | Existing media generation/processing behavior, plus ordinary read/status/todo baseline. |
| `orchestrator_agent` | Source mutation, shell/tests, job cancellation, and mode transitions. | Plan authoring and its bounded worker delegation only. |
| `title_agent`, `summary_agent` | `*` denied. | Hidden text-only system output; excluded from the interactive `getmode`/todo rule. |

### Mode transition ownership

The implementation must choose one explicit owner per transition and test it
at execution time.  The non-negotiable rule is that no subagent receives any
of these permissions.  The intended primary-mode flow is:

| Transition | Target owner |
|---|---|
| `plan_enter` | `build_mode` |
| `plan_exit` | `plan_mode` |
| `reasoning_enter` | `build_mode` |
| `reasoning_exit` | `reasoning_mode` |

`orchestrator_agent` is a specialized subagent for this policy even though the
runtime currently labels it `mode: "primary"`; it is explicitly denied all four
transitions.  Update the present `tool/reasoning.ts` native-orchestrator guard
to this table and represent the same owners in the ACL and kernel.  It must not
rely on a transition-notification sentence.

## Implementation tasks

- [x] **T1 — Make the kernel the complete role contract.**
  - Update `packages/opencode/src/session/prompt/reasoning_prompt.txt` identity
    tables and detailed role sections to match the target matrix.
  - Remove the `reasoning_mode` contradiction: describe permanent `memory`,
    `getmode`, and its own `reasoning_exit` as the only tool capabilities; keep
    external access, filesystem, search, and todo forbidden.
  - State that `general_agent` may edit, `explorer_agent` uses all search
    mechanisms read-only, `researcher_agent` uses Internet search only, and
    `coder_agent` neither delegates nor changes plans.
  - Change the plan-mode delegation statement that currently permits
    `task(general_agent)`; it is a kernel bug under the requested planner
    boundary.
  - Align the compact transition/role prompt fragments under
    `packages/opencode/src/session/prompt/` with that shared kernel.  They may
    remind an identity of the contract but cannot grant a capability.

- [x] **T2 — Encode the deny-only ACL matrix.**
  - Update `packages/opencode/src/agent/agent.ts` without adding normal
    per-tool `allow` entries.  Retain the shared default allow and express each
    role difference as an explicit deny.
  - Permit `general_agent` edits by removing its edit-family denials; do not
    replace them with allow rules.
  - Deny `coder_agent` `pipeline` and job cancellation.  Use the one canonical
    path rule, `edit: { "plans/*": "deny", "plans_completed/*": "deny" }`,
    because `write`, `edit`, `applypatch`, `multiedit`, and `restore` all call
    `ctx.ask({ permission: "edit" })` before their ordinary write.  Prove in
    tests that every alias reaches that gate before it writes rather than
    duplicating policy aliases.
  - Close the two known edit-gate bypasses before relying on that rule:
    `restore` must resolve the original target provenance or fail closed for
    `coder_agent` instead of authorizing its backup-only `*` pattern; and
    `applypatch` must include its `movePath` destination in the checked
    permission patterns.  Test a move from a permitted source into `plans/**`.
  - Keep explorer mutation-free while leaving all read/search tools available.
  - Give researcher a strict tool-level Internet-only boundary.  Explicitly
    deny the actual local search/read policy IDs: at minimum `read`, `glob`,
    `grep`, `fossilgrep`, `codegraph`, `messagesearch`, `dbread`, `logsearch`,
    `sessionread`, `compare`, and `treediff`; enumerate the complete registry
    before the edit so no default-allow search route remains.  Retain only
    `webfetch`, `universalsearch` (parameter-constrained by T3), `getmode`, and
    `todowrite` from the relevant capability set.
  - Explicitly deny every transition key to every specialized subagent;
    assign each primary-mode transition only to its resolved owner.
  - Preserve the existing configuration rule that untrusted config may add
    denials but cannot reopen a native-role boundary.

- [x] **T3 — Add a parameter-level guard for researcher Internet search.**
  - Add a narrowly scoped execution guard at the `universalsearch` invocation
    path (`packages/opencode/src/tool/universalsearch.ts`, or a shared
    permission helper if that is the already-established gate).
  - For `researcher_agent`, accept only an explicit `source: "web"`.
    Reject omitted source, a `job_id` without explicit web source, and `agent`,
    `code`, or `hybrid` before `ctx.ask`, job polling, or any search-backend
    dispatch.  Do not encode the rule by deleting enum values or changing the
    provider schema.
  - Keep `webfetch` available to researcher.  Test the guard with both allowed
    and denied source values and a direct proof that no non-web backend was
    called on rejection.

- [x] **T4 — Repair schema-invariance regressions.**
  - Update `packages/opencode/test/tool/registry.test.ts` so it asserts equal,
    ordered full schemas for every native interactive identity, including
    `reasoning_mode`; it must not expect a reduced protected-role list.
  - Preserve the full catalogue test as a byte/structure equality assertion,
    covering the presence of tools that execution ACL may later deny.
  - Investigate the two current custom-tool timeouts in that suite; identify
    their cause and make them complete reliably.  They are baseline failures,
    not “pre-existing” exclusions.

- [x] **T5 — Add execution-level regression coverage.**
  - Extend `packages/opencode/test/agent/agent.test.ts` for the complete
    matrix: general edit succeeds; coder plan mutations and pipeline fail;
    explorer mutation fails while every search family passes; researcher
    non-web routes fail; getmode/todo behavior is correct; and all subagents
    fail every mode transition.  For researcher, enumerate each actual local
    search/read policy ID rather than relying on a broad prose category.
  - Extend `packages/opencode/test/session/tools.test.ts` with actual tool
    execution boundaries, especially the full edit-family aliases and the
    resolved reasoning-transition owner.  Assertions must prove rejection at
    the ACL/runtime gate, not merely evaluate a prompt string.
  - Add/extend a focused universalsearch test for T3.  It must prove the
    parameter guard rather than a schema difference.

- [x] **T6 — Verify cache and policy end-to-end.**
  - Run the affected suites from `packages/opencode`:
    `bun test test/agent/agent.test.ts --timeout 30000`,
    `bun test test/session/tools.test.ts --timeout 30000`, and
    `bun test test/tool/registry.test.ts --timeout 30000`.
  - Run the focused universalsearch test, `bun run typecheck`, and
    `git diff --check`.
  - Compare the serialized tool-schema list across roles/modes in a regression
    test or deterministic test helper.  A denied execution must leave that
    list untouched.
  - Report any unrelated failure with its root-cause investigation status; do
    not label it pre-existing.

## Dependencies and implementation order

1. T1 establishes the single contract before changing enforcement.
2. Resolve transition ownership, then complete T2 and T3 together so policy
   cannot contradict the runtime guard.
3. T4 updates the stale cache/schema oracle before final validation.
4. T5 proves the actual boundaries; T6 is the acceptance gate.

## Smoke tests and acceptance criteria

| Criterion | Oracle |
|---|---|
| Tool schema is identical across identities. | Registry test compares the complete ordered schema sequence for every identity. |
| A deny blocks execution but does not hide a schema. | Session tools test sees the schema and then receives a deny at invocation. |
| Coder cannot mutate a plan by any edit alias or invoke a pipeline. | Agent/session tests exercise `edit`, `write`, `applypatch`, `multiedit`, `restore`, and `pipeline`. |
| General can edit. | Agent ACL test evaluates/executes an edit on a normal product path. |
| Explorer searches broadly but cannot mutate. | One test per search family plus a mutation denial. |
| Researcher is Internet-only. | `source: "web"` passes; omitted/agent/code/hybrid and local-search routes fail before backend dispatch. |
| Todo/getmode and transition ownership follow the contract. | Session execution tests cover each interactive identity and every transition key. |
| No cache-risking role-specific schema behavior remains. | Registry equality test and all three focused suites pass. |

## Verification record

- `bun test test/agent/agent.test.ts --timeout 60000`: 49 pass.
- `bun test test/tool/registry.test.ts test/tool/reasoning.test.ts test/tool/applypatch.test.ts test/tool/universalsearch.test.ts test/session/tools.test.ts --timeout 60000`: 41 pass.
- `bun run typecheck`: pass.
- `git diff --check`: pass (line-ending warnings only).

The custom-tool registry tests exposed a real readiness bug: the registry waited
for background dependency installation before importing every local tool. It now
imports first and waits/retries only after an import proves dependencies are
needed; all custom-tool regression cases complete within their declared timeout.

## Scope and non-goals

- This implementation does not alter the system prompt per turn.
- It does not broaden user-configured permissions into native-role grants.
- It does not change hidden title/summary agent behavior.
- It does not modify the unrelated untracked plan
  `plans/2026-08-16-excise-inject-summary-request.md`.
