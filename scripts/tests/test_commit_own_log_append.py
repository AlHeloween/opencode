"""t131: a robot's own log row must not sweep the shared progress log.

Fixture (the brief's shape): the worktree holds another lane's UNCOMMITTED rows
AND HEAD holds a row the caller never saw.

- T1 (--append happy path): the commit carries ONLY the caller's row; the unseen
  HEAD row survives; the foreign worktree rows stay worktree-only (and the
  worktree file itself is never rewritten by the route).
- T2 (whole-file log commit): refused, nothing committed. The current route
  stages the worktree copy whole, so it deletes the unseen HEAD row and carries
  the foreign rows (the t130 shape).
- T3 (patch with a deletion): refused, nothing committed.
- T4 (CRLF patch file): refused LOUDLY, naming line endings as the cause
  (root cause R1: on this host `git apply --cached` rejects CRLF patches even
  with zero HEAD movement; LF applies, CRLF fails, path form irrelevant).

RED on the current script: --append does not exist (T1 exits 2), the whole-file
route commits the sweep (T2), the deletion patch applies (T3), the CRLF refusal
names no cause (T4).
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

LOG = "_progress_log.md"
BASE = ("# Progress Log\n\n" + "".join(f"row-{i:02d}\n" for i in range(1, 31))).encode()
BOM = b"\xef\xbb\xbf"
OWN = b"\n## [2026-10-21] t131 caller row\n\ncaller body\n"
PEER = b"\n## [2026-10-21] t131 peer row (caller never saw it)\n\npeer body\n"
FOREIGN = b"\n## foreign lane uncommitted\n\nforeign body\n"


def _git(repo: Path, *args: str, env=None, inp: bytes | None = None) -> str:
    proc = subprocess.run(["git", *args], cwd=repo, capture_output=True, env=env or os.environ,
                          text=inp is None, input=inp)
    if proc.returncode != 0:
        err = proc.stderr
        err = err.decode(errors="replace") if isinstance(err, bytes) else err
        raise AssertionError(f"git {' '.join(args)} failed ({proc.returncode}): {(err or '').strip()}")
    out = proc.stdout
    return out.decode() if isinstance(out, bytes) else out


def _repo() -> Path:
    base = Path(tempfile.mkdtemp(prefix="t131log-"))
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


def _plumbing_commit(repo: Path, path: str, blob: bytes, msg: str) -> str:
    """Commit a blob for path without touching the worktree (a peer lane's commit)."""
    h = _git(repo, "hash-object", "-w", "--stdin", env=dict(os.environ), inp=blob).strip()
    head = _git(repo, "rev-parse", "HEAD").strip()
    branch = _git(repo, "symbolic-ref", "--short", "HEAD").strip()
    tidx = str(repo / ".git" / "tidx-peer")
    pe = dict(os.environ, GIT_INDEX_FILE=tidx)
    _git(repo, "read-tree", head, env=pe)
    _git(repo, "update-index", "--add", "--cacheinfo", f"100644,{h},{path}", env=pe)
    tree = _git(repo, "write-tree", env=pe).strip()
    new = _git(repo, "commit-tree", tree, "-p", head, "-m", msg, env=pe).strip()
    _git(repo, "update-ref", f"refs/heads/{branch}", new, head)
    try:
        os.remove(tidx)
    except OSError:
        pass
    return new


def _fixture() -> tuple[Path, Path]:
    """Base + peer row in HEAD; worktree = base + FOREIGN + OWN (no PEER)."""
    repo = _repo()
    _git(repo, "hash-object", "-w", "--stdin", env=dict(os.environ), inp=BOM + BASE)
    _plumbing_commit(repo, LOG, BOM + BASE, "base log")
    _plumbing_commit(repo, LOG, BOM + BASE + PEER, "peer row")
    (repo / LOG).write_bytes(BOM + BASE + FOREIGN + OWN)
    rowfile = repo / "own-row.md"
    rowfile.write_bytes(OWN)
    return repo, rowfile


def _run_main(repo: Path, argv: list[str]) -> tuple[int, str, str]:
    cwd = os.getcwd()
    os.chdir(repo)
    out, err = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            try:
                rc = commit_own.main(argv)
            except SystemExit as exc:
                rc = exc.code if isinstance(exc.code, int) else 2
    finally:
        os.chdir(cwd)
    return rc, out.getvalue(), err.getvalue()


def _head_log(repo: Path) -> bytes:
    return subprocess.run(["git", "show", f"HEAD:{LOG}"], cwd=repo,
                          capture_output=True, env=dict(os.environ)).stdout


def test_append_carries_only_caller_row() -> None:
    repo, rowfile = _fixture()
    before = _git(repo, "rev-list", "--count", "HEAD").strip()
    rc, _out, err = _run_main(repo, ["--session", "t131a", "-m", "caller row",
                                     "--append", f"{LOG}={rowfile}"])
    assert rc == 0, f"--append must commit (rc=0), got rc={rc}: {err!r}"
    assert _git(repo, "rev-list", "--count", "HEAD").strip() != before
    head = _head_log(repo)
    assert head.startswith(BOM) and head.count(BOM) == 1, "single leading BOM preserved"
    assert b"t131 caller row" in head, "caller's row committed"
    assert b"t131 peer row" in head, "unseen HEAD row survives"
    assert b"foreign lane" not in head, "foreign worktree rows stay worktree-only"
    wt = (repo / LOG).read_bytes()
    assert b"foreign lane" in wt and b"t131 caller row" in wt, "worktree left untouched"
    assert b"t131 peer row" not in wt, "route never rewrites the worktree copy"


def test_whole_file_log_commit_refused() -> None:
    repo, _rowfile = _fixture()
    before = _git(repo, "rev-parse", "HEAD").strip()
    rc, _out, err = _run_main(repo, ["--session", "t131b", "-m", "whole log", "--", LOG])
    assert rc != 0, "whole-file staging of the shared log must be refused"
    assert _git(repo, "rev-parse", "HEAD").strip() == before, "nothing committed"
    assert "--append" in err, f"refusal must name --append, got: {err!r}"
    assert b"t131 peer row" in _head_log(repo)


def test_patch_with_deletion_refused() -> None:
    repo, _rowfile = _fixture()
    patch = repo / "del.patch"
    patch.write_bytes(
        b"diff --git a/_progress_log.md b/_progress_log.md\n"
        b"--- a/_progress_log.md\n"
        b"+++ b/_progress_log.md\n"
        b"@@ -15,3 +15,2 @@\n"
        b" row-14\n"
        b"-row-15\n"
        b" row-16\n"
    )
    before = _git(repo, "rev-parse", "HEAD").strip()
    rc, _out, err = _run_main(repo, ["--session", "t131c", "-m", "del patch",
                                     "--shared", LOG, "--apply-patch", str(patch), "--", LOG])
    assert rc != 0, f"patch deleting a committed line must be refused, got rc={rc}: {err!r}"
    assert _git(repo, "rev-parse", "HEAD").strip() == before, "nothing committed"


def test_crlf_patch_refused_naming_cause() -> None:
    repo, rowfile = _fixture()
    diff = _git(repo, "diff", "-U3", "HEAD", "--", LOG)
    patch = repo / "own-crlf.patch"
    patch.write_bytes(diff.encode("utf-8").replace(b"\n", b"\r\n"))
    before = _git(repo, "rev-parse", "HEAD").strip()
    rc, _out, err = _run_main(repo, ["--session", "t131d", "-m", "crlf patch",
                                     "--shared", LOG, "--apply-patch", str(patch), "--", LOG])
    assert rc != 0, "CRLF patch cannot apply and must be refused"
    assert _git(repo, "rev-parse", "HEAD").strip() == before, "nothing committed"
    assert "--append" in err, f"refusal must route to --append, got: {err!r}"
