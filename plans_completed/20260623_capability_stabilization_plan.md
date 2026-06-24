# Capability Stabilization Plan

**Created:** 2026-06-23
**Status:** Completed - capability service, tool, tests, TUI readiness, final explore validation, and archival are complete
**Parent:** `plans/20260623_agent_pipeline_media_plan.md`
**Scope:** Capability stabilization record. Implementation was authorized separately by user approval of Candidate 2 plus the follow-up W5 continuation.

## State

- mode: Mode C - Chained Execution
- governing_standard: ADID plus root `AGENTS.md`
- write_lock: false
- target_scope: stabilize `capability` service, tool, tests, and plan traceability
- known_blockers: none
- oracle_status: green for Candidate 2, W5 local oracles, and final explore validation
- provenance_path: implementation must use `updates/` descriptors and ADM verification

sv=[[capability,stabilization,service,tool,tests,provider,provenance], [0.22,0.20,0.16,0.15,0.12,0.10,0.05]]

## Goal

Make the capability lookup path reliable enough to be a foundation for media, pipeline, and task-agent work.
The end state is a single canonical capability service used by the tool, covered by focused tests, with clear failure behavior and no brittle duplicate model discovery.

## Non-Goals

- Do not implement `pipeline`.
- Do not add new native subagents.
- Do not inject capabilities into the system prompt in this stabilization pass.
- Do not change provider request conversion, message conversion, or KV cache behavior.
- Do not redesign provider model metadata beyond what capability lookup requires.
- Do not add real provider credentials or tracked capability secrets.

## Current Evidence

- [Exact] `packages/opencode/src/capability/index.ts` defines `Capability.Service`, schema-decodes YAML, and uses provider/auth services for lookup.
- [Exact] `packages/opencode/src/tool/capability.ts` delegates lookup to `Capability.Service`.
- [Exact] `packages/opencode/src/tool/registry.ts` registers the `capability` tool and provides `Capability.defaultLayer`.
- [Exact] `packages/opencode/test/capability/capability.test.ts` covers missing YAML, valid YAML, malformed YAML, filtering, sorting, formatted output, and schema rejection.
- [Exact] `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` renders `capability` output through a dedicated terminal TUI `BlockTool`.
- [Exact] W5 used terminal TUI evidence because generic terminal output is hidden by default.
- [Inferred] The remaining media/pipeline work can now depend on the stabilized capability surface.

## Workstreams

### W1 - Capability Data Contract

Objective:
Define and verify the persisted capability YAML contract.

Semantic deltas:
- Keep `models_capabilities.yaml` at `Global.Path.config`.
- Treat an absent file as an empty capability file with `version: 1`.
- Decode existing YAML with the schema before use.
- Fail malformed YAML with a clear `CapabilityError`; do not silently coerce unknown shapes.
- Preserve file mode `0600` or the platform-equivalent best effort on write.
- Keep provenance values explicit: `proven`, `tested`, `pending`.

Affected artifacts:
- `packages/opencode/src/capability/index.ts`
- new or updated tests under `packages/opencode/test`

Oracle:
- Valid YAML parses into entries.
- Missing YAML returns an empty versioned data set.
- Malformed YAML returns `CapabilityError`.
- Write creates the expected file content and does not expose secrets.

### W2 - Service Lookup Correctness

Objective:
Make `Capability.Service.lookup()` the single source of truth for model capability lookup.

Semantic deltas:
- Use provider service model data instead of direct `models.json` path reads.
- Use auth service data only for API key availability flags, never for secret output.
- Derive modality support from provider-normalized model capabilities.
- Support stable modality filters for text, image, audio, video, and pdf if provider capabilities expose pdf.
- Apply deterministic ranking: provenance first, available auth next, then stable provider/model order.
- Keep costs and notes as display metadata, not ranking-critical unless explicit sort criteria are added.
- Ensure service layer provisioning includes all required dependencies or is composed only at the caller boundary.

Affected artifacts:
- `packages/opencode/src/capability/index.ts`
- provider/auth test fixtures or service layers

Oracle:
- Proven entries rank before tested and pending entries.
- Models without required modality are filtered out.
- API-key availability is true only when auth data indicates usable credentials.
- Provider/model ordering is deterministic for equal ranks.
- Typecheck confirms no `any` escape hatch is introduced.

### W3 - Tool Delegation

Objective:
Make the `capability` tool a thin adapter around `Capability.Service`.

Semantic deltas:
- Replace duplicate YAML/model/auth readers with a call to `Capability.Service.lookup()`.
- Remove brittle direct path discovery for `models.json`.
- Replace free-string modality input with a narrowed schema.
- Return plain text output plus structured metadata.
- Surface service errors as tool failures or clear user-facing output; no silent `catch {}`.
- Preserve the existing registration path in `tool/registry.ts`.

