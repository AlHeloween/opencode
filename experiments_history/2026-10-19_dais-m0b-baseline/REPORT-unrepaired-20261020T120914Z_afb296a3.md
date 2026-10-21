# M0b DAIS baseline — отчёт среза

Run: `20261020T120914Z_afb296a3` · generated 2026-10-20T12:10:37Z

## Scope

- Corpus: `packages/dais-code-intelligence/**: production *.go only, excluding scripts/.scratch/ overlay copies and non-indexed go.mod/go.sum (real repo source; NOT the whole project, NOT a 5M-entity scale)` — 40 files, manifest sha256 `90181108a206dad5…`
- Source revision: git HEAD `1fb4eaa15d6c976507a1e23edd942a749e222599`, dirty entries at freeze: 45 — per-file sha256 в манифесте является закрепляющей привязкой (dirty tree не пиннится одним HEAD).
- CodeGraph frozen copy: `7909e0cee82a6874…` (425070592 bytes, read-only backup)
- DAIS candidate: `de6c0d9e2fa49322…` (46499328 bytes), go version go1.25.4 windows/amd64

## Verdicts по критериям брифа

- **1 manifest/hashes/versions** — PASS: corpus manifest + byte hashes + git HEAD + tool versions/hashes in report
- **2 same source bytes per parity pair** — PASS: matched=40, drifted=0, missing=0; mechanism read from owning code (file-limits.js, extraction/index.js)
- **3 comparable measurement discipline** — PASS: structural SQL separate; DAIS end-to-end CLI; raw samples + nearest-rank p50/p95; warmup 5; 30 runs; exact sets outside timed loop
- **4 index time + peak RSS observed** — PARTIAL: DAIS observed (real build); CodeGraph unmeasured — rebuild launch outside sanctioned surface; M0b therefore NOT fully complete
- **5 discriminating oracle + fixture qualification** — PASS: tests written before implementation (pre-implementation FAIL receipt); mini fixture incl. Unicode/spaces, wrong path, hash mismatch, wrong revision, absent token
- **6 no unsupported speedup claim** — PASS: no speedup claimed; semantics labeled; scale limits stated

## Parity: source bytes

- matched: 40, drifted: 0, missing_from_codegraph: 0

## Semantics сравниваемых запросов (честная разметка)

- codegraph symbol-exact (resolved definition nodes, tree-sitter) vs dais symbol_text (raw text lines): comparable=False — different domains: resolved graph nodes vs fulltext lines; same field name does not make them the same query
- codegraph references (resolved edges) vs SCIP references: comparable=False — SCIP producer not run in this slice — reference parity is residual
- dais code search (fulltext lines) vs codegraph: comparable=False — CodeGraph has no fulltext surface; no pair exists
- indexed source bytes (content_hash mechanism, owning-code verified): comparable=True — sha256(bytes) for <=1MiB files; oversize stamp excluded from corpus

## Measurements

- CodeGraph structural SQL (frozen full index, in-process): symbol-exact-corpus p50=0.013/p95=0.022ms, symbol-exact-ts-control p50=0.008/p95=0.013ms, symbol-prefix p50=54.620/p95=71.100ms, file-symbols p50=0.104/p95=0.241ms, references-corpus p50=0.064/p95=0.103ms, absent-symbol-control p50=0.011/p95=0.083ms
- DAIS index: wall 2.296s, peak RSS 121704448 bytes (sampled Windows PSAPI PeakWorkingSetSize @50ms), indexedFiles=40, omitted=0
- DAIS search code-token-corpus (code): end-to-end CLI p50=626.5/p95=1115.6ms, results=26, warmup=5, runs=30
- DAIS search symbol-text-corpus (symbol_text): end-to-end CLI p50=393.1/p95=1132.5ms, results=26, warmup=5, runs=30
- DAIS search filename-corpus (filename): end-to-end CLI p50=201.6/p95=394.2ms, results=1, warmup=5, runs=30
- DAIS search code-absent-control (code): end-to-end CLI p50=143.4/p95=211.8ms, results=0, warmup=5, runs=30

## Not measured (явно)

- index_time (real rebuild not observed — codegraph init/index launch is outside the sanctioned bin/ surface: sync/status only)
- indexer peak RSS (same reason)
- MCP end-to-end latency (live daemon drive would risk a live-DB write)
- SCIP reference/definition parity (scip-go producer not run in this slice)
- 5-million-entity scale, Delphi/1С, producer semantics, calls/transitive impact
- full-repo (6020-file) DAIS index — corpus is the dais module only

## Controls

- CodeGraph: {"known_ts_symbol_found": true, "absent_symbol_count": 0}
- DAIS: {"wrong_revision_expected_fail": "EXPECTED_FAIL confirmed (exit 1)", "status_right_revision": true, "absent_token_results": 0, "precision_check": {"checked": 26, "violations": [], "precise": true}}

## Parent replay

```
python experiments/2026-10-19_dais-m0b-baseline/dais_baseline.py run
```

## Limits

- production consumers untouched; no daemon; no commit; native Windows only
- corpus = dais module source; conclusions scoped to it
