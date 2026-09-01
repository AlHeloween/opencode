# Kernel Map-First Linearization

## Goal

Make the generated reasoning kernel read in the same causal order as its architecture:

`Intent -> Geometry -> Plan -> Authorization -> Grounded execution -> Oracle -> Closure -> Evolution`

Build this as a parallel package in `prompts_kernel_next/`. The prompt must begin with a compact executable map, establish its vocabulary and ABI before detailed use, and then refine the map gate by gate. The generated prompt remains deterministic and byte-stable across turns.

The existing `prompts_kernel/` package and production prompt remain unchanged during construction. Production cutover is a separate, explicit migration step after the parallel package passes every acceptance gate.

## Exact Premises

- The production artifact is assembled from reasoning fragments, the runtime dictionary, and generated agent/policy specs.
- The current serializer groups content by source artifact rather than execution topology.
- Gate semantics currently have competing representations in `core_schemas.yaml`, `reasoning/01_gates.txt`, and research-only candidate material.
- The runtime injects the production reasoning prompt into the stable system-prefix path, so nondeterministic generation is a KV-cache regression.
- Baseline before this plan: `python -m pytest prompts_kernel/tests/ -q` passed 490 tests.

## Prior Art Used

- `plans_completed/2026-08-08-kernel-layout-optimization.md`: gate locality and semantic ordering.
- `plans_completed/reasoning-graph-refactor.md`: graph structure and the limits of artifact-grouped serialization.
- `plans_completed/2026-09-01_kernel-tautology-fix.md`: current regeneration and validation workflow.

## Target Serialization

1. `KERNEL_MAP`: canonical spine, node IDs, directed edges, and explicit back-edges/side loops.
2. `PROMPT_ABI` and core vocabulary needed to interpret the map.
3. Gate-local refinement in canonical `G1..G9` order, including `G5`.
4. Cross-cutting epistemic, hygiene, reuse, and safety invariants.
5. Optional attention/evolution protocols that cannot authorize actions.
6. Generated agent and policy contracts.

Cycles are represented as a canonical forward spine plus named back-edges. Physical text order is never used to imply that a loop may bypass authorization or the oracle.

## Side-by-Side Package Boundary

`prompts_kernel_next/` owns:

- canonical graph/state/policy data;
- a deterministic validator and renderer;
- source fragments that are not copied runtime definitions;
- generated artifacts under `prompts_kernel_next/dist/`;
- isolated tests under `prompts_kernel_next/tests/`;
- a compatibility report against the current kernel's required semantic markers.

It must not import generated data from `prompts_kernel._kernel_precompiled`, write into `prompts_kernel/dist/`, or overwrite `packages/opencode/src/session/prompt/reasoning_prompt.txt` during ordinary build/test operations.

## Guardrails

- [x] The first semantic section is `KERNEL_MAP`.
- [x] Every gate `G1..G9` occurs in the map and in exactly one canonical detailed definition.
- [x] `G5` is explicit; numbering cannot silently skip it.
- [x] Gate and rule definitions have one source owner; cross-namespace collisions are rejected.
- [x] `ABI_AND_VOCABULARY` and required vocabulary precede the first detailed rule that relies on them.
- [x] Forward control-flow is the declared canonical spine; all cycles appear in an explicit back-edge/side-loop table.
- [x] Semantic-attention and evolution loops are advisory/routing-only and cannot authorize execution.
- [x] Authorization remains before implementation; oracle remains after implementation and before closure.
- [x] Generated next-kernel dist artifacts are byte-identical to the generator output.
- [x] After cutover, production must be byte-identical to the approved next-kernel artifact.
- [x] Generation is deterministic across fresh Python processes.
- [x] Next-kernel size is checked in UTF-8 bytes with one documented budget.
- [x] No research-candidate file becomes a runtime source accidentally.
- [x] The new package cannot write current-kernel or production paths without an explicit cutover command.
- [x] Current and next package imports can coexist in one Python process without module-name collision or side effects.
- [x] Existing grounding, fractal decomposition, Manhattan/L1 selection, provenance, risk, and smoke-oracle semantics remain represented.

