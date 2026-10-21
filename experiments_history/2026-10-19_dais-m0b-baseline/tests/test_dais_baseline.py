# M0b baseline tool tests — written BEFORE the tool implementation (brief req. 5).
# Qualifies the reader on a small deterministic fixture: Unicode/spaces paths,
# wrong filter/path, source hash mismatch, wrong revision, absent token.
# Run: python -m pytest experiments/2026-10-19_dais-m0b-baseline/tests/test_dais_baseline.py -q
# (or: python -m unittest tests.test_dais_baseline from the experiment dir)
import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

EXPERIMENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPERIMENT_DIR))

import dais_baseline  # noqa: E402

FOSSIL_EXE = Path("D:/zPython/opencode/external/fossil/fossil.exe")
DAIS_CI = EXPERIMENT_DIR / "dist" / "dais-ci.exe"

# Deterministic mini fixture content. The token is chosen so that no corpus
# file in the real run can contain it, and so the expected occurrences are
# countable by hand.
TOKEN = "M0B_QUAL_TOKEN_42"
ABSENT_TOKEN = "DAIS_ABSENT_TOKEN_5c341afb"
FILE_A = "dir with space/uni-λ-файл.go"  # Unicode + spaces in path
FILE_B = "plain.go"
CONTENT_A = (
    "package qual\n\n"
    "// " + TOKEN + " on line 3\n"
    "func A() { _ = " + TOKEN + " } // second occurrence, same line\n"
    "func B() {}\n"
).encode("utf-8")
CONTENT_B = (
    "package qual\n\n"
    "var C = " + TOKEN + "\n"
).encode("utf-8")


def build_mini_corpus(root: Path) -> dict:
    """Deterministic mini corpus: two files, one with Unicode/space path."""
    (root / "dir with space").mkdir(parents=True, exist_ok=True)
    (root / FILE_A).write_bytes(CONTENT_A)
    (root / FILE_B).write_bytes(CONTENT_B)
    return {FILE_A: CONTENT_A, FILE_B: CONTENT_B}


class PercentileFormulaTest(unittest.TestCase):
    def test_nearest_rank_fixed_samples(self):
        samples = list(range(1, 31))  # 1..30 sorted
        # Named formula: nearest-rank, p50 = sorted[ceil(0.5*n)-1], p95 = sorted[ceil(0.95*n)-1]
        self.assertEqual(dais_baseline.nearest_rank(samples, 0.50), 15)
        self.assertEqual(dais_baseline.nearest_rank(samples, 0.95), 29)

    def test_nearest_rank_rejects_empty(self):
        with self.assertRaises(ValueError):
            dais_baseline.nearest_rank([], 0.95)


class ContentHashMechanismTest(unittest.TestCase):
    """The CodeGraph content_hash mechanism, read from owning code
    (bin/codegraph/lib/dist/file-limits.js:48,58-59,67-68 and
    extraction/index.js:113-115): sha256(utf8 bytes) within the 1 MiB limit,
    sha256('codegraph:oversize:<size>') above it. Verified here against
    independently computed values, not against backend output."""

    def test_within_limit_is_sha256_of_bytes(self):
        data = b"hello m0b"
        expected = hashlib.sha256(data).hexdigest()
        self.assertEqual(dais_baseline.codegraph_content_hash(len(data), data), expected)

    def test_over_limit_is_size_stamp_not_bytes(self):
        stamp = "codegraph:oversize:1048577"
        expected = hashlib.sha256(stamp.encode("utf-8")).hexdigest()
        self.assertNotEqual(expected, hashlib.sha256(b"x" * 1048577).hexdigest())
        self.assertEqual(dais_baseline.codegraph_content_hash(1048577, b"x" * 1048577), expected)

    def test_boundary_is_inclusive(self):
        data = b"y" * (1024 * 1024)
        self.assertEqual(
            dais_baseline.codegraph_content_hash(len(data), data),
            hashlib.sha256(data).hexdigest(),
        )


