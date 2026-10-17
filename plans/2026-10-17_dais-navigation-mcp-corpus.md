<!-- intention: DAIS имеет проверенные capture и facts без агентной навигации -> реальные Windows Go source definitions/references доступны через проверенный native MCP с Fossil/SV/evidence scope -->
<!-- goal_sv: Keywords: code-navigation 0.35, native-mcp 0.25, real-corpus 0.25, provenance 0.15
Semantic dominant: Реальные определения и ссылки получают проверяемый агентный интерфейс с закреплёнными Fossil версиями.
md5: 4d7c2b9a80e34f66951d38abc7f620e1
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
-->
# DAIS: навигация, native MCP и рабочий корпус

Status: ACTIVE, revision 4. Parent: [Zoekt/SCIP/Fossil/SV](2026-10-16_zoekt-scip-fossil-sv.md).
Authority: «Ага, давай» после обещанного рабочего корпуса и MCP. Intention root
не меняется: Sourcegraph-подобная навигация с Fossil/SV и проверенной заменой
CodeGraph. Этот child не переключает existing consumers и не устанавливает
длительно работающий сервис. WSL/контейнеры/bin/kernel исключены.

## SVM / envelope / strategy

Turn navigation-mcp-01, parent repeated-capture-01; goal/root vector выше.
C1 verified; C2/C3 in verification, C4 pending; eta_turns1; receipts ниже.
ALLOW READ/PLAN_WRITE/MODIFY_PROJECT/MODIFY_CANDIDATE/EXTERNAL_EFFECT(public
official MCP SDK acquisition). Paths: packages/dais-code-intelligence/**,
этот child/parent/MASTER/_progress_log, docs/dais-evidence-graph.md,
experiments/2026-10-17_dais-navigation-mcp/** и corresponding experiments_history/**.
Universal Search и live snapshot.fsl — READ только; его resident worktree не
редактируется. Native stdio MCP — caller-owned session, stop=EOF/context cancel,
никакой live host config/service installation. Public Go dependency download
разрешён; existing external sources не меняются. _build.ps1 -Task build обязателен.
Budgets:220steps/260calls/10returns/depth3/6000000ms от2026-10-17T10:56Z.
Reservations: read-only corpus explorer18calls/480000ms; query impl45calls/1800000ms;
MCP impl45calls/1800000ms; root independent verification uses remainder.

Стратегия master: вместо выдачи произвольных facts агент получает определения/
ссылки по координатам реального source, вместе с immutable source/evidence
адресами. Root Z4/M0b двигаются только в измеренных границах; Z5 cutover остаётся
открытым. Существующий portfolio debt не переписывается; scoped explorer проверяет
backlinks/boxes/pins, renderer поддерживает карту, whole-portfolio PASS не заявляется.

## Grounding / medoids / claims

CONFIRMED ✓ предшественник cd72b12f: repeated capture, actual producer/Fossil/
SCIP graph,47 predicates дважды и109 Git blob pins; это fixture qualification,
не measured production parity. Current Store.Facts/store.go:336–376 проверяет
cached fact IDs/count, отдаёт явный total/returned/truncated. Store.Verify
проверяет full declared source target и сохраняет instrument-bound receipt.
CodeGraph query current Store/Facts/Provider выполнен до source edits.

CONFIRMED ✓ production corpus Go list20261017T105838Z_9b0a2b11: два настоящих
packages internal/fossil и internal/capture существуют. Explorer установил9
tracked Go files с hashes, совпадающими с current CodeGraph; production Windows
selection4 файла, tests и publish_other.go не активны для этого build. Наблюдаемое
CodeGraph ребро к publish_other.go нельзя считать Windows semantic parity.

Primary MCP authority: official github.com/modelcontextprotocol/go-sdk,
native module query20261017T105803Z_e5fac2ef pin v1.8.0 (2026-09-04, Go1.25).
SDK source/license/API квалифицируются перед binding C2. Universal Search
health HTTP200 healthy прочитан; его MCP-wrapper не локализован в первичном
Rust service. Graph вернул external/firecrawl вместо owning Rust — recorded
irrelevant-index gap, bounded source fallback src/service.rs показал HTTP
/web/sourcegraph. Он не является локальным SCIP backend и не мутируется.

Candidates tier2/Inferred until runtime: coordinate resolver; exact
definitions/references over occurrence keys; official stdio MCP; real source
capture + independent Go AST/types golden; same-byte CodeGraph matrix;
provenance/freshness controls. Central medoids: existing graph fidelity runtime,
real Fossil source identity, official protocol SDK. Causal prediction: source
coordinate maps to same SCIP key across definition/reference, new source version
invalidates old verification; transport cannot raise semantic_status.

## Acceptance frame / Smoke Tests

C1 baseline: focused evidencegraph/cmd graph suite expected PASS before edit.
New navigation tests RED on missing API, then PASS for legacy/modern ranges,
multi-line/end-exclusive point, local document scope, ambiguous symbols,
unresolved/external definitions, missing snapshot, invalid position/limit,
cached selected fact corruption. No silently truncated input scan.

Navigation API selector: repository-relative document_path +0-based line and
UTF8 byte character. Mode definitions or references. Resolve all containing
occurrences with nonempty symbol identities; matching uses snapshot-scoped fact
Object, never bare local symbol across documents. Definitions = role bit1;
references = occurrences without bit1. Preserve multiple overlapping identities,
duplicates and raw payload/origin. Result includes Snapshot, target keys,
locations/fact IDs, total/returned/truncated, semantic_status unknown. Empty or
unindexed definitions represented explicitly. Limit applies after matching.
Initial bounded full-snapshot read reuses Facts(MaxFacts); truncated input is
an error. This is a functional first query, not5M scalable SQL/performance claim.

C2 official SDK stdio server uses fixed startup repository/snapshot/target
revision; mandatory preflight Store.Verify before exposing navigation. Bound
freshness to that full target, never claim latest workspace HEAD. Tools wire
lowercaseASCII: symboldefinition, symbolreferences, codesearch, indexstatus; fields keep
snake_case. Definition/reference inputs exactly coordinate+limit; no arbitrary
paths/config/repository switching. Responses carry query + executed verification
receipt, including actual instrument hash, revision/SV/origin. No mocked PASS,
unsupported callers/callees/impact tools omitted. Limits: request timeout,
positive result cap, bounded stdin frame via qualified SDK. stdout only protocol,
stderr diagnostics. Invalid/missing/stale snapshot and unsupported arguments
must return explicit failures. EOF/cancel terminates owned process.
Codesearch reuses existing Zoekt Adapter.Search; no new search implementation.
Startup binds search generation with same target revision; returned generation/
revision must still equal bound values, later publication causes explicit refusal.
Kind/code/regex/filename/symbol_text semantics preserved, result omission/truncation
remains visible. No silent latest-generation switch. MCP does not index/capture.

C3 production corpus = byte-identical committed module Go files for those two
packages + real go.mod/go.sum, exported to disposable Fossil tree; path mapping
CodeGraph prefix packages/dais-code-intelligence/ declared. No source rewrite,
fake go.mod or synthetic definitions. GOOS=windows/GOARCH=amd64, --skip-tests,
offline dependency resolution and pinned native producer/toolchain. Module cache
external reads remain declared qualification boundary. Actual raw SCIP preserves
all fields; named golden cases generated independently by Go AST/types, not by
SCIP/our graph. Same-byte CodeGraph comparisons list missing/extra/build-context
differences; no wholesale accuracy/performance parity claim from one metric.
SCIP subset coverage and positions checked against compiler-selected inventory.
G8→G2 observed prerequisite: production probe110642Z_d310749d successfully
captured all11 committed inputs, then importer refused raw document path
`internal\\capture\\capture.go`. This is native producer document-separator defect,
not permission to rewrite SCIP bytes or relax graph path validation. Add C3a
binding compat/scip-go/position-encoding.patch + scripts/build-scip-go.ps1 and
compat README: producer emits filepath.ToSlash BEFORE protobuf serialization,
retains explicitUTF8 patch and source-tree pins. Build new candidate into owned
scratch; original module/external and old failed index unchanged. SV binding:
native-producer-paths0.50 canonical-scip0.30 source-pins0.20. New actual nested
production capture/import must PASS; old invalid raw fixture remains refusal.

Independent raw-stdio client: initialize/list/call/EOF on real candidate binary,
exact definition/reference positions on real corpus, evidence/SV/revision/hash,
negative unknown tool/bad args/missing symbol/limit/stale startup. Protocol and
tool errors separated. Repeat from archive with new disposable paths; maintain
raw FAIL/control history. Test mutation control must discriminate bad snapshot
or stale source; prior snapshot remains unchanged. Measure only named metrics,
no inferred p95/RSS/5M win. Mandatory whole build after focused source tests.
Real corpus text queries compare Zoekt addresses against independent byte-line
literal matching over the declared indexed scope, plus absent/limit controls.
This text parity is separate from CodeGraph structural/reference differences.

## Tasks / bindings

- [x] C1 — bounded coordinate-based definitions/references API + real graph tests.
  <!-- sv: code-navigation 0.50, symbol-identity 0.30, bounded-results 0.20 -->
  Paths internal/evidencegraph/navigation.go/navigation_test.go only; reuse
  Store.Facts/load and existing fixture. No schema migration or other source.
- [ ] C2 — official SDK stdio native MCP + focused tests/CLI/docs.
  <!-- sv: native-mcp 0.50, verified-snapshot 0.30, protocol-controls 0.20 -->
  Paths internal/mcpserver/**, cmd/dais-mcp/**, go.mod/go.sum; concrete API follows
  pinned SDK source and C1. No live registration/install/service.
  Grounded API gap: no public historical snapshot reader. Add only
  internal/evidencegraph/snapshot.go: Store.Snapshot wraps existing s.load,
  retaining same digest/profile/namespace checks. This replaces a rejected fake
  Navigate(nonexistent-document) metadata probe; no Current==pin restriction.
  MCP actual historical/missing/corrupt pinned snapshot tests cover this path.
- [ ] C3 — actual production corpus capture + compiler golden/CodeGraph matrix + wire oracle.
  <!-- sv: real-corpus 0.45, independent-golden 0.35, parity-boundary 0.20 -->
  Paths experiments/** only until verified archive. Frozen original bytes/pins,
  source selection/build context explicit, graph cannot grade its own golden.
- [ ] C4 — archive/pins, regression/build, docs/renderer/review/named scoped commit.
  <!-- sv: evidence-archive 0.40, clean-state 0.35, continuation 0.25 -->

## Risks / rollback / continuation

Critical risk uncontained: none; runtime unknowns remain required leaves.
Untrusted SCIP/cached payload: existing digest/range checks and negative controls.
Fullscan memory/latency: bounded prototype, no scale claim; measured future SQL
index prerequisite. CodeGraph different build semantics retained as differences,
never weaken compiler golden to fit it. Source omission: exact corpus manifest
and actual GOOS-selected inventory. No reader-side version chain.
Rollback own additive files/dependency/configured candidate only; historical
capture/export remains intact. Foreign dirty/staged changes preserved.
## Исполнение и текущий oracle

CONFIRMED ✓ C1 missing API RED110325Z_faa1054f, focused PASS110407Z_79b42c19;
parent regression111540Z_eb3c4270 evidencegraph PASS43.354s, full log retained.
Navigation preserves identities/ranges/duplicate origins and rejects truncated
input/cached corruption. Public Snapshot reader delegates to existing checked load.

CONFIRMED ✓ C3a producer factory110910Z_0a67c8b8, production preparation
110937Z_f6e1d33f:7predicates, raw roundtrip and11 exact committed inputs96792bytes.
Independent Go AST/types110818Z_e824b2d6:4Windows-compiled files36395bytes,
33 function/method definitions,67typedreferences. Raw SCIP comparison
111122Z_7b16b13b:21predicates PASS; no missing/extra cohort associations.
This is bounded semantic agreement, not a general semantic_status promotion.
Original backslash-path FAIL110642Z_d310749d remains retained.

CONFIRMED ✓ C2 focused111315Z_9feff6ca passed6server tests+CLI.
CONFIRMED ✗ parent9package regression111540Z_eb3c4270: historical pin
indexstatus toolerror; other8packages passed. Error rendering currently hides
Content behind pointers. C2 remains open: serialize actual error, classify,
then independently repeat same package regression before closure. No unproved
timeout increase or product repair accepted. Native binary build111523Z_f39b753a
is PASS but does not cover this regression. Independent raw-stdio qualification
and production corpus comparison are running in a new caller-owned index copy.

Continuation receipt:111540Z_eb3c4270 complete state/log and C2 diagnostic
dispatch to capture_core; next exact error→repair if required→same regression,
then archive replay/build/scoped commit. Original source Fossil remains readonly.
