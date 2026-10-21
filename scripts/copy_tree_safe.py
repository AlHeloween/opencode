#!/usr/bin/env python3
"""Copy a tree WITHOUT following junctions -- the guard against the 72 GB shape.

On 2026-10-21 a robot ran ``shutil.copytree(src, dst, dirs_exist_ok=True)`` over
a tree whose ``node_modules`` and ``.opencode`` entries are NTFS junctions.
copytree followed them and copied their TARGET CONTENT: 72.4 GB, until drive D
had 0 GB free and the step died.

``symlinks=True`` does NOT save you. A junction is a reparse point, not a
symbolic link, and CPython's shutil forces ``is_symlink = False`` for junctions
(CPython #104046, #142155). This helper therefore does not use shutil's
directory copy at all: it walks the tree itself and treats every reparse point
as a LEAF.

Two modes for a junction, chosen by what the copy is FOR:

  ``link``    recreate the junction at the destination (the target is shared,
              not copied) -- the shape a harness tree wants;
  ``skip``    leave the junction out entirely and report it.

THE FORECAST GATES THE ACTION. The projected size is computed FIRST; if it is
over the budget the copy is REFUSED and NOTHING is written. Owner, 2026-10-22:
«Короче схалтурил и выполнил действие без проверки и прогноза ожидаемого
результата.» -- the 72 GB copy was an action taken with no predicted size and no
verdict, so the predicted size is now a gate, not a note.

Usage:
    python scripts/copy_tree_safe.py SRC DST --mode link
    python scripts/copy_tree_safe.py SRC DST --mode link --dry-run
    python scripts/copy_tree_safe.py SRC DST --max-gb 2      # refuse over 2 GB
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from experiments_tree import walk  # noqa: E402

DEFAULT_MAX_GB = 2.0


def junction_target(entry) -> str:
    try:
        return os.readlink(entry.path)
    except OSError:
        return ""


def make_junction(link_path: str, target: str) -> bool:
    """Create a directory junction (mklink /J) -- no privileges needed on Windows."""
    if os.name != "nt":
        try:
            os.symlink(target, link_path, target_is_directory=True)
            return True
        except OSError:
            return False
    proc = subprocess.run(["cmd", "/c", "mklink", "/J", link_path, target], capture_output=True, text=True)
    return proc.returncode == 0


def copy_tree(src: str, dst: str, mode: str, dry_run: bool, max_bytes: int):
    """Copy ``src`` to ``dst``; junctions are recreated or skipped, never followed.

    The projection is computed before a single byte is written; over the budget
    the copy is REFUSED and the destination is not created.
    """
    tree, files = walk(src)
    junctions = [entry for entry in tree.walk() if entry.reparse]
    projected = sum(size for _rel, _path, size in files)
    report = {
        "src": src,
        "dst": dst,
        "mode": mode,
        "dry_run": dry_run,
        "projected_bytes": projected,
        "files": len(files),
        "junctions_seen": [{"rel": e.rel, "target": junction_target(e)} for e in junctions],
        "junctions_recreated": [],
        "junctions_skipped": [],
        "errors": [],
    }
    if dry_run:
        return report
    if max_bytes and projected > max_bytes:
        report["refused"] = "predicted %.2f MB > budget %.2f MB" % (projected / 1048576, max_bytes / 1048576)
        return report

    os.makedirs(dst, exist_ok=True)
    for rel, path, _size in files:
        target = os.path.join(dst, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        try:
            shutil.copy2(path, target)
        except OSError as exc:
            report["errors"].append({"rel": rel, "error": str(exc)})
    for entry in junctions:
        target = junction_target(entry)
        destination = os.path.join(dst, entry.rel)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        if mode == "link" and target:
            if make_junction(destination, target):
                report["junctions_recreated"].append({"rel": entry.rel, "target": target})
            else:
                report["errors"].append({"rel": entry.rel, "error": "mklink failed"})
        else:
            report["junctions_skipped"].append({"rel": entry.rel, "target": target})
    return report


def main(argv) -> int:
    parser = argparse.ArgumentParser(description="Junction-safe tree copy with a size forecast that gates the action.")
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--mode", choices=["link", "skip"], default="link")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-gb", type=float, default=DEFAULT_MAX_GB,
                        help="REFUSE the copy when the PREDICTED size exceeds this (0 = no limit; default = the 2 GB folder budget)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    src = os.path.abspath(args.src)
    if not os.path.isdir(src):
        sys.stderr.write("copy_tree_safe: not a directory: %s\n" % args.src)
        return 2

    max_bytes = int(args.max_gb * (1024 ** 3)) if args.max_gb else 0
    report = copy_tree(src, os.path.abspath(args.dst), args.mode, args.dry_run, max_bytes)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("projected: %.2f MB in %d files" % (report["projected_bytes"] / 1048576, report["files"]))
        if report.get("refused"):
            print("REFUSED: %s -- nothing was copied" % report["refused"])
        else:
            print("junctions: %d seen, %d recreated, %d skipped" % (
                len(report["junctions_seen"]), len(report["junctions_recreated"]), len(report["junctions_skipped"])))
            for item in report["junctions_seen"]:
                print("  %s -> %s" % (item["rel"], item["target"]))
            for error in report["errors"]:
                print("  ERROR %s: %s" % (error["rel"], error["error"]))
    if report.get("refused"):
        return 1
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
