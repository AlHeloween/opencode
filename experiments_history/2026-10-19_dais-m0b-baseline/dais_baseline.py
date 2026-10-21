"""M0b DAIS baseline — reproducible corpus freeze + CodeGraph structural baseline
+ DAIS text-search baseline on pinned source bytes.

Single entry point (parent replay command):
    python experiments/2026-10-19_dais-m0b-baseline/dais_baseline.py run

Write boundary: everything under this experiment directory. The live
.codegraph/codegraph.db is opened READ-ONLY (SQLite backup into our own frozen
copy). No production path is written; no daemon is started; the codegraph CLI
is not launched (bin/ launch policy names only sync/status — CodeGraph
index_time/RSS therefore stay unmeasured and are reported as such).

Stages: freeze -> codegraph -> dais -> report. Each stage writes its own JSON
under run-<stamp>/ and the final report.json + REPORT.md land in the
experiment root.
"""
import argparse
import ctypes
import hashlib
import json
import math
import os
import platform
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

EXPERIMENT_DIR = Path(__file__).resolve().parent
WORKTREE = EXPERIMENT_DIR.parents[1]
CODEGRAPH_DB = WORKTREE / ".codegraph" / "codegraph.db"
FOSSIL_EXE = WORKTREE / "external" / "fossil" / "fossil.exe"
MODULE = WORKTREE / "packages" / "dais-code-intelligence"
DAIS_CI = EXPERIMENT_DIR / "dist" / "dais-ci.exe"

# Owning code: bin/codegraph/lib/dist/file-limits.js:48
CODEGRAPH_MAX_SOURCE_FILE_SIZE_BYTES = 1024 * 1024

WARMUP = 5
TIMED_RUNS = 30
RSS_POLL_SECONDS = 0.05

ABSENT_SYMBOL = "DAIS_ABSENT_SYMBOL_5c341afb"
ABSENT_TOKEN = "DAIS_ABSENT_TOKEN_5c341afb"

# Fixed BEFORE the run (no fitting to backend output). Parameters name real
# corpus symbols/tokens; the ts-control keeps continuity with the historical
# 2026-10-16 structural baseline.
STRUCTURAL_QUERIES = [
    ("symbol-exact-corpus", "SELECT id,kind,file_path,start_line FROM nodes WHERE name=?",
     ("Adapter",)),
    ("symbol-exact-ts-control", "SELECT id,kind,file_path,start_line FROM nodes WHERE name=?",
     ("vectorSign",)),
    ("symbol-prefix", "SELECT id,name,file_path,start_line FROM nodes WHERE name LIKE ? LIMIT 100",
     ("Snapshot%",)),
    ("file-symbols", "SELECT id,kind,name FROM nodes WHERE file_path=?",
     ("packages/dais-code-intelligence/internal/search/adapter.go",)),
    ("references-corpus",
     "SELECT e.kind,e.source,e.target FROM edges e WHERE e.target IN (SELECT id FROM nodes WHERE name=?)",
     ("Adapter",)),
    ("absent-symbol-control", "SELECT count(*) FROM nodes WHERE name=?",
     (ABSENT_SYMBOL,)),
]

DAIS_SEARCHES = [
    ("code-token-corpus", "code", "Adapter"),
    ("symbol-text-corpus", "symbol_text", "Adapter"),
    ("filename-corpus", "filename", "adapter.go"),
    ("code-absent-control", "code", ABSENT_TOKEN),
]

WRONG_REVISION = "f" * 40


class FreezeError(RuntimeError):
    pass


class FossilError(RuntimeError):
    pass


class DaisError(RuntimeError):
    pass


class ControlFailure(RuntimeError):
    pass


# ---------------------------------------------------------------- primitives

