#!/usr/bin/env python3
"""One junction-safe walker for the scratch trees. The single implementation.

Why a shared walker: on 2026-10-21 a robot ran ``shutil.copytree(src, dst,
dirs_exist_ok=True)`` over a tree whose ``node_modules`` and ``.opencode``
entries are NTFS junctions. copytree followed them and copied their TARGET
CONTENT -- 72.4 GB -- until drive D had 0 GB free and the step died. Two
upstream reports describe the same shape: CPython #104046 (copytree does not
understand NTFS junctions) and CPython #142155 (shutil forces
``is_symlink = False`` for junctions, so even ``symlinks=True`` does not
protect against them).

So every walk here treats a reparse point as a LEAF:

  * it is never descended into,
  * its target's bytes are never counted as ours,
  * deleting it removes the LINK (os.rmdir), never the target.

A directory's size is the sum of its own files and its descendants'.
"""

from __future__ import annotations

import os

FILE_ATTRIBUTE_REPARSE_POINT = 0x400
FILE_ATTRIBUTE_DIRECTORY = 0x10

# Names that are BUILD OUTPUT wherever they appear in a scratch tree.
BUILD_TARGET_NAMES = frozenset({
    "target", "dist", "out", "build", "release", "deps", "coverage", "__pycache__",
    ".cache", ".pip_cache", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".next",
    ".turbo", "obj", ".gradle", ".venv", "venv", ".venvs", ".bun",
})

# Names the owner's own rules protect wherever they appear.
PROTECTED_NAMES = frozenset({"bin"})


def is_reparse(st) -> bool:
    """True when the stat carries the reparse-point attribute (junction, symlink, mount point)."""
    return bool(getattr(st, "st_file_attributes", 0) & FILE_ATTRIBUTE_REPARSE_POINT)


def is_dir(st) -> bool:
    return bool(getattr(st, "st_file_attributes", 0) & FILE_ATTRIBUTE_DIRECTORY)


class Entry:
    """One directory in the tree, with its rolled-up size."""

    __slots__ = ("path", "rel", "depth", "own_bytes", "total_bytes", "files",
                 "children", "mtime", "reparse", "reparse_target", "flags")

    def __init__(self, path: str, rel: str, depth: int):
        self.path = path
        self.rel = rel
        self.depth = depth
        self.own_bytes = 0
        self.total_bytes = 0
        self.files = 0
        self.children: list[Entry] = []
        self.mtime = 0.0
        self.reparse = False
        self.reparse_target = ""
        self.flags: set[str] = set()

    @property
    def name(self) -> str:
        return os.path.basename(self.path)

    def walk(self):
        """Depth-first over this entry and its descendants."""
        yield self
        for child in self.children:
            yield from child.walk()

    def as_dict(self) -> dict:
        return {
            "rel": self.rel,
            "depth": self.depth,
            "bytes": self.total_bytes,
            "own_bytes": self.own_bytes,
            "files": self.files,
            "mtime": self.mtime,
            "reparse": self.reparse,
            "reparse_target": self.reparse_target,
            "flags": sorted(self.flags),
            "children": [child.as_dict() for child in sorted(self.children, key=lambda c: -c.total_bytes)],
        }


def read_target(path: str) -> str:
    try:
        return os.readlink(path)
    except OSError:
        return "<not a symbolic link / unreadable target>"


def own_flags(path: str) -> set[str]:
    """Structural facts about a directory, read from its OWN entries only."""
    flags: set[str] = set()
    try:
        names = {entry.name for entry in os.scandir(path)}
    except OSError:
        return flags
    if "bun.lock" in names and "packages" in names:
        flags.add("repo-tree-copy")
    if ".opencode" in names and os.path.isdir(os.path.join(path, ".opencode", "data")):
        flags.add("stand-base")
    if "_FOSSIL_" in names or any(name.endswith(".fossil") for name in names):
        flags.add("fossil-repo")
    return flags


def walk(root: str) -> tuple[Entry, list[tuple[str, str, int]]]:
    """Walk ``root`` without descending into a reparse point.

    Returns (root_entry, files) where ``files`` is a list of
    (rel_path, abs_path, size) for every FILE -- the raw material for
    duplicate detection.
    """
    files: list[tuple[str, str, int]] = []

    def visit(path: str, rel: str, depth: int) -> Entry:
        entry = Entry(path, rel, depth)
        try:
            entry.mtime = os.path.getmtime(path)
            children = sorted(os.scandir(path), key=lambda e: e.name)
        except OSError as exc:
            entry.flags.add("unreadable: %s" % exc)
            return entry
        for child in children:
            child_rel = os.path.join(rel, child.name) if rel else child.name
            try:
                st = child.stat(follow_symlinks=False)
            except OSError:
                continue
            if is_reparse(st):
                link = Entry(child.path, child_rel, depth + 1)
                link.reparse = True
                link.reparse_target = read_target(child.path)
                entry.children.append(link)
                continue
            if is_dir(st):
                sub = visit(child.path, child_rel, depth + 1)
                entry.children.append(sub)
                entry.total_bytes += sub.total_bytes
                entry.files += sub.files
                continue
            size = st.st_size
            entry.own_bytes += size
            entry.total_bytes += size
            entry.files += 1
            files.append((child_rel, child.path, size))
        entry.flags |= own_flags(path)
        return entry

    return visit(root, "", 0), files


def reparse_points(root_entry: Entry) -> list[Entry]:
    """Every reparse point in the tree, with its target."""
    return [entry for entry in root_entry.walk() if entry.reparse]


def top_level(root_entry: Entry) -> list[Entry]:
    return list(root_entry.children)