## Implementation

- [x] Add isolated structural tests for map-first order, complete gate order, single ownership, vocabulary-before-use, explicit loop declarations, UTF-8 budget, and artifact/generator equality.
- [x] Define structured canonical graph, gate, state, vocabulary, rule, and policy data inside `prompts_kernel_next/`.
- [x] Implement deterministic validation before rendering: graph completeness, edge legality, unique ownership, reference resolution, and authorization/oracle ordering.
- [x] Implement the map-first renderer: map -> ABI/vocabulary -> gate-local refinement -> cross-cutting protocols -> generated contracts.
- [x] Generate only `prompts_kernel_next/dist/` artifacts during normal development.
- [x] Dist builds are timestamp-prefixed (`YYYY-MM-DD_HH-MM-SS_…`); production/working copy is updated only by explicit cutover after review.
- [x] Produce compatibility/coverage and per-rule migration reports against the current production kernel.
- [x] Add a separate cutover entry point that refuses to write production without explicit approval, current SHA-256, structural validation, and compatibility coverage.
- [x] Document the executable graph, source ownership, build boundary, and cutover boundary in `prompts_kernel_next/README.md`.
- [ ] Reconcile this plan against code and move it to `plans_completed/` only when every acceptance gate passes.

## Smoke Tests

Run from `D:/zPython/opencode` unless a package directory is named:

1. Source/reference integrity:
   - `python prompts_kernel/refcheck.py`
   - `python prompts_kernel/check_dictionary.py`
2. Focused compiler/schema guardrails:
   - `python -m pytest prompts_kernel_next/tests/ -q`
3. Current-kernel regression suite (must remain green and unchanged):
   - `python -m pytest prompts_kernel/tests/ -q`
4. Deterministic regeneration:
   - generate `prompts_kernel_next/dist/` in a fresh Python process;
   - assert generated `.txt` equals the renderer output byte-for-byte;
   - repeat generation and compare SHA-256 digests.
5. Compatibility oracle:
   - validate required semantic markers and non-regression invariants against the current production prompt;
   - prove normal next-kernel build cannot modify current-kernel or production artifacts.
6. Product integration after explicit cutover only, from `D:/zPython/opencode/packages/opencode`, through `cmd_runner`:
   - focused system-compose/reasoning prompt tests;
   - `bun typecheck`.
7. Repository hygiene:
   - `git diff --check`
   - verify unrelated existing deletions and `prompt_research_candidate/` remain untouched.

## Acceptance Criteria

- [x] A reader can recover the entire control-flow topology from the opening map without scanning later sections.
- [x] Detailed text follows causal gate order and references already-established vocabulary.
- [x] There is no competing gate-definition source in the next-kernel runtime path.
- [x] The old production layout fails the map-first baseline; all next-kernel structural guardrails pass.
- [x] Full current-kernel and next-kernel Python validations pass; TypeScript integration remains a cutover-only gate.
- [x] The next prompt stays within the documented UTF-8 byte budget and its size delta is reported.
- [x] The production prompt SHA-256 is updated intentionally and remains stable on a second fresh generation.
- [x] Before cutover, hashes of current-kernel and production artifacts remain unchanged.

## Execution Record

- Red baseline: next-kernel tests failed during collection because the package/API did not exist.
- Current kernel baseline: `490 passed`; after adding the stale-dictionary regression guard: `491 passed`.
- Current refcheck: pass.
- Current dictionary validator: repaired stale inventory (`42/4/4` -> `47/7/5`) and now passes with 109 entries.
- Next kernel: `29 passed`.
- Fresh-process generation repeated twice with identical SHA-256: `05a84710017d36fcf17bbea0205971fabdb9ea74dc9e07f5d1b0200b599fb408`.
- Next runtime size: 22,502 UTF-8 bytes versus current production 55,715 bytes (33,213 bytes smaller; 59.6% reduction).
- Migration ledger: 47/47 legacy rules accounted for; 10 preserved, 25 merged, 12 delegated to named host/runtime boundaries, 0 silently retired.
- Production/current-kernel hash boundary remained unchanged during normal next-kernel build and tests.