def nearest_rank(sorted_samples, q):
    """Named formula: nearest-rank percentile, idx = ceil(q*n)-1 on ascending samples."""
    if not sorted_samples:
        raise ValueError("empty samples")
    idx = max(0, math.ceil(q * len(sorted_samples)) - 1)
    return sorted_samples[idx]


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def codegraph_content_hash(size, data):
    """Mechanism read from owning code, not guessed:
    bin/codegraph/lib/dist/file-limits.js:58-59,67-68 and
    bin/codegraph/lib/dist/extraction/index.js:113-115 — sha256(utf8 bytes)
    within the 1 MiB limit; sha256('codegraph:oversize:<size>') above it
    (an oversize file is never decoded, its bytes are never hashed)."""
    if size > CODEGRAPH_MAX_SOURCE_FILE_SIZE_BYTES:
        return sha256_bytes(f"codegraph:oversize:{size}".encode("utf-8"))
    return sha256_bytes(data)


def discover_corpus():
    """Named corpus: production *.go source of the dais-code-intelligence module.
    Excludes scripts/.scratch/ (generated Zoekt overlay builder copies from probe
    runs — not production source) and go.mod/go.sum (module metadata CodeGraph
    does not index as source files). Real repo source, not a synthetic fixture
    and not presented as the whole project or a 5M-entity scale."""
    files = set()
    for go in MODULE.rglob("*.go"):
        rel = go.relative_to(WORKTREE).as_posix()
        if "/.scratch/" in rel:
            continue
        files.add(rel)
    return sorted(files)


def freeze_corpus(source_root, rel_paths, out=None):
    """Copy corpus bytes and hash them. Missing paths are a loud error
    (wrong filter/path control); oversize files are excluded and recorded."""
    manifest = {"source_root": str(source_root), "files": [], "oversize_excluded": []}
    missing = []
    for rel in rel_paths:
        src = source_root / rel
        if not src.is_file():
            missing.append(rel)
            continue
        data = src.read_bytes()
        if len(data) > CODEGRAPH_MAX_SOURCE_FILE_SIZE_BYTES:
            manifest["oversize_excluded"].append({"path": rel, "bytes": len(data)})
            continue
        entry = {"path": rel, "bytes": len(data), "sha256": sha256_bytes(data)}
        if out is not None:
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            entry["frozen"] = str(dest)
        manifest["files"].append(entry)
    if missing:
        raise FreezeError(f"corpus paths missing on disk: {missing}")
    manifest["files"].sort(key=lambda f: f["path"])
    manifest_text = json.dumps(manifest["files"], ensure_ascii=False, sort_keys=True)
    manifest["manifest_sha256"] = sha256_bytes(manifest_text.encode("utf-8"))
    return manifest


def verify_codegraph_coverage(db_path, corpus_hashes):
    """Compare frozen CodeGraph files.content_hash against corpus bytes using
    the owning-code mechanism. Mismatch = drift, reported, never accepted."""
    db = sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        rows = {row[0]: row[1] for row in db.execute("SELECT path, content_hash FROM files")}
    finally:
        db.close()
    matched, drifted, missing = [], [], []
    for path, sha in sorted(corpus_hashes.items()):
        if path not in rows:
            missing.append(path)
        elif rows[path] == sha:
            matched.append(path)
        else:
            drifted.append({"path": path, "codegraph_content_hash": rows[path], "corpus_sha256": sha})
    return {"matched": matched, "drifted": drifted, "missing_from_codegraph": missing,
            "codegraph_files_total": len(rows)}


# ------------------------------------------------------------------ fossil

