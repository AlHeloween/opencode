#!/usr/bin/env python3
"""Commit exactly the given paths through a private git index.

Route for robots sharing one checkout (t66): every session commits through
``.git/index-<session>`` seeded from HEAD, so a commit can never sweep another
agent's staged work out of the shared ``.git/index``.

Usage:
    python scripts/commit_own.py --session <id> -m <msg> -- <paths...>

Steps: seed private index from HEAD -> ``git add -A -- <paths>`` into it ->
refuse when nothing is staged -> run the pre-commit hook -> ``write-tree`` +
``commit-tree`` -> atomic ``update-ref <branch> <new> <old>``
(compare-and-swap; when HEAD moved meanwhile, re-seed from the fresh HEAD and
retry, never force) -> remove the private index (on success and on failure).

Whole-file staging only. Hunk-level ``git add -p`` against an alternate index
works (``GIT_INDEX_FILE=<priv> git add -p -- <path>``) but is interactive and
cannot run unattended, so it is out of scope for this route: the one shared
append-only file (``_progress_log.md``) needs no hunk support because a
whole-file add after a HEAD-moved retry stages only lines not yet in HEAD.

The shared ``.git/index`` is never opened by this script: every git command
that touches an index runs with ``GIT_INDEX_FILE=<priv>``. The only deliberate
exception is the test seam ``COMMIT_OWN_RACE_HOOK`` (a shell command run after
``write-tree`` and before ``update-ref`` on the first attempt only), which runs
with ``GIT_INDEX_FILE`` scrubbed so a simulated peer commits via the shared
index like a real peer would.

Exit codes: 0 committed (new sha on stdout); 2 usage/refusal (bad session id,
detached or unborn HEAD, bad pathspec, nothing staged); 1 operational failure
(hook failed, ref update still racing after --retries, git errors).
"""

import argparse
import os
import re
import subprocess
import sys
import time

SESSION_RE = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


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


def main(argv):
    parser = argparse.ArgumentParser(description="Commit own paths via a private git index.")
    parser.add_argument("--session", required=True, help="session id; becomes .git/index-<id>")
    parser.add_argument("-m", "--message", required=True, help="commit message")
    parser.add_argument("--retries", type=int, default=5, help="HEAD-moved retry budget")
    parser.add_argument("paths", nargs="+", help="pathspecs to commit (whole-file)")
    args = parser.parse_args(argv)

    if not SESSION_RE.match(args.session):
        return fail("bad --session %r (want [A-Za-z0-9_-]{1,64})" % args.session, 2)
    if not args.message.strip():
        return fail("empty -m message (refusing empty commit message)", 2)
    if args.retries < 1:
        return fail("--retries must be >= 1", 2)

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
            add = run_git(["add", "-A", "--"] + args.paths, cwd, env, check=False)
            if add.returncode != 0:
                sys.stderr.write(add.stderr or "")
                return fail("bad pathspec (nothing added)", 2)
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
                sys.stderr.write(
                    "commit_own: staged [%s] -> %s (attempt %d)\n" % (staged.replace("\n", " "), new, attempt)
                )
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
