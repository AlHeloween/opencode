<!-- intention: DAIS выдаёт pinned search/definitions/references без операции impact диапазона -> native DAIS возвращает прямые внешние SCIP references к определениям изменённых файлов обоих концов Fossil диапазона с проверяемыми origins -->
<!-- goal_sv: Keywords: fossil-range 0.35, reference-impact 0.35, independent-oracle 0.20, migration-boundary 0.10
Semantic dominant: Прямые ссылки на изменённые определения получают адреса обоих снимков Fossil до переключения потребителей.
md5: 64b87d3a905c4fe2a1396db50f72c8e1
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
-->
# DAIS: Fossil range → прямые reference candidates

Status: COMPLETED revision2, scoped acceptance verified; completion transaction
requires committed Git blob readback. Parent: [Zoekt/SCIP/Fossil/SV](../plans/2026-10-16_zoekt-scip-fossil-sv.md).
Authority: «Ага, давай» после закрытого navigation/MCP child. Fixed root intention:
native Windows code intelligence с Fossil/SV и проверенной заменой CodeGraph.
Этот prerequisite не переключает существующих consumers и не ослабляет их gates.

## SVM / envelope / strategy

Turn reference-impact-01, parent navigation-mcp-01; eta_turns0. Root goal unchanged.
ALLOW READ/PLAN_WRITE/MODIFY_PROJECT/MODIFY_CANDIDATE. Source paths:
packages/dais-code-intelligence/internal/evidencegraph/reference_impact.go и
reference_impact_test.go; cmd/dais-graph/**; internal/mcpserver/**; module README;
docs/dais-evidence-graph.md; этот child/parent/MASTER/_progress_log;
experiments/2026-10-18_dais-reference-impact/** и corresponding experiments_history/**.
No schema migration, no dependency change, no kernel/bin/live Fossil/host config
mutation, no Universal Search resident edits. Native CLI/MCP are caller-owned
processes, stop EOF/cancel. Only disposable fixture Fossil writes authorized.
No network dependency acquisition expected. Mandatory _build.ps1 -Task build.
Budget120steps/180calls/6returns/depth3/3600000ms от2026-10-17T23:39:28Z.
Reservations: two explorers12calls/8min each; API implementation35calls/15min;
MCP follow-up20calls/10min; independent oracle/root uses remaining budget.

Strategy: root Z4 gets a measurable range operation; Z5 consumer cutover remains
open. Whole portfolio is inventoried/rendered, not declared globally complete.
Existing 2026-09-29 impact-decoupling has a separate freshness criterion; it is
not silently closed or rewritten by this backend experiment.

## Grounding / candidates / claims

CONFIRMED ✓ source fadd644c86: native navigation/MCP,33compiler definitions,
67typed references,1270wire predicates repeated,235Git blob pins.
Current CodeGraph calls before mutation returned Provider.Changes/ListFiles,
Store.Verify/Facts and consumers. Changes compares full endpoint manifests:
added/deleted/modified paths, artifact hashes/permissions; rename is endpoint
delete+add with PreviousPath metadata, not guessed ancestry.

CONFIRMED ✓ read-only consumer explorer: seven capability classes; most narrow
future seam SnapshotFossil.lastImpact, but current ImpactSummary.callerCount is
fed all cross-file edges (sqlite-pack.ts:358–371). A new reference result cannot
truthfully fill that field as calls. Prebuild/explore/context/summary clocks and
graph-first latch are distinct consumers. None of the four DAIS tools alone
matches their whole contract. Source pins retained in experiment grounding.

CONFIRMED ✓ raw independent reader of pinned production index024e2a60...38d7b6e:
2697occurrences/454definitions,33enclosing definitions matching compiler cohort,
67typed references/50owner-target pairs,690global refs without indexed definition.
Four relationships are implementations of io.Writer, not calls. Enclosing spans
not independently AST-qualified, so owner/call graph is not selected here.

Candidates tier2/Inferred: endpoint direct-reference API; CLI; pinned MCP tool;
independent raw/typed oracle; evidence closure. Unsupported full cutover/callgraph
are Unknown and not selected. Exact medoids: actual Fossil endpoint diff, raw
SCIP/Facts fidelity, executed native stdio transport. Immediate consequence:
adding direct references enables comparison, does not prove behavioral impact.

## Acceptance / Smoke Tests

I1 baseline focused evidencegraph+graphCLI expected PASS. New API test RED on
missing method, then PASS using real disposable Fossil+actual Store import/verify.
API Store.ReferenceImpact(ctx, ImpactRequest): explicit BeforeSnapshotID,
BeforeTargetRevision, AfterSnapshotID, AfterTargetRevision, Limit. Same Store
namespace/profile; immutable full target hashes. Verify both actual targets;
non-PASS, missing source, corrupt facts, cancelled context, incomplete fact input
are errors. Each result side carries Snapshot, target Revision/comment/SV,
executed Receipt; target and origin revision roles remain distinct.

Provider.Changes(before_target,after_target) is sole seed source. Keep all changes,
including generated/index/noncode paths; do not apply ci/** or mtime filters.
For each side select all definition occurrences (role bit1) in changed paths that
exist on that side. Match all non-definition occurrences OUTSIDE the full changed
path set by canonical Fact.Object. Preserve multiple matching definitions and
duplicate reference ordinals; local symbols stay document/index scoped.
Result witness identifies side, reference Fact and matching changed-definition
Facts. No global symbol equality across snapshots is assumed. No own changed
files substituted for external affected files; a zero external result is explicit.

Coverage per side: changed paths indexed/unindexed/absent, selected definition
count, matching reference count; unindexed does not mean no impact. Changed path
existence derives from Change.Before/After endpoint fields. No source outside
changed paths is fabricated. Complete means complete within direct SCIP-reference
profile and bounded input, not full program/build/call/behavioral impact.
Input page truncation hard-fails; output limit applied after counting all matches,
returned/total/truncated explicit. Stable order before then after, raw ordinal.
Max input<=2*MaxFacts; no5M performance claim. semantic_status stays unknown.

CLI reference-impact reuses existing source/index flags, requires --snapshot and
--target-revision for after plus --before-snapshot/--before-target-revision,
--limit and positive --max-response-bytes; never installs or captures.
MCP tool `referenceimpact`: startup snapshot/target remain after; caller supplies
only before_snapshot, before_target_revision, limit. Before scope is same fixed
repository Store. Existing four tools retain behavior. Recheck pinned search
generation before/after; every response keeps search snapshot and real receipts.
No arbitrary repository/path/config argument, no calls/impact alias substitution.

Predictions before product edit: missing API RED; post tests PASS for modified,
added/deleted/rename/move, no-op/same-tree-SV, reverse endpoints, same spelling
different canonical symbols, local scope, non-call function value refs, top-level
references, duplicate/ambiguous definitions, external unresolved, bounded output,
invalid/stale/corrupt/cancel/missing snapshot. Changed source without new valid
snapshot EXPECTED_FAIL. Missing endpoint graph cannot return empty success.

I2 MCP baseline PASS before handler edit; five exact tool names thereafter;
real stdio scope/provenance/error/EOF positive and negative controls.
I3 independent oracle: raw SCIP reader+independent Fossil endpoint file map yields
all expected witnesses, no product-produced golden. Real production Go corpus
plus a changed provider file and fresh native capture: compiler33/67 subset
agreement and exhaustive raw impact equality. Small native producer fixtures
distinguish deletion/move/name collision/non-call reference. Mutation target/diff
control must fail expected set; original raw artifacts never modified. Repeat
from archive on new disposable paths. No semantic-status promotion from raw parity.

## Tasks / bindings

- [x] I1 — verified direct reference impact API+CLI and focused real-storage tests.
  <!-- sv: fossil-range 0.40, reference-witnesses 0.40, bounded-results 0.20 -->
  New reference_impact files; cmd/dais-graph; reuse existing Changes/Facts/Verify,
  no store/schema/navigation changes. Baseline→RED→PASS, parent independent run.
- [x] I2 — native MCP referenceimpact handler/schema and real protocol tests.
  <!-- sv: native-mcp 0.40, immutable-scope 0.35, explicit-failures 0.25 -->
  internal/mcpserver only after frozen I1 API; update exact tool-catalog assertion.
- [x] I3 — independent diff/raw/typed/native wire oracle with discriminating controls.
  <!-- sv: independent-oracle 0.45, fossil-provenance 0.35, parity-boundary 0.20 -->
  Experiments only, then verified archive. Existing source corpus/export and native
  producer reused; actual original raw/index and failures retained.
- [x] I4 — archive/pins/docs/master renderer/review/build/scoped named commit.
  <!-- sv: evidence-archive 0.40, clean-state 0.35, continuation 0.25 -->

## Risks / rollback / continuation

Review revision2: CONFIRMED ✓ source review found that per-side matching-reference
counts were not encoded and repeated ambiguous definitions reached json.Marshal
before the response byte cap. G8→G6 repair binds MatchingReferences (count before
output truncation) and ValidateReferenceImpactSize before CLI/MCP serialization.
The preflight accounts for repeated Fact encodings without constructing the full
expanded response; high-fanout and exact-byte controls must pass before closure.
First native oracle candidates are retained at their original binary digests;
final/archive replay must use the repaired binary, with coverage independently
recomputed from raw SCIP. Existing budgets and fixed intention do not change.

Critical uncontained risk:none. Direct references may be non-calls and omit dynamic,
external or non-indexed dependencies: explicit profile/coverage/unknown prevents
the unsupported inference. Callers/behavioral impact not claimed. Ambiguity kept,
no lexical name join. Generated artifacts remain visible unindexed changes.
Rollback additive API/handler/CLI candidate; original snapshots and CodeGraph
remain intact. Foreign dirty/staged paths preserved. No prefix/KV/kernel change.
CONFIRMED ✓ I1 final235205Z_064ef547:84PASS; I2 final235210Z_55c70c08:11PASS.
Root ten-package235242Z_dbb76d8b:166PASS, exit0/loss0. Independent native
production235251Z_b9ba0847:436predicates/94witnesses; small235252Z_2487db71:
182predicates/26witnesses. Root archived-script fresh replay235408Z_084d24a8
and235408Z_847baa14 repeat436/182. Detached raw target mutation EXPECTED_FAIL;
original raw bytes retained. Source Fossil unchanged during read operations.
Mandatory _build.ps1 -Task build235412Z_a123cd8e:exit0, candidate10.0.1434,
no promotion. Warnings Rustfuturecompatibility/webchunk remain explicit in archive.

I4 evidence/archive source pins are checked independently and again against
staged/committed Git blobs by the scoped transaction, preserving foreign index.
No whole-portfolio SUCCESS; only this child acceptance is covered.
Evidence: ../experiments_history/2026-10-18_dais-reference-impact/REPORT.md.
Next parent G1/G2: truthful SnapshotFossil.lastImpact reference-result contract,
downstream summary readers, freshness/cancellation/unavailable comparison before
consumer cutover. Existing callerCount cannot be populated with these references.
No task of the separate impact-decoupling plan was closed. Limits were not reset.
