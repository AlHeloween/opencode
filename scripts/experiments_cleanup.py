#!/usr/bin/env python3
"""Clean the scratch trees of what they can regenerate -- and never follow a junction.

Every rule names its REGENERATION, because a deletion without one is just a loss:

  DELETE  a build target                -> rebuild it (cargo/bun/dotnet/_build.ps1)
  DELETE  a real node_modules/          -> bun install in the parent package
  DELETE  a repo tree copy              -> git archive HEAD | tar -x -C <dst>
  DELETE  the unpacked form of an       -> unzip the .zip kept beside it
          archive that is kept
  DELETE  the second and later copy     -> the first copy is kept
          of a byte-identical file
  HOLD    a stand's .opencode/data      -> the owner's word (fossil repo + opencode.db)
  HOLD    a fossil worktree             -> the owner's word
  HOLD    a bin/ folder                 -> the owner's rule names bin/
  HOLD    a folder written in the last  -> today's live work -- EXCEPT a pure
          N hours                          build target inside it, which is exactly
                                           what the rule says may go
  HOLD    a frozen baseline, a loose    -> an experiment INPUT or a unique build;
          unique build binary, a            listed for the owner, never deleted
          fixture copy
  HOLD    anything unclassified         -> the owner's list

Two kinds of hold, because they answer different questions:

  HARD  nothing under it is touched at all (an owner's stand, a protected path).
  SOFT  the folder is live work -- but a PURE BUILD TARGET inside it is still
        deletable, since that is regenerable by definition.

Holds are PATH-LEVEL: a folder that merely CONTAINS a stand base is still
cleaned -- the base itself is held, the build targets beside it are not. A hold
that swallows a whole experiment folder is a hold that hides 863 MB of cargo
output behind a 357-byte log directory.

Junction safety is the whole point. A reparse point is a LEAF: never descended
into, never copied, and deleted with ``os.rmdir`` (which removes the LINK, not
the target). The receipt is RELATIVE: a junction that was already dangling
before the run is reported as pre-existing, and only a junction this run broke
is a failure.

Usage:
    python scripts/experiments_cleanup.py --root experiments --dry-run
    python scripts/experiments_cleanup.py --root experiments --apply --report out.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from experiments_tree import BUILD_TARGET_NAMES, PROTECTED_NAMES, Entry, is_reparse, walk  # noqa: E402

# Extensions that mark a SOURCE file: a build directory holds artifacts, not sources.
SOURCE_EXTENSIONS = frozenset({
    ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".py", ".go", ".rs",
    ".cs", ".cpp", ".c", ".h", ".hpp", ".java", ".rb", ".php", ".sh", ".ps1", ".bat",
    ".cmd", ".lua", ".swift", ".kt", ".scala", ".sql",
})
# Markers that identify a build output directory by its own shape.
BUILD_MARKERS = frozenset({
    ".fingerprint", "deps", "build", "obj", "CACHEDIR.TAG", ".dart_tool", "incremental",
    ".tsbuildinfo", ".next", ".nuxt",
})
# Path markers that say "this copy exists to be compared against" -- a fixture,
# not litter. Never deleted as a duplicate.
FIXTURE_MARKERS = ("tampered", "broken", "fixture", "decoy", "control", "golden", "expected")
# A loose build binary is not a finding; the canon excludes .exe from the archive
# for the same reason.
BINARY_EXTENSIONS = frozenset({".exe", ".dll", ".pdb", ".so", ".dylib", ".lib", ".node", ".rlib"})

REGENERATION = {
    "build-target": "rebuild: cargo build --release / bun run build / dotnet build / _build.ps1",
    "node-modules": "bun install (or npm ci) in the parent package",
    "repo-tree-copy": "git archive HEAD | tar -x -C <dst> (never copytree over junctions)",
    "unpacked-archive": "unzip the .zip kept beside it",
    "duplicate": "the first (kept) copy of the identical file",
}


def human(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(num) < 1024 or unit == "TB":
            return "%.2f %s" % (num, unit)
        num /= 1024
    return "%.2f TB" % num


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def looks_like_build(entry: Entry) -> bool:
    """A directory named like a build target, checked by its own content."""
    name = entry.name.lower()
    if name not in BUILD_TARGET_NAMES or name in PROTECTED_NAMES:
        return False
    if {child.name for child in entry.children} & BUILD_MARKERS:
        return True
    for child in entry.walk():
        if child.reparse:
            continue
        if os.path.splitext(child.name)[1].lower() in SOURCE_EXTENSIONS:
            return False
    return True


def own_names(path: str) -> set[str]:
    try:
        return {entry.name for entry in os.scandir(path)}
    except OSError:
        return set()


def is_fossil_worktree(path: str) -> bool:
    names = own_names(path)
    return "_FOSSIL_" in names or any(name.endswith(".fossil") for name in names)


def registered_stand_roots() -> dict[str, str]:
    """Stand roots known to fossil, from `fossil all list`.

    A registered stand is named by the path of its fossil repo:
    ``<worktree>/.opencode/data/fossil/<id>/snapshot.fsl`` -> the worktree is
    ``<worktree>``; a bare ``org.fossil`` -> its own directory. The paths are
    printed with forward slashes, so they are normalized before splitting.
    """
    roots: dict[str, str] = {}
    try:
        import subprocess

        proc = subprocess.run(["fossil", "all", "list"], capture_output=True, text=True)
    except OSError:
        return roots
    marker = "/experiments/"
    for line in proc.stdout.splitlines():
        if marker not in line:
            continue
        tail = line.split(marker, 1)[1]
        parts = tail.split("/")
        if not parts or not parts[0]:
            continue
        if ".opencode" in parts:
            root = "/".join(parts[:parts.index(".opencode")])
        else:
            root = "/".join(parts[:-1]) if len(parts) > 1 else parts[0]
        if root:
            roots[root] = "registered in `fossil all list`: the owner's word"
    return roots


class Holds:
    """HARD holds (untouchable) and SOFT holds (live work, build targets excepted)."""

    def __init__(self):
        self.hard: dict[str, str] = {}
        self.soft: dict[str, str] = {}

    def add_hard(self, rel: str, reason: str):
        if rel and rel not in self.hard:
            self.hard[rel] = reason

    def add_soft(self, rel: str, reason: str):
        if rel and rel not in self.soft and rel not in self.hard:
            self.soft[rel] = reason

    def ancestors(self, rel: str):
        parts = rel.split(os.sep)
        for index in range(1, len(parts) + 1):
            yield os.sep.join(parts[:index])

    def hard_reason(self, rel: str) -> str:
        for ancestor in self.ancestors(rel):
            if ancestor in self.hard:
                return self.hard[ancestor]
        return ""

    def soft_reason(self, rel: str, entry: Entry) -> str:
        for ancestor in self.ancestors(rel):
            if ancestor in self.soft:
                if entry is not None and looks_like_build(entry):
                    return ""
                return self.soft[ancestor]
        return ""

    def blocked(self, rel: str, entry: Entry) -> str:
        return self.hard_reason(rel) or self.soft_reason(rel, entry)


def compute_holds(tree: Entry, protect_prefixes, cutoff, stands: dict[str, str]) -> Holds:
    """Path-level holds. A held path is never touched, itself or below."""
    holds = Holds()
    for entry in tree.walk():
        rel = entry.rel
        if not rel:
            continue
        name = entry.name.lower()
        matched = False
        for prefix in protect_prefixes:
            if rel == prefix or rel.startswith(prefix + os.sep):
                holds.add_hard(rel, "protected path: %s" % prefix)
                matched = True
                break
        if matched:
            continue
        if name in PROTECTED_NAMES:
            holds.add_hard(rel, "bin/ folder: the owner's rule names bin/")
            continue
        if is_fossil_worktree(entry.path):
            holds.add_hard(rel, "fossil worktree: the owner's word")
            continue
        base = os.path.join(entry.path, ".opencode", "data")
        if os.path.isdir(base):
            holds.add_hard(os.path.relpath(base, tree.path), "stand base (.opencode/data): the owner's word")
            continue
        if entry.mtime > cutoff:
            holds.add_soft(rel, "written in the last %d h: today's live work" % 24)
    for stand_root, reason in stands.items():
        for ancestor in holds.ancestors(stand_root):
            if ancestor:
                holds.add_hard(ancestor, reason)
    return holds


def archive_beside(entry: Entry) -> bool:
    """True when a .zip sits next to this directory -- the archive that regenerates it."""
    try:
        names = os.listdir(os.path.dirname(entry.path))
    except OSError:
        return False
    return any(name.lower().endswith(".zip") for name in names)


def is_repo_tree_copy(entry: Entry) -> bool:
    names = own_names(entry.path)
    return "bun.lock" in names and "packages" in names


def classify(entry: Entry) -> str:
    """The class of a directory, or '' when it is not a delete candidate."""
    name = entry.name.lower()
    if name == "node_modules":
        return "node-modules"
    if name == "unpacked" and archive_beside(entry):
        return "unpacked-archive"
    if is_repo_tree_copy(entry):
        return "repo-tree-copy"
    if looks_like_build(entry):
        return "build-target"
    return ""


def build_delete_dirs(tree: Entry, holds: Holds):
    """Top-most, non-overlapping delete candidates."""
    deletions = []

    def visit(entry: Entry):
        if entry.reparse:
            return
        if holds.blocked(entry.rel, entry):
            return
        kind = classify(entry)
        if kind:
            deletions.append({
                "rel": entry.rel,
                "class": kind,
                "bytes": entry.total_bytes,
                "files": entry.files,
                "regenerate": REGENERATION[kind],
            })
            return
        for child in entry.children:
            visit(child)

    for child in tree.children:
        visit(child)
    return deletions


def find_duplicates(files, min_bytes: int):
    """sha256 over the size-collision groups: identical content -> one keeper."""
    by_size: dict[int, list[tuple[str, str]]] = {}
    for rel, path, size in files:
        by_size.setdefault(size, []).append((rel, path))
    groups = []
    for size, members in by_size.items():
        if size < min_bytes or len(members) < 2:
            continue
        by_digest: dict[str, list[tuple[str, str]]] = {}
        for rel, path in members:
            try:
                by_digest.setdefault(sha256(path), []).append((rel, path))
            except OSError:
                continue
        for digest, same in by_digest.items():
            if len(same) < 2:
                continue
            groups.append({"sha256": digest, "bytes": size, "members": same})
    groups.sort(key=lambda g: -g["bytes"] * (len(g["members"]) - 1))
    return groups


def build_delete_files(files, holds: Holds, deletions, cutoff, min_bytes: int):
    """Later copies of byte-identical files, minus fixtures, holds and doomed keepers.

    Two rules make "a duplicate" safe to delete:

    * the SAME BASENAME -- a file whose NAME differs from the keeper's carries
      meaning (a quality sweep's ``frame_000_q30.ppm`` and ``q50.ppm`` are
      byte-identical BY RESULT, and the experiment IS the comparison), so only a
      same-named copy is a copy;
    * the keeper is the copy that lives in a HELD place (a stand base) when one
      exists -- otherwise the canonical copy is the one we would delete.
    """
    doomed = [entry["rel"] for entry in deletions]
    results = []
    for group in find_duplicates(files, min_bytes):
        members = sorted(group["members"], key=lambda m: m[0])

        def safe(rel: str) -> bool:
            if holds.hard_reason(rel) or holds.soft_reason(rel, None):
                return False
            if any(rel == root or rel.startswith(root + os.sep) for root in doomed):
                return False
            if any(marker in rel.lower() for marker in FIXTURE_MARKERS):
                return False
            return True

        keeper = None
        for rel, path in members:
            if safe(rel) and holds.hard_reason(rel):
                keeper = (rel, path)
                break
        if keeper is None:
            for rel, path in members:
                if safe(rel):
                    keeper = (rel, path)
                    break
        if keeper is None:
            continue
        keeper_name = os.path.basename(keeper[0])
        for rel, path in members:
            if rel == keeper[0] or not safe(rel):
                continue
            if os.path.basename(rel) != keeper_name:
                continue
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                mtime = 0.0
            if mtime > cutoff:
                continue
            results.append({
                "rel": rel,
                "bytes": group["bytes"],
                "keeper": keeper[0],
                "sha256": group["sha256"],
                "class": "duplicate",
                "regenerate": REGENERATION["duplicate"],
            })
    return results


def owner_list(tree: Entry, holds: Holds, deletions):
    """Heavy things the policy does NOT delete: the owner's decision."""
    entries = []
    doomed = [entry["rel"] for entry in deletions]
    for entry in tree.walk():
        if entry.reparse or entry.depth == 0 or entry.total_bytes < 50 * 1024 * 1024:
            continue
        reason = holds.hard_reason(entry.rel)
        if reason:
            entries.append({"rel": entry.rel, "bytes": entry.total_bytes, "class": "held", "reason": reason})
            continue
        if any(entry.rel == root or entry.rel.startswith(root + os.sep) for root in doomed):
            continue
        kind = "unclassified"
        if "frozen" in entry.name.lower():
            kind = "frozen-baseline"
        elif os.path.splitext(entry.name.lower())[1] in BINARY_EXTENSIONS:
            kind = "unique-build-binary"
        entries.append({
            "rel": entry.rel,
            "bytes": entry.total_bytes,
            "class": kind,
            "reason": "not provably regenerable: the owner's call",
        })
    entries.sort(key=lambda e: -e["bytes"])
    return entries