## Semantic Dedup Phase

Baseline after the map-first implementation:

- runtime: 22,502 UTF-8 bytes; 2,664 normalized tokens;
- `GATE_REFINEMENT`: 11,133 bytes (49.5% of runtime);
- 54 repeated `owner:` lines;
- 9 repeated identity ACL suffixes;
- 36 serialized route lines because map edges are repeated inside gate bodies;
- strongest state/rule sequence overlap: `USER_REQUEST` vs `INTENT_PROJECTION_RULE` = 0.719.

Tasks:

- [x] Add an explicit semantic-overlap allowlist and reject unreviewed state/rule similarity at or above 0.58.
- [x] Reject renderer boilerplate regressions: repeated owner lines, repeated per-identity ACL clauses, and duplicated edge serialization.
- [x] Keep state descriptions structural and behavioral rules operational; shorten the highest-overlap pairs without deleting their distinct contracts.
- [x] Encode rule ownership in containment instead of a repeated body line.
- [x] Declare edges once in `KERNEL_MAP`; gate detail references its map node rather than reserializing outgoing edges.
- [x] Declare runtime ACL/G4 authority once in the identity-contract preamble.
- [x] Preserve all 47 legacy migration decisions and required semantic markers.
- [x] Re-run two fresh-process generations and report the new byte/token/digest delta.

Dedup smoke additions:

1. `python -m pytest prompts_kernel_next/tests/test_dedup.py -q` must fail on the pre-dedup renderer and pass after compaction.
2. `python -m pytest prompts_kernel_next/tests/ -q` must pass without weakening architecture, migration, cutover, or hash-boundary tests.
3. `python -m pytest prompts_kernel/tests/ -q`, dictionary validation, and refcheck remain green.
4. `git diff --check` remains clean; unrelated working-tree changes remain untouched.

Dedup result:

- focused dedup suite: 6 passed; complete next-kernel suite: 35 passed;
- current-kernel suite: 491 passed; refcheck and 109-entry dictionary validation pass;
- runtime: 19,867 bytes and 2,264 normalized tokens (`-2,635` bytes / `-400` tokens from the map-first baseline);
- total reduction from current production: 35,848 bytes (64.3%);
- `GATE_REFINEMENT`: 9,537 bytes (`-1,596`);
- maximum state/rule overlap: 0.469; no allowlist entry required;
- repeated owner lines: 0; repeated ACL clause: 1 canonical occurrence; edge declarations: 18 for 18 edges;
- two fresh generations matched SHA-256 `7199b0045702fd57ea02d25b8a0f0858812bb1f608de955e24ed8f284a2fc811`;
- compatibility gaps: none; migration gaps: none; production/current-kernel baseline hashes unchanged.

## Contract Restoration (SV + SOURCE_ROUTING)

The map-first rewrite kept `SV_TARGET` / `SV_EVERY_TURN` as protocol rules but dropped the serializable `SV_FORMAT` schema and `DOMAIN_SOURCES`. Compatibility only checked the surviving markers, so the loss was silent.

- [x] Add typed `SemanticVectorContract` and `SourceRoutingContract` to the next-kernel IR.
- [x] Render both in ABI after `KERNEL_MAP`, before state/action classes: information status → SV → source routing → state → action classes.
- [x] Restore digest chain `md5` / `prev-md5` / `parent-goal-md5` and 3–9 keywords summing to 1.0.
- [x] Restore all 16 legacy disciplines with primary authority routes, plus a software route.
- [x] Encode epistemic promotion: snippet=Guess, corroborated fetch=Hypothetical, stamped authority=Inferred, oracle=Exact; generic web cannot reach Inferred without `source_stamp`.
- [x] Extend compatibility to require `SV_FORMAT`, `DOMAIN_SOURCES`, digest fields, `SOURCE_ROUTING`, and discipline coverage.
- [x] Tool prompts + constitution `source_stamp` (Batch 2).
- [x] Agent `@REF` / gate-scope alignment with next-kernel identities (Batch 3). Production cutover remains later. Do not switch runtime yet.

