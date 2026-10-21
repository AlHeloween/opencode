# M0b DAIS baseline — отчёт среза

Run: `20261018T195733Z_b3f48389` · generated 2026-10-18T19:57:55Z

## Scope

- Corpus: `packages/dais-code-intelligence/**: production *.go only, excluding scripts/.scratch/ overlay copies and non-indexed go.mod/go.sum (real repo source; NOT the whole project, NOT a 5M-entity scale)` — 40 files, manifest sha256 `b1676667cbdb702e…`
- Source revision: git HEAD `241cae56fb5869f89dde6bd511335dbc50505d3d`, dirty entries at freeze: 31 — per-file sha256 в манифесте является закрепляющей привязкой (dirty tree не пиннится одним HEAD).
- CodeGraph frozen copy: `8adf44a90beb41fd…` (422006784 bytes, read-only backup)
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

- CodeGraph structural SQL (frozen full index, in-process): symbol-exact-corpus p50=0.012/p95=0.015ms, symbol-exact-ts-control p50=0.008/p95=0.011ms, symbol-prefix p50=28.087/p95=31.377ms, file-symbols p50=0.064/p95=0.130ms, references-corpus p50=0.059/p95=0.133ms, absent-symbol-control p50=0.009/p95=0.023ms
- DAIS index: wall 0.302s, peak RSS 122413056 bytes (sampled Windows PSAPI PeakWorkingSetSize @50ms), indexedFiles=40, omitted=0
- DAIS search code-token-corpus (code): end-to-end CLI p50=102.0/p95=190.6ms, results=26, warmup=5, runs=30
- DAIS search symbol-text-corpus (symbol_text): end-to-end CLI p50=92.2/p95=102.7ms, results=26, warmup=5, runs=30
- DAIS search filename-corpus (filename): end-to-end CLI p50=88.7/p95=109.5ms, results=1, warmup=5, runs=30
- DAIS search code-absent-control (code): end-to-end CLI p50=102.6/p95=361.7ms, results=0, warmup=5, runs=30

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
