#!/usr/bin/env python3
"""Commit exactly the given paths through a private git index.

Route for robots sharing one checkout (t66): every session commits through
``.git/index-<session>`` seeded from HEAD, so a commit can never sweep another
agent's staged work out of the shared ``.git/index``.

Usage:
    python scripts/commit_own.py --session <id> -m <msg> [--shared <path> ... --apply-patch <file> ...] [--append <path>=<rowfile> ...] [-- <paths...>]

    One line for a progress-log row (t131: the ONLY log route -- never stage
    the log whole, never hand-build a patch for it):
    python scripts/commit_own.py --session <id> -m <msg> --append _progress_log.md=<row-file>
    where <row-file> holds the entry text (LF bytes, no BOM), and the same call
    may also carry code paths after `--`.
The shared ``.git/index`` is opened by this script in exactly two places, both
limited to the caller's own paths: the T5 CAS-sync (``update-index`` on entries
proven unchanged since capture, warnings otherwise, never forced) and the test
seam ``COMMIT_OWN_RACE_HOOK`` (a shell command run after ``write-tree`` and before
``update-ref`` on the first attempt only), which runs with ``GIT_INDEX_FILE``
scrubbed so a simulated peer commits via the shared index like a real peer
would. Every other git command that touches an index runs with
``GIT_INDEX_FILE=<priv>``.

Exit codes: 0 committed and shared index in sync (new sha on stdout);
2 usage/refusal (bad session id, detached or unborn HEAD, bad pathspec,
bad/non-applying/out-of-scope patch, bad --append row file, whole-file staging
of an append-only shared file, staged deletions or foreign hunks on a shared
file, nothing staged); 1 operational failure
(hook failed, ref update still racing after --retries, git errors, or the T5
shared-index sync could not run to completion -- the commit itself still stands
and its sha is printed, but the exit is non-zero with a named shared-index
message instead of a silent warn-and-trap).
"""

import argparse
import os
import re
import subprocess
import sys
import time

SESSION_RE = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
IMPLICIT_APPEND_ONLY = {"_progress_log.md"}


def run_git_bytes(args, cwd, env, inp=None):
    """git with binary pipes: blob surgery must never decode."""
    proc = subprocess.run(["git"] + args, cwd=cwd, env=env, capture_output=True, input=inp)
    if proc.returncode != 0:
        raise RuntimeError(
            "git %s failed (%d): %s" % (" ".join(args), proc.returncode, (proc.stderr or b"").decode(errors="replace").strip())
        )
    return proc.stdout


def head_blob(cwd, env, head, path):
    """HEAD bytes of path, or None when the path is not in HEAD."""
    proc = subprocess.run(
        ["git", "cat-file", "-p", "%s:%s" % (head, path)],
        cwd=cwd, env=env, capture_output=True,
    )
    if proc.returncode != 0:
        return None
    return proc.stdout