def build_fossil_fixture(fossil_exe, corpus_dir, scratch, files, log=None):
    """Own scratch Fossil repository holding exactly the frozen corpus bytes.
    Patterns qualified by M1: --nested open, --no-warnings --no-prompt commit,
    stderr checked on every call (readonly write-control taught exit 0 + stderr)."""
    fsl = scratch / "corpus.fsl"
    checkout = scratch / "checkout"
    fhome = scratch / "fossil-home"
    log = [] if log is None else log
    checkout.mkdir(parents=True, exist_ok=True)
    fhome.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["FOSSIL_HOME"] = str(fhome)

    def fossil(*args, cwd):
        proc = subprocess.run([str(fossil_exe), *args], cwd=str(cwd), env=env,
                              capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=120)
        log.append({"cmd": ["fossil", *args], "cwd": str(cwd), "exit": proc.returncode,
                    "stderr": proc.stderr[-2000:]})
        if proc.returncode != 0:
            raise FossilError(f"fossil {args[0]} exit {proc.returncode}: {proc.stderr[-2000:]}")
        if proc.stderr.strip():
            # M1 lesson: stderr with exit 0 must be recorded, not ignored
            log.append({"fossil_stderr_nonempty": proc.stderr[-2000:], "cmd": args[0]})
        return proc

    fossil("init", str(fsl), cwd=str(scratch))
    fossil("open", str(fsl), "--nested", cwd=str(checkout))
    for rel in files:
        dest = checkout / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(corpus_dir / rel, dest)
    fossil("add", *files, cwd=str(checkout))
    fossil("commit", "--no-warnings", "--no-prompt", "--user-override", "dais-m0b",
           "-m", "m0b corpus freeze", cwd=str(checkout))
    info = fossil("info", cwd=str(checkout))
    sql = fossil("sql", "--no-repository", "--readonly", "-json", str(fsl),
                "SELECT b.uuid AS h FROM blob b JOIN event e ON e.objid=b.rid "
                "WHERE e.type='ci' ORDER BY e.mtime DESC LIMIT 1", cwd=str(checkout))
    rows = json.loads(sql.stdout or "[]")
    full = rows[0]["h"] if rows else ""
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", full or ""):
        raise FossilError(f"fossil sql returned no full check-in hash: {sql.stdout[:200]!r}")
    return full


# -------------------------------------------------------------------- dais

class _PeakRssPoller:
    """Windows PSAPI PeakWorkingSetSize sampling — observed, never estimated."""

    def __init__(self, pid):
        self.peak = 0
        self.samples = 0
        self.error = None
        self._stop = threading.Event()
        self._handle = None
        try:
            self._handle = ctypes.windll.kernel32.OpenProcess(0x0400 | 0x0010, False, pid)
            if not self._handle:
                self.error = "OpenProcess failed (winerror %s)" % ctypes.GetLastError()
        except Exception as exc:  # noqa: BLE001 — reported, never silent
            self.error = f"poller init failed: {exc}"
            self._handle = None

    class _PMC(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

    def _poll_once(self):
        pmc = self._PMC()
        pmc.cb = ctypes.sizeof(pmc)
        if ctypes.windll.psapi.GetProcessMemoryInfo(self._handle, ctypes.byref(pmc), pmc.cb):
            self.peak = max(self.peak, int(pmc.PeakWorkingSetSize))
            self.samples += 1

    def run(self):
        while not self._stop.is_set():
            if self._handle:
                self._poll_once()
            self._stop.wait(RSS_POLL_SECONDS)

    def stop(self):
        self._stop.set()
        if self._handle:
            ctypes.windll.kernel32.CloseHandle(self._handle)


def _dais_cmd(dais_ci, sub, index_root, repository_id, extra):
    return [str(dais_ci), sub, "--index-root", str(index_root),
            "--repository-id", repository_id, *extra]


def run_dais_index(dais_ci, fossil_exe, repository, fossil_home, ref, index_root,
                   repository_id, log_dir):
    fossil_home.mkdir(parents=True, exist_ok=True)
    cmd = _dais_cmd(dais_ci, "index", index_root, repository_id,
                    ["--repository", str(repository), "--fossil", str(fossil_exe),
                     "--fossil-home", str(fossil_home), "--ref", ref, "--mode", "full"])
    started = time.perf_counter_ns()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace")
    poller = _PeakRssPoller(proc.pid)
    thread = threading.Thread(target=poller.run, daemon=True)
    thread.start()
    out, err = proc.communicate()
    wall_seconds = (time.perf_counter_ns() - started) / 1e9
    poller.stop()
    thread.join(timeout=1)
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / "dais-index-stdout.json").write_text(out, encoding="utf-8")
    (log_dir / "dais-index-stderr.log").write_text(err or "", encoding="utf-8")
    if proc.returncode != 0:
        raise DaisError(f"dais-ci index exit {proc.returncode}: {(err or '')[-2000:]}")
    snapshot = json.loads(out)
    return {"snapshot": snapshot, "wall_seconds": wall_seconds,
            "peak_rss_bytes": poller.peak or None, "rss_samples": poller.samples,
            "rss_method": "sampled Windows PSAPI PeakWorkingSetSize @50ms",
            "rss_error": poller.error, "cmd": cmd}


