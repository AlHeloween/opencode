"""commit_own must not leave the SHARED index staging the deletion of what it committed.

Reproducer (measured 2026-10-20): a commit whose pathspec was a DIRECTORY
(`experiments_history/2026-10-20_sv-axis-falsifier`) landed correctly, and then the
T5 sync left the shared index with `D` + `??` for exactly the four files that
commit had just added. The next plain `git commit` would have deleted them from
the repository.

Cause: `read_head_entries` called `git ls-tree HEAD -- <dir>` without `-r`, so a
directory pathspec expanded to nothing; the sync's drop branch then read "this path
is not in HEAD" and removed the index entry. `read_index_entries` uses `ls-files`,
which recurses — the two sides disagreed and the wrong rule won.

The test asserts the END state that matters: after commit_own returns, the shared
index must still know the committed files, and `git status --short` must be clean.
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Loaded by PATH, not by import: the module sits next to the scripts, not on
# sys.path, and a static `import commit_own` is a false red for the analyser.
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
    """The repo is tmp/repo and the hook lives OUTSIDE it.

    A hook directory inside the work tree would show up as `??` in the very
    `git status` this test asserts on — the fixture would be the dirt it hunts.
    """
    base = Path(tmp)
    repo = base / "repo"
    repo.mkdir()
    hooks = base / "hooks"
    hooks.mkdir()
    hook = hooks / "pre-commit"
    hook.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "t")
    _git(repo, "config", "core.hooksPath", str(hooks))
    _git(repo, "commit", "-q", "--allow-empty", "-m", "base")
    return repo


def test_directory_pathspec_leaves_the_shared_index_intact() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = _repo_with_noop_hook(tmp)
        (repo / "pkg").mkdir()
        (repo / "pkg" / "note.md").write_text("hello\n", encoding="utf-8")

        cwd = os.getcwd()
        os.chdir(repo)
        try:
            rc = commit_own.main(["--session", "t1", "-m", "add the package", "--", "pkg"])
        finally:
            os.chdir(cwd)

        assert rc == 0, "commit_own refused the commit"
        assert "pkg/note.md" in _git(repo, "ls-tree", "-r", "HEAD"), "the file is not in the commit"
        status = _git(repo, "status", "--short")
        assert status.strip() == "", f"the shared index was left dirty: {status!r}"


def test_file_pathspec_still_commits_and_settles() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        repo = _repo_with_noop_hook(tmp)
        (repo / "one.md").write_text("one\n", encoding="utf-8")

        cwd = os.getcwd()
        os.chdir(repo)
        try:
            rc = commit_own.main(["--session", "t2", "-m", "add one", "--", "one.md"])
        finally:
            os.chdir(cwd)

        assert rc == 0, "commit_own refused the commit"
        assert "one.md" in _git(repo, "ls-tree", "-r", "HEAD")
        assert _git(repo, "status", "--short").strip() == ""