Affected artifacts:
- `packages/opencode/src/tool/capability.ts`
- `packages/opencode/src/tool/registry.ts` only if layer wiring requires it
- capability tool tests

Oracle:
- Tool calls the service and returns the same ranked models.
- Tool output is stable enough for snapshot or string assertions.
- Invalid modality is rejected by schema.
- Registry still includes `capability`.

### W4 - Test Harness

Objective:
Add focused tests that prove the stabilized behavior without duplicating implementation logic.

Semantic deltas:
- Add service-level tests for YAML, lookup, filtering, auth annotation, and sorting.
- Add tool-level tests for parameter validation and formatted output.
- Use temporary config paths and in-memory service layers where possible.
- Avoid real credentials, network calls, or provider API calls.
- Keep tests runnable from `packages/opencode`.

Affected artifacts:
- `packages/opencode/test/capability/*` or nearest existing test convention
- any local fixture helpers required by existing test style

Oracle:
- `bun test` for the new capability tests from `packages/opencode`.
- `bun typecheck` from `packages/opencode`.
- Root `bun turbo typecheck` only if shared package or UI surfaces are touched.

### W5 - TUI Readiness Check

Objective:
Confirm whether the existing generic tool renderer is enough before adding UI-specific capability code.

Semantic deltas:
- Keep capability output plain text unless user experience is clearly poor.
- If a renderer is needed, implement only a small wrapper around the existing tool display pattern.
- Do not add a decorative or card-heavy custom UI for a simple lookup table.
- Update `plans/sub/20260623_A5_capability_tui.md` only after service/tool behavior is proven.

Affected artifacts:
- `plans/sub/20260623_A5_capability_tui.md`
- UI renderer files only if the follow-up implementation candidate authorizes them

Oracle:
- Manual or test-rendered output shows readable capability results.
- No TUI renderer work starts until W1-W4 are green.

### W6 - Plan Maintenance

Objective:
Keep active plans aligned with implemented reality.

Semantic deltas:
- After implementation, mark completed checklist items in this plan.
- Update the parent `plans/20260623_agent_pipeline_media_plan.md` only for confirmed capability status.
- Move this plan to `plans_completed/` only when all oracles pass and no plan-to-code gaps remain.
- Do not create or use `.opencode/plans/`.

Affected artifacts:
- `plans_completed/20260623_capability_stabilization_plan.md`
- `plans/20260623_agent_pipeline_media_plan.md`
- `plans_completed/` only after completion

Oracle:
- Exact diff inspection.
- ADM `--verify-all plans`.

## Dependency Chain

1. W1 data contract must be complete before W2 lookup correctness.
2. W2 service correctness must be complete before W3 tool delegation.
3. W3 tool delegation must be complete before W4 tool-level tests are finalized.
4. W4 tests must pass before W5 TUI readiness.
5. W6 plan maintenance runs after every implementation milestone.

## Candidate Implementation Plans

### Candidate 1 - Minimal Service Repair

Objective:
Fix only the service enough for safe lookup.

Semantic deltas:
- Schema-decode YAML.
- Confirm layer dependency provisioning.
- Add service tests for missing, valid, and invalid YAML.

Affected artifacts:
- `packages/opencode/src/capability/index.ts`
- service tests

Dependency chain:
- W1 -> W2 partial -> W4 service tests -> W6

Oracle set:
- capability service tests
- `bun typecheck` from `packages/opencode`
- ADM `--verify-all` on changed roots

Risk level:
- Low

Estimated change surface:
- Small

Why choose this:
- Best if the immediate goal is to reduce risk before touching the tool.

### Candidate 2 - Balanced Service and Tool Stabilization

Objective:
Make capability lookup usable end-to-end while keeping UI and pipeline out of scope.

Semantic deltas:
- Complete W1 data contract.
- Complete W2 lookup correctness.
- Complete W3 tool delegation.
- Add W4 service and tool tests.
- Run W6 plan maintenance.

Affected artifacts:
- `packages/opencode/src/capability/index.ts`
- `packages/opencode/src/tool/capability.ts`
- capability tests
- active plan files

Dependency chain:
- W1 -> W2 -> W3 -> W4 -> W6

Oracle set:
- targeted capability tests from `packages/opencode`
- `bun typecheck` from `packages/opencode`
- ADM `--verify-all` on changed roots and `plans`

Risk level:
- Medium

Estimated change surface:
- Moderate

Why choose this:
- Recommended. It removes duplicate logic and proves the user-facing tool without expanding into media or pipeline work.

### Candidate 3 - Full Capability Feature Closure

Objective:
Stabilize service/tool and complete the TUI readiness track.