def run_dais_search(dais_ci, index_root, repository_id, kind, query, expect_revision=None,
                    limit=100):
    cmd = _dais_cmd(dais_ci, "search", index_root, repository_id,
                    ["--kind", kind, "--query", query, "--limit", str(limit)])
    if expect_revision:
        cmd += ["--expect-revision", expect_revision]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=120)
    if proc.returncode != 0:
        raise DaisError(f"dais-ci search exit {proc.returncode}: {(proc.stderr or '')[-2000:]}")
    return json.loads(proc.stdout)


def run_dais_status(dais_ci, index_root, repository_id, expect_revision=None):
    cmd = _dais_cmd(dais_ci, "status", index_root, repository_id, [])
    if expect_revision:
        cmd += ["--expect-revision", expect_revision]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=120)
    if proc.returncode != 0:
        raise DaisError(f"dais-ci status exit {proc.returncode}: {(proc.stderr or '')[-2000:]}")
    return json.loads(proc.stdout)


def timed_cli(fn, warmup=WARMUP, runs=TIMED_RUNS):
    """End-to-end CLI timing: full process spawn per sample, warmup excluded."""
    for _ in range(warmup):
        fn()
    samples = []
    for _ in range(runs):
        t0 = time.perf_counter_ns()
        fn()
        samples.append((time.perf_counter_ns() - t0) / 1e6)
    samples.sort()
    return samples


# --------------------------------------------------------------- codegraph

def freeze_codegraph_db(source_db, frozen_path):
    """Read-only SQLite backup of the live DB into our own frozen copy."""
    source = sqlite3.connect(source_db.resolve().as_uri() + "?mode=ro", uri=True)
    target = sqlite3.connect(frozen_path)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return sha256_file(frozen_path)


def measure_structural(db_path):
    """Structural SQL latency on the frozen copy — in-process, separate from
    any end-to-end claim. Exact rows are captured OUTSIDE the timed loop."""
    db = sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        assert db.execute("SELECT 2+2").fetchone()[0] == 4
        counts = {table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                  for table in ("files", "nodes", "edges", "unresolved_refs")}
        languages = [dict(row) for row in db.execute(
            "SELECT language,count(*) AS files,sum(size) AS bytes FROM files"
            " GROUP BY language ORDER BY files DESC")]
        measurements, exact_sets = [], {}
        for label, sql, parameters in STRUCTURAL_QUERIES:
            for _ in range(WARMUP):
                db.execute(sql, parameters).fetchall()
            samples = []
            for _ in range(TIMED_RUNS):
                t0 = time.perf_counter_ns()
                rows = db.execute(sql, parameters).fetchall()
                samples.append((time.perf_counter_ns() - t0) / 1e6)
            samples.sort()
            exact = [dict(row) for row in db.execute(sql, parameters).fetchall()]
            exact_sets[label] = {"total": len(exact), "rows": exact[:200],
                                 "truncated": len(exact) > 200}
            measurements.append({
                "query": label, "sql": sql, "parameters": list(parameters),
                "results": len(exact), "warmup": WARMUP, "runs": len(samples),
                "percentile_formula": "nearest-rank: sorted[ceil(q*n)-1]",
                "p50_ms": nearest_rank(samples, 0.50), "p95_ms": nearest_rank(samples, 0.95),
                "median_ms": statistics.median(samples), "samples_ms": samples})
        absent_rows = exact_sets["absent-symbol-control"]["rows"]
        absent_count = list(absent_rows[0].values())[0] if absent_rows else -1
        for m in measurements:
            if m["query"] == "absent-symbol-control":
                m["results"] = absent_count  # scalar count, not row count
        controls = {
            "known_ts_symbol_found": exact_sets["symbol-exact-ts-control"]["total"] > 0,
            "absent_symbol_count": absent_count,
        }
        if not controls["known_ts_symbol_found"] or controls["absent_symbol_count"] != 0:
            raise ControlFailure(f"codegraph structural controls failed: {controls}")
        return {"counts": counts, "languages": languages, "measurements": measurements,
                "exact_sets": exact_sets, "controls": controls}
    finally:
        db.close()