class FreezeTest(unittest.TestCase):
    def test_freeze_unicode_and_spaces(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_mini_corpus(root)
            manifest = dais_baseline.freeze_corpus(root, ["dir with space/uni-λ-файл.go", "plain.go"])
            self.assertEqual(len(manifest["files"]), 2)
            by_path = {f["path"]: f for f in manifest["files"]}
            self.assertIn(FILE_A, by_path)
            self.assertEqual(by_path[FILE_A]["sha256"], hashlib.sha256(CONTENT_A).hexdigest())
            self.assertEqual(by_path[FILE_A]["bytes"], len(CONTENT_A))
            # frozen copy is byte-identical
            frozen = EXPERIMENT_DIR / "frozen-qual" / FILE_A
            if frozen.exists():  # freeze_corpus writes under its own out dir when given
                self.assertEqual(frozen.read_bytes(), CONTENT_A)

    def test_freeze_wrong_path_is_a_loud_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_mini_corpus(root)
            with self.assertRaises(dais_baseline.FreezeError) as ctx:
                dais_baseline.freeze_corpus(root, ["plain.go", "no/such/file.go"])
            self.assertIn("no/such/file.go", str(ctx.exception))


class DriftTest(unittest.TestCase):
    """Source hash mismatch between a frozen CodeGraph files row and the
    corpus bytes must be REPORTED as drift, never silently accepted."""

    def test_hash_mismatch_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "cg.db"
            db = sqlite3.connect(db_path)
            db.execute(
                "CREATE TABLE files (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL,"
                " language TEXT, size INTEGER, modified_at TEXT, indexed_at TEXT,"
                " node_count INTEGER, errors TEXT, generated INTEGER)"
            )
            real = hashlib.sha256(CONTENT_B).hexdigest()
            db.execute(
                "INSERT INTO files (path, content_hash, language, size) VALUES (?,?,?,?)",
                ("plain.go", real, "Go", len(CONTENT_B)),
            )
            db.execute(
                "INSERT INTO files (path, content_hash, language, size) VALUES (?,?,?,?)",
                ("stale.go", "0" * 64, "Go", 10),
            )
            db.commit()
            db.close()
            corpus_hashes = {"plain.go": real, "stale.go": hashlib.sha256(b"new bytes").hexdigest()}
            verdict = dais_baseline.verify_codegraph_coverage(db_path, corpus_hashes)
            self.assertEqual(verdict["matched"], ["plain.go"])
            # superseded 2026-10-19: the brief demands an ADDRESSED residual with the
            # actual differences, so drifted entries carry both hashes, not bare paths
            self.assertEqual(verdict["drifted"], [{"path": "stale.go",
                                                   "codegraph_content_hash": "0" * 64,
                                                   "corpus_sha256": hashlib.sha256(b"new bytes").hexdigest()}])
            self.assertEqual(verdict["missing_from_codegraph"], [])


@unittest.skipIf(not FOSSIL_EXE.exists(), "fossil.exe missing is a HARNESS defect, reported by the runner")
class MiniEndToEndTest(unittest.TestCase):
    """Real reader qualification on the deterministic mini fixture:
    positive token found at the right lines, absent token returns zero,
    wrong revision is an EXPECTED_FAIL, status accepts the right revision."""

    @classmethod
    def setUpClass(cls):
        if not DAIS_CI.exists():
            raise AssertionError(
                f"HARNESS: {DAIS_CI} missing — build the candidate first "
                "(go build -o experiments/2026-10-19_dais-m0b-baseline/dist/dais-ci.exe ./cmd/dais-ci)"
            )
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        corpus = base / "corpus"
        corpus.mkdir()
        build_mini_corpus(corpus)
        manifest = dais_baseline.freeze_corpus(corpus, [FILE_A, FILE_B], out=base / "frozen")
        scratch = base / "scratch"
        revision = dais_baseline.build_fossil_fixture(
            fossil_exe=FOSSIL_EXE, corpus_dir=base / "frozen", scratch=scratch,
            files=[f["path"] for f in manifest["files"]],
        )
        cls.revision = revision
        cls.index_root = base / "dais-index"
        cls.index_result = dais_baseline.run_dais_index(
            dais_ci=DAIS_CI, fossil_exe=FOSSIL_EXE, repository=scratch / "corpus.fsl",
            fossil_home=base / "fossil-home", ref=revision, index_root=cls.index_root,
            repository_id="m0b-qual", log_dir=base / "logs",
        )
        cls.base = base

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_index_reported_revision_and_files(self):
        self.assertEqual(self.index_result["snapshot"]["Revision"], self.revision)
        self.assertEqual(self.index_result["snapshot"]["IndexedFiles"], 2)

    def test_positive_token_found_and_precise(self):
        response = dais_baseline.run_dais_search(
            dais_ci=DAIS_CI, index_root=self.index_root, repository_id="m0b-qual",
            kind="code", query=TOKEN, expect_revision=self.revision,
        )
        self.assertTrue(response["Complete"])
        self.assertGreaterEqual(len(response["Results"]), 2)
        # precision: every reported (path, line) contains the token in the frozen bytes
        frozen = self.base / "frozen"
        for match in response["Results"]:
            line = frozen.joinpath(match["Path"]).read_text("utf-8").split("\n")[match["Line"] - 1]
            self.assertIn(TOKEN, line)

    def test_absent_token_returns_zero(self):
        response = dais_baseline.run_dais_search(
            dais_ci=DAIS_CI, index_root=self.index_root, repository_id="m0b-qual",
            kind="code", query=ABSENT_TOKEN, expect_revision=self.revision,
        )
        self.assertEqual(response["Results"], [])
        self.assertTrue(response["Complete"])

    def test_wrong_revision_is_expected_fail(self):
        wrong = "f" * 40
        with self.assertRaises(dais_baseline.DaisError):
            dais_baseline.run_dais_search(
                dais_ci=DAIS_CI, index_root=self.index_root, repository_id="m0b-qual",
                kind="code", query=TOKEN, expect_revision=wrong,
            )

    def test_status_accepts_right_revision(self):
        snapshot = dais_baseline.run_dais_status(
            dais_ci=DAIS_CI, index_root=self.index_root, repository_id="m0b-qual",
            expect_revision=self.revision,
        )
        self.assertEqual(snapshot["Revision"], self.revision)


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# M0b continuation (2026-10-20) — named tests for the repaired reader.
# Written BEFORE the repair (test-first): each one must fail on the
# unrepaired reader and pass after the minimal repair. Nothing here is
# weakened to fit the current output — every assertion is derived from the
# requirement (frozen bytes, exact sets, distinguishable controls).
# ---------------------------------------------------------------------------


def _report_fixture(run_id):
    """A complete report payload — render_markdown() reads every one of these."""
    return {
        "run_id": run_id,
        "generated_utc": "2026-10-20T00:00:00Z",
        "corpus": {
            "definition": "test corpus",
            "git_head": "0" * 40,
            "dirty_entries": 0,
            "manifest": {"files": [{"path": "a.go"}], "manifest_sha256": "0" * 64},
        },
        "tools": {"go_version": "go version go1.25.4 windows/amd64"},
        "codegraph": {
            "frozen_db_sha256": "0" * 64,
            "frozen_db_bytes": 1,
            "measurements": [{"query": "q", "p50_ms": 1.0, "p95_ms": 2.0}],
            "controls": {},
        },
        "dais": {
            "binary_sha256": "0" * 64,
            "binary_bytes": 1,
            "index": {
                "wall_seconds": 1.0,
                "peak_rss_bytes": 1,
                "rss_method": "test",
                "snapshot": {"IndexedFiles": 1},
            },
            "searches": [
                {"query": "q", "kind": "code", "results": 0, "p50_ms": 1.0,
                 "p95_ms": 2.0, "warmup": 1, "runs": 1}
            ],
            "controls": {},
        },
        "parity": {
            "byte_identity": {"matched": [], "drifted": [], "missing_from_codegraph": []},
            "semantics": [{"pair": "p", "comparable": False, "note": "n"}],
        },
        "criteria": [{"id": "c", "verdict": "PASS", "note": "n"}],
        "not_measured": [],
        "limits": [],
        "replay_command": "python x.py run",
    }


class CorpusScopeTest(unittest.TestCase):
    """A corpus-scoped structural query must not return rows from outside the
    pinned corpus. The parent read-only audit found the corpus query carried
    no path scope, so 3 of 4 returned rows were foreign to the corpus."""

    def _synthetic_db(self, tmp):
        db_path = Path(tmp) / "cg.db"
        db = sqlite3.connect(db_path)
        db.execute("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT,"
                   " file_path TEXT, start_line INTEGER)")
        db.execute("INSERT INTO nodes VALUES ('a','struct','Adapter',?,75)",
                   ("packages/dais-code-intelligence/internal/search/adapter.go",))
        db.execute("INSERT INTO nodes VALUES ('b','interface','Adapter',?,6)",
                   ("packages/enterprise/src/core/storage.ts",))
        db.commit()
        db.close()
        return db_path

    def test_corpus_scoped_symbol_query_excludes_outside_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = self._synthetic_db(tmp)
            spec = dais_baseline.query_by_label("symbol-exact-corpus")
            self.assertEqual(spec["scope"], "corpus")
            db = sqlite3.connect(db_path)
            rows = db.execute(spec["sql"], spec["parameters"]).fetchall()
            db.close()
            self.assertEqual([row[0] for row in rows], ["a"])

    def test_global_control_query_is_deliberately_global(self):
        spec = dais_baseline.query_by_label("symbol-exact-ts-control")
        self.assertEqual(spec["scope"], "global")

    def test_every_corpus_scoped_query_declares_a_path_predicate(self):
        for spec in dais_baseline.STRUCTURAL_QUERIES:
            self.assertIn(spec["scope"], ("corpus", "global"))
            if spec["scope"] == "corpus":
                self.assertIn("file_path LIKE ?", spec["sql"])


class ResultSetComparisonTest(unittest.TestCase):
    """The harness must compare exact SETS. A count-only check accepts a
    subset or an empty set, which is how the retained-evidence audit was
    able to pass a mutated expected set."""

    def test_identical_sets_are_equal(self):
        verdict = dais_baseline.compare_result_sets(
            [("a.go", 1), ("b.go", 2)], [("b.go", 2), ("a.go", 1)])
        self.assertTrue(verdict["equal"])
        self.assertEqual(verdict["missing"], [])
        self.assertEqual(verdict["extra"], [])

    def test_subset_is_rejected(self):
        verdict = dais_baseline.compare_result_sets([("a.go", 1), ("b.go", 2)], [("a.go", 1)])
        self.assertFalse(verdict["equal"])
        self.assertEqual(verdict["missing"], [("b.go", 2)])

    def test_empty_result_is_rejected(self):
        verdict = dais_baseline.compare_result_sets([("a.go", 1)], [])
        self.assertFalse(verdict["equal"])
        self.assertEqual(verdict["missing"], [("a.go", 1)])

    def test_extra_row_is_rejected(self):
        verdict = dais_baseline.compare_result_sets([("a.go", 1)], [("a.go", 1), ("c.go", 9)])
        self.assertFalse(verdict["equal"])
        self.assertEqual(verdict["extra"], [("c.go", 9)])


class ExpectedMatchesFromBytesTest(unittest.TestCase):
    """Expected sets are computed from the FROZEN corpus bytes — never from
    the backend's own output. The matching semantics are read from the
    owning code (internal/search/adapter.go:510,512 — query.Substring with
    Content: true, CaseSensitive: true)."""

    def test_expected_text_matches_are_computed_from_the_frozen_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_mini_corpus(root)
            hits = dais_baseline.expected_text_matches(root, [FILE_A, FILE_B], TOKEN)
            self.assertEqual(hits, {(FILE_A, 3), (FILE_A, 4), (FILE_B, 3)})

    def test_expected_text_matches_keep_unicode_and_space_paths_verbatim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_mini_corpus(root)
            hits = dais_baseline.expected_text_matches(root, [FILE_A], TOKEN)
            self.assertTrue(all(path == FILE_A for path, _ in hits))
            self.assertIn("λ", FILE_A)

    def test_absent_token_has_no_expected_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_mini_corpus(root)
            hits = dais_baseline.expected_text_matches(root, [FILE_A, FILE_B], ABSENT_TOKEN)
            self.assertEqual(hits, set())

    def test_expected_filename_matches_come_from_the_corpus_path_set(self):
        hits = dais_baseline.expected_filename_matches(
            ["a/internal/search/adapter.go", "a/internal/search/adapter_test.go"], "adapter.go")
        self.assertEqual(hits, {"a/internal/search/adapter.go"})


class RevisionControlTest(unittest.TestCase):
    """The wrong-revision control must distinguish a revision refusal from any
    other failure. The old reader recorded EVERY DaisError as
    'EXPECTED_FAIL confirmed (exit 1)', so it could not tell a stale-index
    refusal from an unrelated crash."""

    def test_revision_refusal_is_expected_fail(self):
        verdict = dais_baseline.classify_revision_failure(
            "search revision mismatch: got aaa, expected bbb")
        self.assertTrue(verdict.startswith("EXPECTED_FAIL"))

    def test_unrelated_failure_is_not_expected_fail(self):
        verdict = dais_baseline.classify_revision_failure(
            "kind must be code, regex, filename or symbol_text")
        self.assertFalse(verdict.startswith("EXPECTED_FAIL"))

    def test_empty_stderr_is_not_expected_fail(self):
        self.assertFalse(dais_baseline.classify_revision_failure("").startswith("EXPECTED_FAIL"))


class ReportAliasTest(unittest.TestCase):
    """A replay must not overwrite the historical report alias."""

    def test_write_report_writes_a_distinct_name_and_keeps_the_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            alias_dir = Path(tmp)
            (alias_dir / "report.json").write_text("HISTORICAL", encoding="utf-8")
            (alias_dir / "REPORT.md").write_text("HISTORICAL MD", encoding="utf-8")
            run_dir = alias_dir / "run-x"
            run_dir.mkdir()
            data = _report_fixture("20260101T000000Z_test")
            dais_baseline.write_report(run_dir, data, alias_dir=alias_dir)
            self.assertEqual((alias_dir / "report.json").read_text(encoding="utf-8"), "HISTORICAL")
            self.assertEqual((alias_dir / "REPORT.md").read_text(encoding="utf-8"), "HISTORICAL MD")
            self.assertTrue((alias_dir / "report-20260101T000000Z_test.json").exists())
            self.assertTrue((alias_dir / "REPORT-20260101T000000Z_test.md").exists())