Semantic deltas:
- Complete W1-W4.
- Run W5 readiness check.
- Add a minimal TUI renderer only if the generic renderer is insufficient.
- Complete W6 plan maintenance.

Affected artifacts:
- all Candidate 2 artifacts
- possibly UI tool renderer files
- `plans/sub/20260623_A5_capability_tui.md`

Dependency chain:
- W1 -> W2 -> W3 -> W4 -> W5 -> W6

Oracle set:
- Candidate 2 oracles
- UI typecheck or root `bun turbo typecheck` if UI is touched
- visual/manual TUI output check if renderer changes

Risk level:
- Medium-high

Estimated change surface:
- Larger

Why choose this:
- Useful only after the user explicitly wants TUI closure in the same implementation chain.

## Recommended Candidate

Candidate 2 is the recommended implementation chain.

Reason:
It stabilizes the actual capability surface that future media and pipeline work will depend on, but it avoids the two highest scope-expansion risks: TUI customization and system-prompt capability injection.

## KV Cache Assessment

Candidate 1 and Candidate 2 should have no KV-cache risk if they stay within service, tool, and tests.

[KV-CACHE RISK] Candidate 3 can become risky only if follow-up work touches `src/session/system.ts`, `src/session/prompt.ts`, `src/session/cache-control.ts`, `src/session/llm.ts`, `src/session/compaction.ts`, or `src/session/message-v2.ts`.

Stable alternative:
Keep capability lookup as an explicit tool call and do not inject capability summaries into the system prompt.

## Stop Conditions

Pause implementation if:
- Capability YAML shape in the code conflicts with real provider metadata.
- Provider service layer cannot be composed without broader registry changes.
- Any oracle fails after an ADM-applied descriptor.
- A change would touch system prompt or model message conversion.
- Tests require real credentials or network access.

## Implementation Checklist

    - [x] W1: Validate and harden capability YAML read/write.
    - [x] W2: Make service lookup deterministic and provider-backed.
    - [x] W3: Make the tool delegate to `Capability.Service`.
    - [x] W4: Add focused service/tool tests.
    - [x] W5: Decide whether TUI needs more than generic tool output.
    - [x] W6: Update active plans after implementation evidence.

    ## Implementation Update - 2026-06-24

    Candidate 2 was selected for implementation.

    Completed semantic deltas:
    - Capability YAML now fails malformed content instead of silently returning empty data.
    - Capability lookup uses provider service model capabilities instead of tool-local `models.json` discovery.
    - Capability tool delegates to `Capability.Service`.
    - Focused service/tool tests cover absent YAML, valid YAML, malformed YAML, modality filtering, auth annotation, ranking, formatted output, and schema rejection.

    Follow-up update - 2026-06-24:
    - W5 evidence showed the terminal TUI generic renderer hides generic output by default.
    - A dedicated terminal `capability` renderer now displays lookup output as an expandable `BlockTool`.
    - The web UI already has a `GenericTool` fallback, so no web renderer was added.

## Verification Plan

Documentation-only verification for this plan:
- Inspect exact diff for this file.
- Run `tools/adm.exe --verify-all plans`.
- Run the explore task agent before moving this plan to `plans_completed/`.

Implementation verification completed:
- From `packages/opencode`: `bun test test/capability/capability.test.ts` passed.
- From `packages/opencode`: `bun typecheck` passed through cmd_runner.
- ADM `--verify-all packages\opencode\src\cli\cmd\tui\routes\session plans` passed.
- ADM source/test verification for Candidate 2 passed before commit `4930517d5`.
- Explore task agent validation passed with `Verdict: CLEAN - Safe to Archive`, `Gaps: 0`, and all six workstreams verified against real code state.

## Clean Next State

    - Done: Candidate 2 service/tool stabilization, W5 terminal TUI readiness, and final explore validation
    - Pending: none
    - Blocked: none
    - Next: continue to the next active media/pipeline workstream

<!-- ADID_ROLLBACK (from adm.exe)
  SDID_ROLLBACK {
    "target_file": "D:\\zPython\\opencode\\plans_completed/20260623_capability_stabilization_plan.md"
    "update_script": "adm.exe"
    "backup_path": "none"
    "created_at": "2026-06-24T05:27:01.720184+00:00"
    "new_hash": "afaea1bde543c2aec47eb2a74845edda"
    "goal_id": "create_capability_stabilization_plan"
    "semantics": "Create a documentation-only stabilization plan for capability service/tool work."
    "update_attrs": {"relative_path": "plans_completed/20260623_capability_stabilization_plan.md", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
    "restore_cmd": "python -m adm \u002d\u002drollback \"D:\\zPython\\opencode\\plans_completed/20260623_capability_stabilization_plan.md\""
  }
-->