def head_blob_mode(cwd, env, head, path):
    """Blob mode of path in HEAD (default 100644 when absent)."""
    proc = subprocess.run(
        ["git", "ls-tree", head, "--", path], cwd=cwd, env=env, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError("git ls-tree failed (%d)" % proc.returncode)
    for line in (proc.stdout or "").splitlines():
        meta, _, _ = line.partition("\t")
        parts = meta.split(" ")
        if len(parts) >= 2 and parts[1] == "blob":
            return parts[0]
    return "100644"


def read_row_lines(rowfile):
    """Caller-supplied row text: LF-only UTF-8 lines, no BOM, non-empty."""
    try:
        with open(rowfile, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise RuntimeError("cannot read --append row file %r (%s)" % (rowfile, exc))
    if data.startswith(b"\xef\xbb\xbf"):
        raise RuntimeError("--append row file %r carries a BOM (write plain UTF-8)" % rowfile)
    if b"\r" in data:
        raise RuntimeError("--append row file %r has CR/CRLF line endings (write LF only)" % rowfile)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise RuntimeError("--append row file %r is not UTF-8" % rowfile)
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if not lines or all(line == "" for line in lines):
        raise RuntimeError("--append row file %r holds no row (refusing empty append)" % rowfile)
    return lines


def parse_unified_changes(text):
    """path -> ([added], [deleted]) for a unified diff or patch file.

    Tracks `+++ b/<path>` headers; skips `---`/`+++` and `\\ No newline` markers.
    """
    added = {}
    deleted = {}
    cur = None
    for line in text.splitlines():
        if line.startswith("+++ "):
            path = line[4:].strip()
            if path.startswith("b/"):
                path = path[2:]
            cur = None if path == "/dev/null" else path
            continue
        if line.startswith("--- ") or line.startswith("diff --git "):
            continue
        if line.startswith("\\ "):
            continue
        if cur is None:
            continue
        if line.startswith("+"):
            added.setdefault(cur, []).append(line[1:])
        elif line.startswith("-"):
            deleted.setdefault(cur, []).append(line[1:])
    return added, deleted


def parse_patch_changes(patch):
    """path -> ([added], [deleted]) for the caller's patch file (UTF-8)."""
    try:
        with open(patch, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise RuntimeError("cannot read patch file %r (%s)" % (patch, exc))
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise RuntimeError("patch file %r is not UTF-8 (cannot verify its hunks)" % patch)
    return parse_unified_changes(text)


def check_shared_staged(cwd, env, head, covered, supplied_added, supplied_deleted):
    """Refuse a shared-file commit carrying hunks the caller did not pass.

    covered: shared/append paths this route staged. supplied_*: per-path caller
    lines (patch +/- hunks, --append rows). Also refuses whole-file staging of
    an append-only shared file that has no coverage (e.g. smuggled in through a
    directory pathspec). Append-only paths (IMPLICIT_APPEND_ONLY) never accept
    deletions, even a patch that names them. Returns refusal texts (empty = pass).
    """
    from collections import Counter
    errs = []
    proc = run_git(
        ["diff-index", "--cached", "--name-only", head, "--"]
        + sorted(covered | IMPLICIT_APPEND_ONLY),
        cwd, env, check=False,
    )
    staged = set((proc.stdout or "").split())
    smuggled = sorted(p for p in IMPLICIT_APPEND_ONLY if p in staged and p not in covered)
    if smuggled:
        errs.append(
            "shared append-only file(s) %s staged without --append/--shared coverage "
            "(whole-file staging of a multi-writer file sweeps other lanes; refusing)" % smuggled
        )
    if not staged:
        return errs
    diff = run_git(["diff", "--cached", head, "--"] + sorted(staged), cwd, env)
    added, deleted = parse_unified_changes(diff.stdout or "")
    for path in sorted(staged):
        if path not in covered and path not in IMPLICIT_APPEND_ONLY:
            continue
        allow_add = Counter(supplied_added.get(path, []))
        extra_add = list((Counter(added.get(path, [])) - allow_add).elements())
        if extra_add:
            errs.append(
                "shared file %r stages %d added line(s) the caller did not pass "
                "(foreign hunk; first: %r)" % (path, len(extra_add), extra_add[0][:120])
            )
        if path in IMPLICIT_APPEND_ONLY:
            if deleted.get(path):
                errs.append(
                    "shared append-only file %r stages %d deletion(s) "
                    "(first: %r; append-only files never delete)" % (path, len(deleted[path]), deleted[path][0][:120])
                )
        else:
            allow_del = Counter(supplied_deleted.get(path, []))
            extra_del = list((Counter(deleted.get(path, [])) - allow_del).elements())
            if extra_del:
                errs.append(
                    "shared file %r stages %d deletion(s) the caller did not pass "
                    "(first: %r)" % (path, len(extra_del), extra_del[0][:120])
                )
    return errs


def fail(msg, code):
    sys.stderr.write("commit_own: %s\n" % msg)
    return code


def run_git(args, cwd, env, check=True):
    proc = subprocess.run(
        ["git"] + args, cwd=cwd, env=env, capture_output=True, text=True
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            "git %s failed (%d): %s" % (" ".join(args), proc.returncode, (proc.stderr or "").strip())
        )
    return proc


def run_hook(cwd, env, git_dir):
    """Run the pre-commit hook the way `git commit` would (never --no-verify).

    `git hook run` (git >= 2.36) resolves core.hooksPath, so the repo's
    .husky/_ hook runs here exactly as on a normal commit, and it inherits
    GIT_INDEX_FILE just like a hook under a real `git commit` would.
    """
    proc = run_git(["hook", "run", "pre-commit"], cwd, env, check=False)
    if proc.returncode == 0:
        return 0
    combined = (proc.stdout or "") + (proc.stderr or "")
    if "unknown subcommand" in combined or "unknown command" in combined:
        return run_hook_legacy(cwd, env, git_dir)
    sys.stderr.write(combined)
    return proc.returncode


def run_hook_legacy(cwd, env, git_dir):
    """Fallback for git < 2.36: execute the resolved pre-commit file directly."""
    proc = run_git(["config", "core.hooksPath"], cwd, env, check=False)
    hooks_path = (proc.stdout or "").strip()
    if hooks_path and not os.path.isabs(hooks_path):
        hooks_path = os.path.join(cwd, hooks_path)
    if not hooks_path:
        hooks_path = os.path.join(git_dir, "hooks")
    hook_file = os.path.join(hooks_path, "pre-commit")
    if not os.path.isfile(hook_file):
        return 0  # same as git with no hook installed
    for argv in (["sh", hook_file], [hook_file]):
        try:
            proc = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True)
            sys.stderr.write(proc.stdout or "")
            sys.stderr.write(proc.stderr or "")
            return proc.returncode
        except FileNotFoundError:
            continue
    return fail("no shell to run the pre-commit hook", 1)
def split_nul_records(text):
    return [r for r in text.split("\0") if r]


def read_index_entries(cwd, env, pathspec):
    """Shared-index entries: path -> (mode, sha, stage). Absent when unindexed."""
    proc = run_git(["ls-files", "-s", "-z", "--"] + pathspec, cwd, env, check=False)
    if proc.returncode != 0:
        raise RuntimeError("git ls-files failed (%d): %s" % (proc.returncode, (proc.stderr or "").strip()))
    out = {}
    for rec in split_nul_records(proc.stdout or ""):
        head, _, path = rec.partition("\t")
        parts = head.split(" ")
        if len(parts) != 3 or not path:
            continue
        out[path] = (parts[0], parts[1], parts[2])
    return out


def read_head_entries(cwd, env, pathspec):
    """HEAD blobs: path -> (mode, sha). Absent when not in HEAD."""
    # -r matters. A DIRECTORY pathspec expands to the files under it ONLY with
    # -r; without it `want` misses the files a commit just added, and the T5
    # sync's drop branch then STAGES THEIR DELETION in the shared index.
    # Measured 2026-10-20: a commit whose pathspec was a DIRECTORY
    # (experiments_history/2026-10-20_sv-axis-falsifier) landed correctly and then
    # left `D` + `??` for exactly the four files it had just added — the next
    # plain `git commit` would have deleted them from the repository.
    # read_index_entries (ls-files) recursed all along, so the two sides disagreed
    # and the loser's rule was applied.
    proc = run_git(["ls-tree", "-r", "HEAD", "-z", "--"] + pathspec, cwd, env, check=False)
    if proc.returncode != 0:
        raise RuntimeError("git ls-tree HEAD failed (%d): %s" % (proc.returncode, (proc.stderr or "").strip()))
    out = {}
    for rec in split_nul_records(proc.stdout or ""):
        head, _, path = rec.partition("\t")
        parts = head.split(" ")
        if len(parts) != 3 or parts[1] != "blob" or not path:
            continue
        out[path] = (parts[0], parts[2])
    return out


def patch_files(cwd, env, patch):
    """Paths a patch touches (via --numstat)."""
    proc = run_git(["apply", "--numstat", patch], cwd, env, check=False)
    if proc.returncode != 0:
        raise RuntimeError("git apply --numstat failed for %r" % patch)
    touched = set()
    for line in (proc.stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and parts[2]:
            touched.add(parts[2])
    return touched


def _is_lock_error(text):
    return "index.lock" in text


def _run_shared_update(cwd, shared_env, git_args):
    """One shared-index write with a single wait-and-retry on lock contention.

    Owner rule for the shared tree: on index.lock wait 5 s and retry once
    (COMMIT_OWN_SYNC_DELAY overrides the delay for tests).
    Returns None on success, else the failure text.
    """
    try:
        run_git(git_args, cwd, shared_env)
        return None
    except RuntimeError as exc:
        msg = str(exc)
        if not _is_lock_error(msg):
            return msg
        try:
            delay = float(os.environ.get("COMMIT_OWN_SYNC_DELAY", "5"))
        except ValueError:
            delay = 5.0
        if delay > 0:
            time.sleep(delay)
        try:
            run_git(git_args, cwd, shared_env)
            return None
        except RuntimeError as exc2:
            return str(exc2)


def sync_shared_index(cwd, shared_env, pathspec, before, git_dir):
    """T5: bring the SHARED index entries for our own paths to the new HEAD.

    Compare-and-swap per entry: rewritten only when the entry is byte-identical
    to the capture taken at start; a meanwhile-changed entry (a neighbour staged
    this same path) is left alone with a warning, never forced. Writes are
    batched into one update-index call per direction, so a lock race either
    applies nothing or is retried once after 5 s -- never a half-synced trap.
    A pre-existing index.lock aborts before touching anything. Every failure
    returns a warning string, the commit already stands; lock contention is
    named as index.lock so the caller can fail loudly.
    """
    warns = []
    lock_path = os.path.join(git_dir, "index.lock")
    if os.path.exists(lock_path):
        return ["shared-index sync skipped: index.lock present at %s, leaving shared index untouched (commit stands)" % lock_path]
    try:
        want = read_head_entries(cwd, shared_env, pathspec)
    except RuntimeError as exc:
        return ["cannot read HEAD entries (%s); shared index left as is" % exc]
    to_upsert = []
    for path, (mode, sha) in sorted(want.items()):
        try:
            cur = read_index_entries(cwd, shared_env, [path]).get(path)
        except RuntimeError as exc:
            warns.append("cannot read shared entry for %r (%s)" % (path, exc))
            continue
        if cur != before.get(path):
            warns.append("shared index entry for %r changed meanwhile, leaving it" % path)
            continue
        if cur is not None and cur[2] != "0":
            warns.append("shared index entry for %r is conflicted (stage %s), leaving it" % (path, cur[2]))
            continue
        to_upsert.append((path, mode, sha))
    if to_upsert:
        cmd = ["update-index", "--add"]
        for path, mode, sha in to_upsert:
            cmd += ["--cacheinfo", "%s,%s,%s" % (mode, sha, path)]
        err = _run_shared_update(cwd, shared_env, cmd)
        if err is not None:
            warns.append("cannot sync %d shared-index entries (%s)" % (len(to_upsert), err))
            if _is_lock_error(err):
                warns.append("shared-index sync aborted: index.lock contention, entries left untouched")
                return warns
    to_remove = []
    for path in sorted(before):
        if path in want:
            continue
        try:
            cur = read_index_entries(cwd, shared_env, [path]).get(path)
        except RuntimeError as exc:
            warns.append("cannot read shared entry for %r (%s)" % (path, exc))
            continue
        if cur != before.get(path):
            warns.append("shared index entry for %r changed meanwhile, leaving it" % path)
            continue
        to_remove.append(path)
    if to_remove:
        err = _run_shared_update(cwd, shared_env, ["update-index", "--remove", "--"] + to_remove)
        if err is not None:
            warns.append("cannot drop %d shared-index entries (%s)" % (len(to_remove), err))
            if _is_lock_error(err):
                warns.append("shared-index sync aborted: index.lock contention, entries left untouched")
    return warns


def main(argv):
    parser = argparse.ArgumentParser(description="Commit own paths via a private git index.")
    parser.add_argument("--session", required=True, help="session id; becomes .git/index-<id>")
    parser.add_argument("-m", "--message", required=True, help="commit message")
    parser.add_argument("--retries", type=int, default=5, help="HEAD-moved retry budget")
    parser.add_argument("--shared", action="append", default=[], help="own-hunks-only path (repeatable; excluded from whole-file add)")
    parser.add_argument("--apply-patch", action="append", default=[], help="patch file applied --cached into the private index (repeatable; may touch only --shared paths)")
    parser.add_argument("--append", action="append", default=[], metavar="PATH=ROWFILE", help="append ROWFILE bytes to the HEAD blob of PATH (repeatable; the log route; PATH needs no --shared and no place after --)")
    parser.add_argument("paths", nargs="*", default=[], help="pathspecs to commit (whole-file)")
    args = parser.parse_args(argv)

    if not SESSION_RE.match(args.session):
        return fail("bad --session %r (want [A-Za-z0-9_-]{1,64})" % args.session, 2)
    if not args.message.strip():
        return fail("empty -m message (refusing empty commit message)", 2)
    if args.retries < 1:
        return fail("--retries must be >= 1", 2)
    appends = []
    try:
        for item in args.append or []:
            if "=" not in item:
                raise RuntimeError("bad --append %r (want PATH=ROWFILE)" % item)
            apath, _, rowfile = item.partition("=")
            apath = apath.strip()
            rowfile = rowfile.strip()
            if not apath or not rowfile:
                raise RuntimeError("bad --append %r (want PATH=ROWFILE)" % item)
            if not os.path.isfile(rowfile):
                raise RuntimeError("--append row file %r is not a file" % rowfile)
            appends.append((apath, read_row_lines(rowfile)))
    except RuntimeError as exc:
        return fail(str(exc), 2)
    append_paths = sorted({apath for apath, _ in appends})
    shared_set = set(args.shared or [])
    covered = shared_set | set(append_paths)
    whole = [p for p in args.paths if p not in covered]
    bare_implicit = sorted(p for p in whole if p in IMPLICIT_APPEND_ONLY)
    if bare_implicit:
        return fail(
            "shared append-only file(s) %s must not be staged whole "
            "(a worktree copy sweeps other lanes; record with --append PATH=ROWFILE)" % bare_implicit, 2)
    if not whole and not covered:
        return fail("nothing to commit: no paths, no --shared/--apply-patch, no --append", 2)
    capture_paths = list(dict.fromkeys(list(args.paths) + append_paths + list(args.shared or [])))

    cwd = os.getcwd()
    try:
        git_dir = run_git(["rev-parse", "--absolute-git-dir"], cwd, os.environ).stdout.strip()
    except RuntimeError:
        return fail("not inside a git work tree", 2)
    try:
        branch = run_git(["symbolic-ref", "--short", "HEAD"], cwd, os.environ).stdout.strip()
    except RuntimeError:
        return fail("detached HEAD (route requires a branch; refusing)", 2)
    ref = "refs/heads/" + branch
    shared_env = dict(os.environ)
    shared_env.pop("GIT_INDEX_FILE", None)
    try:
        shared_before = read_index_entries(cwd, shared_env, capture_paths)
    except RuntimeError as exc:
        return fail("cannot read shared index (%s)" % exc, 1)

    priv = os.path.join(git_dir, "index-" + args.session)
    env = dict(os.environ, GIT_INDEX_FILE=priv)
    race_env = dict(os.environ)
    race_env.pop("GIT_INDEX_FILE", None)
    race_hook = os.environ.get("COMMIT_OWN_RACE_HOOK")

    if os.path.exists(priv):
        os.remove(priv)  # ours by name: stale file from a crashed run

    code = 1
    try:
        for attempt in range(1, args.retries + 1):
            try:
                head = run_git(["rev-parse", "HEAD"], cwd, os.environ).stdout.strip()
            except RuntimeError:
                return fail("unborn HEAD (route requires an existing commit)", 2)
            run_git(["read-tree", "--reset", head], cwd, env)
            if whole:
                add = run_git(["add", "-A", "--"] + whole, cwd, env, check=False)
                if add.returncode != 0:
                    sys.stderr.write(add.stderr or "")
                    return fail("bad pathspec (nothing added)", 2)
            for apath, lines in appends:
                blob = head_blob(cwd, env, head, apath)
                if blob is None:
                    blob = b""
                if blob != b"" and not blob.endswith(b"\n"):
                    blob += b"\n"
                new_blob = blob + ("\n".join(lines) + "\n").encode("utf-8")
                try:
                    sha = run_git_bytes(["hash-object", "-w", "--stdin"], cwd, env, inp=new_blob).decode().strip()
                    mode = head_blob_mode(cwd, env, head, apath)
                    run_git(["update-index", "--add", "--cacheinfo", "%s,%s,%s" % (mode, sha, apath)], cwd, env)
                except RuntimeError as exc:
                    return fail("cannot stage --append %r (%s)" % (apath, exc), 1)
            touched = set()
            for patch in args.apply_patch or []:
                chk = run_git(["apply", "--check", "--cached", patch], cwd, env, check=False)
                if chk.returncode != 0:
                    sys.stderr.write(chk.stderr or "")
                    hint = ""
                    try:
                        with open(patch, "rb") as fh:
                            raw = fh.read(1 << 20)
                        if b"\r" in raw:
                            hint = ("; the patch file has CR/CRLF line endings -- git apply --cached rejects them "
                                    "on this host even with zero HEAD movement (t131 R1). Write the patch with LF bytes, "
                                    "or record a progress-log row with --append PATH=ROWFILE instead of a patch")
                    except OSError:
                        pass
                    return fail("patch %r does not apply --cached%s" % (patch, hint), 2)
                try:
                    touched |= patch_files(cwd, env, patch)
                except RuntimeError as exc:
                    return fail(str(exc), 2)
            outside = touched - covered
            if outside:
                return fail("patch touches non-shared paths %s (refusing)" % sorted(outside), 2)
            for patch in args.apply_patch or []:
                run_git(["apply", "--cached", patch], cwd, env)
            try:
                supplied_added = {}
                supplied_deleted = {}
                for apath, lines in appends:
                    supplied_added.setdefault(apath, []).extend(lines)
                for patch in args.apply_patch or []:
                    padd, pdel = parse_patch_changes(patch)
                    for path, ls in padd.items():
                        supplied_added.setdefault(path, []).extend(ls)
                    for path, ls in pdel.items():
                        supplied_deleted.setdefault(path, []).extend(ls)
                guard_errs = check_shared_staged(cwd, env, head, covered, supplied_added, supplied_deleted)
            except RuntimeError as exc:
                return fail(str(exc), 2)
            for err in guard_errs:
                sys.stderr.write("commit_own: refusing shared-file commit: %s\n" % err)
            if guard_errs:
                return fail("shared-file guard refused the staged result (nothing committed)", 2)
            quiet = run_git(["diff-index", "--quiet", "--cached", head, "--"], cwd, env, check=False)
            if quiet.returncode == 0:
                return fail("nothing staged for the given paths: no changes vs HEAD (refusing empty commit)", 2)
            staged = run_git(["diff-index", "--cached", "--name-only", head, "--"], cwd, env).stdout.strip()
            if run_hook(cwd, env, git_dir) != 0:
                return fail("pre-commit hook failed (aborting, nothing committed)", 1)
            tree = run_git(["write-tree"], cwd, env).stdout.strip()
            if race_hook and attempt == 1:
                sys.stderr.write("commit_own: running COMMIT_OWN_RACE_HOOK (test seam)\n")
                subprocess.run(race_hook, shell=True, cwd=cwd, env=race_env)
            new = run_git(["commit-tree", tree, "-p", head, "-m", args.message], cwd, env).stdout.strip()
            update = run_git(["update-ref", ref, new, head], cwd, os.environ, check=False)
            if update.returncode == 0:
                warns = sync_shared_index(cwd, shared_env, capture_paths, shared_before, git_dir)
                for w in warns:
                    sys.stderr.write("commit_own: warn: %s\n" % w)
                sys.stderr.write(
                    "commit_own: staged [%s] -> %s (attempt %d)\n" % (staged.replace("\n", " "), new, attempt)
                )
                if any(_is_lock_error(w) for w in warns):
                    sys.stderr.write(
                        "commit_own: shared-index sync FAILED (index.lock contention, commit %s stands, shared index left stale; "
                        "remove the stale lock only after proving no git process holds it, then sync with `git read-tree HEAD -- <paths>`)\n" % new
                    )
                    sys.stdout.write(new + "\n")
                    return 1
                sys.stdout.write(new + "\n")
                return 0
            sys.stderr.write(
                "commit_own: attempt %d: HEAD moved meanwhile, re-seeding (%s)\n"
                % (attempt, (update.stderr or "").strip())
            )
            time.sleep(1)
        return fail("ref %s kept moving (%d attempts); nothing committed, retry later" % (ref, args.retries), 1)
    except RuntimeError as exc:
        return fail(str(exc), 1)
    finally:
        if os.path.exists(priv):
            os.remove(priv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
