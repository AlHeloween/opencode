"""t112: shared-index trap — exit invariant and loud contention failure.

E1 (single writer): after commit_own returns, the shared index entries for the
committed paths must equal HEAD (git diff --cached empty for those paths) and
no index.lock may remain.

E2 (stale/crashed-writer lock present): the commit itself still lands (private
index), but the T5 sync cannot touch the locked shared index. It must NOT
return 0 with a warn and a phantom staged entry (the trap of t105/t107/20:05).
It must fail loudly: non-zero exit with a named message, commit SHA still on
stdout so the caller knows the commit stands.
"""
from __future__ import annotations

import importlib.util
import io
import os
import subprocess
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("commit_own", ROOT / "scripts" / "commit_own.py")
assert _spec is not None and _spec.loader is not None
commit_own = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(commit_own)


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed ({proc.returncode}): {proc.stderr.strip()}")
    return proc.stdout


def _repo_with_noop_hook(tmp: str) -> Path:
    base = Path(tmp)
    repo = base / "repo"
    repo.mkdir()
    hooks = base / "hooks"
    hooks.mkdir()
    (hooks / "pre-commit").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "t")
    _git(repo, "config", "core.hooksPath", str(hooks))
    _git(repo, "commit", "-q", "--allow-empty", "-m", "base")
    return repo


def _run_main(repo: Path, argv: list[str]) -> tuple[int, str, str]:
    cwd = os.getcwd()
    os.chdir(repo)
    out, err = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            rc = commit_own.main(argv)
    finally:
        os.chdir(cwd)
    return rc, out.getvalue(), err.getvalue()


def test_single_writer_leaves_no_trap() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = _repo_with_noop_hook(tmp)
        (repo / "one.md").write_text("one\n", encoding="utf-8")
        rc, _out, _err = _run_main(repo, ["--session", "t112e1", "-m", "e1", "--", "one.md"])
        assert rc == 0, "clean commit must succeed"
        assert not (repo / ".git" / "index.lock").exists(), "no lock may remain after a clean run"
        cached = _git(repo, "diff", "--cached", "--name-status", "--", "one.md")
        assert cached.strip() == "", f"shared index must equal HEAD, got: {cached!r}"
        assert _git(repo, "status", "--short").strip() == ""


def test_locked_shared_index_fails_loudly_not_silently() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = _repo_with_noop_hook(tmp)
        (repo / "one.md").write_text("one\n", encoding="utf-8")
        (repo / ".git" / "index.lock").write_bytes(b"")
        rc, out, err = _run_main(repo, ["--session", "t112e2", "-m", "e2", "--", "one.md"])
        # The commit itself lands through the private index — the SHA is the receipt.
        log = _git(repo, "log", "--oneline", "-1")
        assert "e2" in log, "commit must stand even when the sync cannot run"
        assert out.strip() != "", "SHA must still be printed so the caller knows the commit"
        # ... but the exit must NOT be a silent 0 with a phantom staged entry.
        assert rc != 0, f"locked sync must fail loudly (rc!=0), got rc=0 with err={err!r}"
        assert "shared-index" in err and "index.lock" in err, f"named message required, got: {err!r}"