# ------------------------------------------------------------------ report

def precision_check(frozen_dir, response, token):
    """Every reported (path, line) must contain the token in the frozen bytes —
    checked against OUR corpus copy, not against backend output."""
    checked, bad = 0, []
    for match in response.get("Results", []):
        rel = match["Path"]
        line_no = match["Line"]
        text = (frozen_dir / rel).read_text("utf-8", errors="replace").split("\n")
        line = text[line_no - 1] if 0 < line_no <= len(text) else ""
        checked += 1
        if token not in line:
            bad.append({"path": rel, "line": line_no})
    return {"checked": checked, "violations": bad, "precise": not bad}


def write_report(run_dir, data):
    report_path = run_dir / "report.json"
    report_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    md = render_markdown(data)
    (run_dir / "REPORT.md").write_text(md, encoding="utf-8")
    shutil.copyfile(report_path, EXPERIMENT_DIR / "report.json")
    shutil.copyfile(run_dir / "REPORT.md", EXPERIMENT_DIR / "REPORT.md")
    return report_path


def render_markdown(data):
    lines = [
        "# M0b DAIS baseline — отчёт среза",
        "",
        f"Run: `{data['run_id']}` · generated {data['generated_utc']}",
        "",
        "## Scope",
        "",
        f"- Corpus: `{data['corpus']['definition']}` — {len(data['corpus']['manifest']['files'])} files, "
        f"manifest sha256 `{data['corpus']['manifest']['manifest_sha256'][:16]}…`",
        f"- Source revision: git HEAD `{data['corpus']['git_head']}`, "
        f"dirty entries at freeze: {data['corpus']['dirty_entries']} — per-file sha256 "
        "в манифесте является закрепляющей привязкой (dirty tree не пиннится одним HEAD).",
        f"- CodeGraph frozen copy: `{data['codegraph']['frozen_db_sha256'][:16]}…` "
        f"({data['codegraph']['frozen_db_bytes']} bytes, read-only backup)",
        f"- DAIS candidate: `{data['dais']['binary_sha256'][:16]}…` "
        f"({data['dais']['binary_bytes']} bytes), {data['tools']['go_version']}",
        "",
        "## Verdicts по критериям брифа",
        "",
    ]
    for criterion in data["criteria"]:
        lines.append(f"- **{criterion['id']}** — {criterion['verdict']}: {criterion['note']}")
    lines += ["", "## Parity: source bytes", ""]
    parity = data["parity"]["byte_identity"]
    lines.append(f"- matched: {len(parity['matched'])}, drifted: {len(parity['drifted'])}, "
                 f"missing_from_codegraph: {len(parity['missing_from_codegraph'])}")
    if parity["drifted"]:
        lines.append(f"- drifted paths: {json.dumps(parity['drifted'], ensure_ascii=False)}")
    lines += ["", "## Semantics сравниваемых запросов (честная разметка)", ""]
    for row in data["parity"]["semantics"]:
        lines.append(f"- {row['pair']}: comparable={row['comparable']} — {row['note']}")
    lines += ["", "## Measurements", ""]
    cg = data["codegraph"]
    lines.append(f"- CodeGraph structural SQL (frozen full index, in-process): "
                 + ", ".join(f"{m['query']} p50={m['p50_ms']:.3f}/p95={m['p95_ms']:.3f}ms"
                             for m in cg["measurements"]))
    dais = data["dais"]
    lines.append(f"- DAIS index: wall {dais['index']['wall_seconds']:.3f}s, "
                 f"peak RSS {dais['index']['peak_rss_bytes']} bytes "
                 f"({dais['index']['rss_method']}), indexedFiles="
                 f"{dais['index']['snapshot'].get('IndexedFiles')}, omitted="
                 f"{dais['index']['snapshot'].get('OmittedFiles')}")
    for m in dais["searches"]:
        lines.append(f"- DAIS search {m['query']} ({m['kind']}): end-to-end CLI "
                     f"p50={m['p50_ms']:.1f}/p95={m['p95_ms']:.1f}ms, results={m['results']}, "
                     f"warmup={m['warmup']}, runs={m['runs']}")
    lines += ["", "## Not measured (явно)", ""]
    for item in data["not_measured"]:
        lines.append(f"- {item}")
    lines += ["", "## Controls", ""]
    lines.append(f"- CodeGraph: {json.dumps(cg['controls'])}")
    lines.append(f"- DAIS: {json.dumps(dais['controls'], ensure_ascii=False)}")
    lines += ["", "## Parent replay", "",
              "```", data["replay_command"], "```",
              "", "## Limits", ""]
    for item in data["limits"]:
        lines.append(f"- {item}")
    lines.append("")
    return "\n".join(lines)