Smoke additions:

1. `python -m pytest prompts_kernel_next/tests/test_contracts.py -q`
2. `python -m pytest prompts_kernel_next/tests/ -q`
3. `python -m pytest prompts_kernel/tests/ -q`
4. Two fresh-process generations with identical SHA-256; production/current-kernel hashes unchanged.

Contract restoration result:

- next-kernel suite: 43 passed; current-kernel suite: 491 passed;
- runtime: 22,860 UTF-8 bytes and 2,601 normalized tokens (`+2,993` bytes / `+337` tokens from the post-dedup map-first artifact);
- two fresh generations matched SHA-256 `52abaaece2d5d39fdbc7854986674a7b1c5fcb292d074707d82da87207199950`;
- compatibility gaps: none; next-only markers `SOURCE_ROUTING` / `SV_CONTRACT` / `SOURCE_STAMP` present;
- production/current-kernel baseline hashes unchanged.

## Batch 2 — Tool prompts + source_stamp

[KV-CACHE RISK] Tool catalog descriptions change in one coordinated era. Production `reasoning_prompt.txt` stays untouched.

- [x] Constitution `source_stamp` {authority_class, url_provenance, content_hash, kind}; snippets never Inferred; generic document fetch never Inferred; primary document fetch → Inferred.
- [x] `webfetch` / `universalsearch` emit stamps; processor raises evidence floor only from a qualifying stamp.
- [x] `universalsearch` default `source` is `web`; researcher may omit source (defaults to web) but still cannot use code/hybrid/agent.
- [x] `run.txt` no longer claims `cmd_runner send` is unscanned.
- [x] Shell prompts defer enumeration/destructive/crash-binary blocks to constitution.
- [x] `task` live inventory from agent list (hidden/primary excluded); static two-agent table removed.

Smoke:

1. From `packages/opencode`: focused bun tests for constitution source_stamp, universalsearch default, registry inventory, kernel-alignment.
2. `python -m pytest prompts_kernel_next/tests/ -q` and current-kernel suite remain green.
3. Production/current-kernel hashes unchanged.

## Batch 3 — Agent identity alignment

[KV-CACHE RISK] Subagent system prefixes change. Production `reasoning_prompt.txt` stays untouched.

- [x] Agent prompt spines match next-kernel identity gates.
- [x] Unresolved legacy `@REF`s removed (`@SEARCH_ORDER`, `@GROUND`, `@HYGIENE`, `@ADID_OPS`, …).
- [x] Remaining `@REF`s resolve in the next-kernel symbol table.
- [x] `codegraphcodegraphstatus()` removed; `getPlanStatus()` is not presented as a tool.
- [x] `streamObject` `onError` logs instead of swallowing.

Smoke:

1. `python -m pytest prompts_kernel_next/tests/test_agent_identity.py -q`
2. `python -m pytest prompts_kernel_next/tests/ -q`
3. From `packages/opencode`: `bun test test/agent/identity-prompts.test.ts`
4. Production/current-kernel hashes unchanged.

Batch 3 result: next-kernel 52 passed; `reasoning_mode` restored as a primary identity outside the mutation spine; production hashes unchanged.

## Rollback

Before cutover, rollback is deletion or isolation of `prompts_kernel_next/`; no production restoration is required because normal next-kernel operations cannot write production paths. After cutover, retain the old package and production artifact as the rollback source until product integration tests pass. Do not weaken a guardrail merely to preserve the new ordering.