def remove_tree_safely(path: str):
    """Delete a tree WITHOUT following a reparse point; junctions are unlinked."""
    removed = 0
    junctions = []
    if is_reparse(os.lstat(path)):
        os.rmdir(path)
        return 0, [path]
    stack = [path]
    directories = []
    while stack:
        current = stack.pop()
        directories.append(current)
        try:
            children = list(os.scandir(current))
        except OSError:
            continue
        for child in children:
            try:
                st = child.stat(follow_symlinks=False)
            except OSError:
                continue
            if is_reparse(st):
                os.rmdir(child.path)
                junctions.append(child.path)
                continue
            if child.is_dir(follow_symlinks=False):
                stack.append(child.path)
                continue
            removed += st.st_size
            try:
                os.remove(child.path)
            except OSError:
                pass
    for directory in reversed(directories):
        try:
            os.rmdir(directory)
        except OSError:
            pass
    return removed, junctions


def target_exists(target: str) -> bool:
    return os.path.exists(target.replace("\\\\?\\", ""))


def main(argv) -> int:
    parser = argparse.ArgumentParser(description="Clean a scratch tree of regenerable weight.")
    parser.add_argument("--root", default="experiments")
    parser.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    parser.add_argument("--report", default=None)
    parser.add_argument("--protect", action="append", default=[], help="path prefix never to delete")
    parser.add_argument("--protect-hours", type=int, default=24)
    parser.add_argument("--min-hash-mb", type=float, default=1.0)
    args = parser.parse_args(argv)

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        sys.stderr.write("experiments_cleanup: not a directory: %s\n" % args.root)
        return 2

    cutoff = time.time() - args.protect_hours * 3600
    tree, files = walk(root)
    stands = registered_stand_roots()
    holds = compute_holds(tree, args.protect, cutoff, stands)
    deletions = build_delete_dirs(tree, holds)
    delete_files = build_delete_files(files, holds, deletions, cutoff, int(args.min_hash_mb * 1024 * 1024))
    owner = owner_list(tree, holds, deletions)

    junctions = [(e.rel, e.path, e.reparse_target) for e in tree.walk() if e.reparse]
    dangling_before = [rel for rel, _path, target in junctions if not target_exists(target)]

    freed = 0
    executed = []
    if args.apply:
        for entry in deletions:
            target = os.path.join(root, entry["rel"])
            if not os.path.isdir(target):
                continue
            removed, unlinked = remove_tree_safely(target)
            freed += removed
            executed.append({"rel": entry["rel"], "class": entry["class"], "bytes": removed,
                             "junctions_unlinked": unlinked})
        for entry in delete_files:
            target = os.path.join(root, entry["rel"])
            try:
                size = os.path.getsize(target)
                os.remove(target)
            except OSError:
                continue
            freed += size
            executed.append({"rel": entry["rel"], "class": "duplicate", "bytes": size, "keeper": entry["keeper"]})

    broken_now = [rel for rel, _path, target in junctions if not target_exists(target)]
    broken_by_run = [rel for rel in broken_now if rel not in dangling_before]

    report = {
        "root": root,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "applied": args.apply,
        "total_bytes_before": tree.total_bytes,
        "freed_bytes": freed,
        "total_bytes_after_estimate": tree.total_bytes - freed,
        "delete_dirs": deletions,
        "delete_files": delete_files,
        "executed": executed,
        "holds_hard": holds.hard,
        "holds_soft": holds.soft,
        "owner_list": owner,
        "junctions_seen": [{"rel": r, "target": t} for r, _p, t in junctions],
        "junctions_dangling_before": dangling_before,
        "junctions_broken_by_run": broken_by_run,
        "stand_roots": sorted(stands),
    }
    if args.report:
        with open(args.report, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(report, handle, indent=2)

    print("root: %s" % root)
    print("total before: %s" % human(tree.total_bytes))
    print("delete dirs:  %d (%s)" % (len(deletions), human(sum(e["bytes"] for e in deletions))))
    print("delete files: %d (%s, byte-identical duplicates)" % (
        len(delete_files), human(sum(e["bytes"] for e in delete_files))))
    print("holds:        %d hard, %d soft" % (len(holds.hard), len(holds.soft)))
    print("owner list:   %d heavy items" % len(owner))
    if args.apply:
        print("FREED:        %s" % human(freed))
    print("junctions:    %d seen, %d dangling BEFORE, %d broken BY THIS RUN" % (
        len(junctions), len(dangling_before), len(broken_by_run)))
    for entry in owner[:25]:
        print("  OWNER %12s  %-18s %s" % (human(entry["bytes"]), entry["class"], entry["rel"]))
    if broken_by_run:
        print("JUNCTIONS BROKEN BY THIS RUN:")
        for rel in broken_by_run:
            print("  %s" % rel)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