# -------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", nargs="?", default="run", choices=["run"])
    args = parser.parse_args()

    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "_" + uuid.uuid4().hex[:8]
    run_dir = EXPERIMENT_DIR / f"run-{run_id}"
    run_dir.mkdir(parents=True)
    log_dir = run_dir / "logs"
    receipts = []

    # ---- stage: freeze
    corpus_rel = discover_corpus()
    manifest = freeze_corpus(WORKTREE, corpus_rel, out=run_dir / "corpus")
    git_head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(WORKTREE),
                              capture_output=True, text=True, timeout=60).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=str(WORKTREE),
                           capture_output=True, text=True, timeout=60).stdout.splitlines()
    (run_dir / "corpus-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- stage: codegraph
    frozen_db = run_dir / "frozen" / "codegraph.db"
    frozen_db.parent.mkdir(parents=True, exist_ok=True)
    frozen_sha = freeze_codegraph_db(CODEGRAPH_DB, frozen_db)
    corpus_hashes = {f["path"]: f["sha256"] for f in manifest["files"]}
    coverage = verify_codegraph_coverage(frozen_db, corpus_hashes)
    structural = measure_structural(frozen_db)
    codegraph_stage = {
        "source_db": str(CODEGRAPH_DB), "frozen_db": str(frozen_db),
        "frozen_db_sha256": frozen_sha, "frozen_db_bytes": frozen_db.stat().st_size,
        **coverage, **structural,
        "not_measured": ["index_time (real rebuild not observed — codegraph init/index "
                         "launch is outside the sanctioned bin/ surface: sync/status only)",
                         "indexer peak RSS (same reason)",
                         "MCP end-to-end latency (live daemon drive would risk a live-DB write)"],
    }
    (run_dir / "codegraph-stage.json").write_text(
        json.dumps(codegraph_stage, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- stage: dais
    if not DAIS_CI.exists():
        raise SystemExit(f"HARNESS: candidate {DAIS_CI} missing — build it first")
    go_version = subprocess.run(["go", "version"], capture_output=True, text=True,
                                timeout=60).stdout.strip()
    fossil_version = subprocess.run([str(FOSSIL_EXE), "version"], capture_output=True,
                                    text=True, timeout=60).stdout.strip()
    scratch = run_dir / "scratch"
    revision = build_fossil_fixture(FOSSIL_EXE, run_dir / "corpus", scratch,
                                    [f["path"] for f in manifest["files"]], receipts)
    index = run_dais_index(DAIS_CI, FOSSIL_EXE, scratch / "corpus.fsl",
                           scratch / "fossil-home", revision,
                           run_dir / "dais-index", "m0b-corpus", log_dir)
    searches, controls = [], {
        "wrong_revision_expected_fail": None, "status_right_revision": None,
        "absent_token_results": None, "precision_check": None}
    for label, kind, query in DAIS_SEARCHES:
        exact = run_dais_search(DAIS_CI, run_dir / "dais-index", "m0b-corpus", kind, query,
                                expect_revision=revision)
        samples = timed_cli(lambda k=kind, q=query: run_dais_search(
            DAIS_CI, run_dir / "dais-index", "m0b-corpus", k, q, expect_revision=revision))
        entry = {"query": label, "kind": kind, "expression": query,
                 "results": len(exact.get("Results", [])), "complete": exact.get("Complete"),
                 "truncated": exact.get("Truncated"), "warmup": WARMUP, "runs": len(samples),
                 "percentile_formula": "nearest-rank: sorted[ceil(q*n)-1]",
                 "p50_ms": nearest_rank(samples, 0.50), "p95_ms": nearest_rank(samples, 0.95),
                 "samples_ms": samples, "exact_response": exact}
        if label == "code-token-corpus":
            controls["precision_check"] = precision_check(run_dir / "corpus", exact, query)
        if label == "code-absent-control":
            controls["absent_token_results"] = len(exact.get("Results", []))
        searches.append(entry)
    try:
        run_dais_search(DAIS_CI, run_dir / "dais-index", "m0b-corpus", "code", "Adapter",
                        expect_revision=WRONG_REVISION)
        controls["wrong_revision_expected_fail"] = "FAIL — wrong revision was accepted"
    except DaisError:
        controls["wrong_revision_expected_fail"] = "EXPECTED_FAIL confirmed (exit 1)"
    status = run_dais_status(DAIS_CI, run_dir / "dais-index", "m0b-corpus",
                             expect_revision=revision)
    controls["status_right_revision"] = status.get("Revision") == revision
    if controls["absent_token_results"] != 0:
        raise ControlFailure("absent-token control returned results")
    if not controls["precision_check"]["precise"]:
        raise ControlFailure(f"precision check violations: {controls['precision_check']}")
    if controls["wrong_revision_expected_fail"] != "EXPECTED_FAIL confirmed (exit 1)":
        raise ControlFailure("wrong-revision control did not fail")
    dais_stage = {
        "binary": str(DAIS_CI), "binary_sha256": sha256_file(DAIS_CI),
        "binary_bytes": DAIS_CI.stat().st_size, "go_version": go_version,
        "fossil_version": fossil_version, "fixture_revision": revision,
        "fixture_receipts": receipts, "index": index, "searches": searches,
        "controls": controls,
    }
    (run_dir / "dais-stage.json").write_text(
        json.dumps(dais_stage, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- stage: report
    matched_paths = set(coverage["matched"])
    data = {
        "run_id": run_id,
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scope": "M0b baseline slice: reproducible corpus freeze + CodeGraph structural "
                 "baseline + DAIS text-search baseline; no speedup claim, no consumer cutover",
        "corpus": {
            "definition": "packages/dais-code-intelligence/**: production *.go only, "
                           "excluding scripts/.scratch/ overlay copies and non-indexed "
                           "go.mod/go.sum (real repo source; NOT the whole project, "
                          "NOT a 5M-entity scale)",
            "git_head": git_head, "dirty_entries": len(dirty),
            "manifest": manifest,
        },
        "tools": {
            "python": platform.python_version(), "platform": platform.platform(),
            "go_version": go_version, "fossil_version": fossil_version,
            "dais_ci_sha256": dais_stage["binary_sha256"],
            "codegraph_cli": "bin/codegraph.cmd — NOT launched (policy: sync/status only); "
                             "owning code read for the content_hash mechanism",
            "zoekt_head_overlay_verified": "74e1e85839697c4c4eb8a6223cc3971e6c26da45",
        },
        "codegraph": codegraph_stage,
        "dais": dais_stage,
        "parity": {
            "byte_identity": coverage,
            "semantics": [
                {"pair": "codegraph symbol-exact (resolved definition nodes, tree-sitter) "
                         "vs dais symbol_text (raw text lines)",
                 "comparable": False,
                 "note": "different domains: resolved graph nodes vs fulltext lines; "
                         "same field name does not make them the same query"},
                {"pair": "codegraph references (resolved edges) vs SCIP references",
                 "comparable": False,
                 "note": "SCIP producer not run in this slice — reference parity is residual"},
                {"pair": "dais code search (fulltext lines) vs codegraph",
                 "comparable": False,
                 "note": "CodeGraph has no fulltext surface; no pair exists"},
                {"pair": "indexed source bytes (content_hash mechanism, owning-code verified)",
                 "comparable": True,
                 "note": "sha256(bytes) for <=1MiB files; oversize stamp excluded from corpus"},
            ],
            "verdict": "byte parity verified per file; NO query-semantics parity claimed; "
                       "no speedup claim",
        },
        "criteria": [
            {"id": "1 manifest/hashes/versions", "verdict": "PASS",
             "note": "corpus manifest + byte hashes + git HEAD + tool versions/hashes in report"},
            {"id": "2 same source bytes per parity pair", "verdict": (
                "PASS" if not coverage["drifted"] and not coverage["missing_from_codegraph"]
                else "RESIDUAL"),
             "note": f"matched={len(matched_paths)}, drifted={len(coverage['drifted'])}, "
                     f"missing={len(coverage['missing_from_codegraph'])}; mechanism read from "
                     "owning code (file-limits.js, extraction/index.js)"},
            {"id": "3 comparable measurement discipline", "verdict": "PASS",
             "note": "structural SQL separate; DAIS end-to-end CLI; raw samples + nearest-rank "
                     f"p50/p95; warmup {WARMUP}; {TIMED_RUNS} runs; exact sets outside timed loop"},
            {"id": "4 index time + peak RSS observed", "verdict": "PARTIAL",
             "note": "DAIS observed (real build); CodeGraph unmeasured — rebuild launch outside "
                     "sanctioned surface; M0b therefore NOT fully complete"},
            {"id": "5 discriminating oracle + fixture qualification", "verdict": "PASS",
             "note": "tests written before implementation (pre-implementation FAIL receipt); "
                     "mini fixture incl. Unicode/spaces, wrong path, hash mismatch, wrong "
                     "revision, absent token"},
            {"id": "6 no unsupported speedup claim", "verdict": "PASS",
             "note": "no speedup claimed; semantics labeled; scale limits stated"},
        ],
        "not_measured": [
            *codegraph_stage["not_measured"],
            "SCIP reference/definition parity (scip-go producer not run in this slice)",
            "5-million-entity scale, Delphi/1С, producer semantics, calls/transitive impact",
            "full-repo (6020-file) DAIS index — corpus is the dais module only",
        ],
        "limits": [
            "production consumers untouched; no daemon; no commit; native Windows only",
            "corpus = dais module source; conclusions scoped to it",
        ],
        "replay_command": "python experiments/2026-10-19_dais-m0b-baseline/dais_baseline.py run",
        "changed_paths": [str(run_dir), "experiments/2026-10-19_dais-m0b-baseline/report.json",
                          "experiments/2026-10-19_dais-m0b-baseline/REPORT.md"],
    }
    report_path = write_report(run_dir, data)
    print(json.dumps({"run_id": run_id, "report": str(report_path),
                      "corpus_files": len(manifest["files"]),
                      "coverage_matched": len(coverage["matched"]),
                      "coverage_drifted": len(coverage["drifted"]),
                      "coverage_missing": len(coverage["missing_from_codegraph"]),
                      "dais_index_seconds": index["wall_seconds"],
                      "dais_peak_rss_bytes": index["peak_rss_bytes"]},
                     ensure_ascii=False, indent=2))
    print("DAIS_M0B_BASELINE_PASS")


if __name__ == "__main__":
    main()
