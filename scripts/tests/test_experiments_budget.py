"""The disk guard must be able to FAIL -- a check that cannot fail is a caution.

Two receipts, both on fixtures built inside a temp dir (never on the repo):

1. ``experiments_budget.py`` exits NON-ZERO when the tree is over budget, and
   zero when it is within it. A guard whose "fail" path was never executed is
   a rule written in prose.

2. The measurement never follows a junction: a tree whose junction points at a
   64 MB directory measures as the LINK's own content, not the target's. This is
   the shape that wrote 72.4 GB on 2026-10-21 (CPython #104046, #142155).

Run:  python -m pytest scripts/tests/test_experiments_budget.py -q
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"


def _load(name: str):
    """Loaded by PATH, not by import: the module sits next to the scripts."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / (name + ".py"))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


budget = _load("experiments_budget")
tree = _load("experiments_tree")


def _write(path: Path, size: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def test_budget_fails_over_budget_and_passes_under_it():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "experiments"
        _write(root / "heavy" / "blob.bin", 3 * 1024 * 1024)
        _write(root / "light" / "note.md", 10)

        argv = ["--root", str(root), "--max-total-gb", "0.001"]
        assert budget.main(argv) == 1, "the guard must FAIL over budget"

        argv = ["--root", str(root), "--max-total-gb", "10", "--max-folder-gb", "10"]
        assert budget.main(argv) == 0, "the guard must PASS within budget"

        argv = ["--root", str(root), "--max-folder-gb", "0.001"]
        assert budget.main(argv) == 1, "the guard must FAIL when ONE folder is over budget"


def test_budget_reports_the_folder_that_is_over_budget():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "experiments"
        _write(root / "heavy" / "blob.bin", 3 * 1024 * 1024)
        argv = ["--root", str(root), "--max-folder-gb", "0.001", "--json"]
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "experiments_budget.py")] + argv,
            capture_output=True, text=True,
        )
        assert proc.returncode == 1
        assert "heavy" in proc.stdout, "the report must name the offender"
        assert "OVER-BUDGET" in proc.stdout


def test_measurement_does_not_follow_a_junction():
    """The 72 GB shape: a junction's TARGET bytes must not count as ours."""
    if os.name != "nt":
        return
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        target = base / "target"
        _write(target / "big.bin", 8 * 1024 * 1024)
        root = base / "experiments"
        (root / "sub").mkdir(parents=True)
        _write(root / "sub" / "real.bin", 16)

        proc = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(root / "sub" / "linked"), str(target)],
            capture_output=True, text=True,
        )
        assert proc.returncode == 0, "the fixture needs a real junction: %s" % proc.stderr

        entry, files = tree.walk(str(root))
        names = {rel for rel, _path, _size in files}
        assert "sub" + os.sep + "real.bin" in names
        assert not any("big.bin" in name for name in names), \
            "the walker followed the junction into its target"

        reparses = [item for item in entry.walk() if item.reparse]
        assert len(reparses) == 1, "the junction must be seen as a LEAF"
        assert reparses[0].total_bytes == 0, "a junction carries no bytes of its own"


def test_cleanup_never_follows_a_junction():
    """Deleting a tree that CONTAINS a junction removes the LINK, not the target."""
    if os.name != "nt":
        return
    cleanup = _load("experiments_cleanup")
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        target = base / "target"
        _write(target / "keep.bin", 4 * 1024 * 1024)
        root = base / "experiments"
        (root / "sub").mkdir(parents=True)
        _write(root / "sub" / "real.bin", 16)
        proc = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(root / "sub" / "linked"), str(target)],
            capture_output=True, text=True,
        )
        assert proc.returncode == 0, "the fixture needs a real junction: %s" % proc.stderr

        removed, junctions = cleanup.remove_tree_safely(str(root / "sub"))

        assert junctions, "the junction must be reported as unlinked"
        assert target.exists(), "the junction TARGET must survive the deletion"
        assert (target / "keep.bin").exists(), "the target's CONTENT must survive"
        assert not (root / "sub").exists(), "the copied subtree must be gone"


def test_copy_refuses_a_prediction_over_budget():
    """A forecast must GATE the copy, not follow it.

    Owner, 2026-10-22: «Короче схалтурил и выполнил действие без проверки и
    прогноза ожидаемого результата.» -- the 72 GB copy was an action taken
    without a predicted size. So the copy tool must PREDICT first and REFUSE
    when the prediction is over budget, having written nothing.
    """
    copy = _load("copy_tree_safe")
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        src = base / "src"
        dst = base / "dst"
        _write(src / "big.bin", 3 * 1024 * 1024)

        # 3 MB against a 1 MB ceiling: the forecast is over budget.
        code = copy.main([str(src), str(dst), "--max-gb", str(1 / (1024 ** 2))])
        assert code == 1, "a copy over the predicted budget must be REFUSED"
        assert not dst.exists(), "the refused copy must not have written anything"

        # The same tree under a ceiling it fits: the copy proceeds.
        code = copy.main([str(src), str(dst), "--max-gb", "10"])
        assert code == 0, "a copy within the predicted budget must proceed"
        assert (dst / "big.bin").exists(), "the permitted copy must have written the file"


def test_copy_dry_run_predicts_without_writing():
    """The forecast is available BEFORE the action, and writes nothing."""
    copy = _load("copy_tree_safe")
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        src = base / "src"
        dst = base / "dst"
        _write(src / "blob.bin", 2 * 1024 * 1024)
        code = copy.main([str(src), str(dst), "--dry-run"])
        assert code == 0
        assert not dst.exists(), "a dry run must not write anything"


def test_copy_does_not_copy_a_junction_target():
    """The forecast must not count a junction's target: it is not ours to copy."""
    if os.name != "nt":
        return
    copy = _load("copy_tree_safe")
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        target = base / "target"
        _write(target / "huge.bin", 8 * 1024 * 1024)
        src = base / "src"
        (src / "sub").mkdir(parents=True)
        _write(src / "sub" / "real.bin", 16)
        proc = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(src / "sub" / "linked"), str(target)],
            capture_output=True, text=True,
        )
        assert proc.returncode == 0, "the fixture needs a real junction: %s" % proc.stderr

        dst = base / "dst"
        code = copy.main([str(src), str(dst), "--max-gb", "0", "--mode", "skip"])
        assert code == 0
        assert (dst / "sub" / "real.bin").exists(), "the real file must be copied"
        assert not (dst / "sub" / "linked").exists(), \
            "the junction must not be materialized as a copy of its target"
        assert target.exists(), "the junction target must survive the copy"

        # In link mode the junction is RECREATED (the target is shared, not
        # copied) -- so the target's file is reachable, but no target BYTES were
        # copied: the projection must not count them.
        dst2 = base / "dst2"
        code = copy.main([str(src), str(dst2), "--max-gb", "0", "--mode", "link"])
        assert code == 0
        copied = sum(size for _rel, _path, size in tree.walk(str(dst2))[1])
        assert copied < 1024 * 1024, \
            "the copy wrote the junction target's bytes (%d) instead of linking it" % copied
