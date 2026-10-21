#!/usr/bin/env python3
"""The disk guard: measure a scratch tree and FAIL LOUDLY over budget.

Run at task close (or from the hourly check). Exit code 1 = over budget, so a
robot or a CI step can stop on it; 0 = within budget; 2 = the tree is missing.

The measurement never follows a junction: on 2026-10-21 a robot copied a tree
with ``shutil.copytree`` over NTFS junctions and wrote 72.4 GB until drive D had
0 GB free. A size check that follows junctions measures the TARGET, not the
tree -- the number stops meaning what it claims to mean. See
``scripts/experiments_tree.py``.

Usage:
    python scripts/experiments_budget.py --root experiments
    python scripts/experiments_budget.py --root experiments --max-total-gb 2 --max-folder-gb 1
    python scripts/experiments_budget.py --root experiments --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from experiments_tree import walk  # noqa: E402

TOP_FILES = 15


def human(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(num) < 1024 or unit == "TB":
            return "%.2f %s" % (num, unit)
        num /= 1024
    return "%.2f TB" % num


def main(argv) -> int:
    parser = argparse.ArgumentParser(description="Junction-safe size budget for a scratch tree.")
    parser.add_argument("--root", default="experiments", help="tree to measure (default: experiments)")
    parser.add_argument("--max-total-gb", type=float, default=None, help="fail when the total exceeds this")
    parser.add_argument("--max-folder-gb", type=float, default=None, help="fail when ONE top-level folder exceeds this")
    parser.add_argument("--json", action="store_true", help="machine-readable report")
    args = parser.parse_args(argv)

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        sys.stderr.write("experiments_budget: not a directory: %s\n" % args.root)
        return 2

    tree, files = walk(root)
    folders = sorted(tree.children, key=lambda e: -e.total_bytes)
    largest = sorted(files, key=lambda f: -f[2])[:TOP_FILES]
    reparses = [entry for entry in tree.walk() if entry.reparse]

    breaches = []
    if args.max_total_gb is not None and tree.total_bytes > args.max_total_gb * (1024**3):
        breaches.append("total %s > budget %s" % (human(tree.total_bytes), human(args.max_total_gb * (1024**3))))
    if args.max_folder_gb is not None:
        limit = args.max_folder_gb * (1024**3)
        for folder in folders:
            if folder.total_bytes > limit:
                breaches.append("folder %r %s > budget %s" % (folder.name, human(folder.total_bytes), human(limit)))

    if args.json:
        print(json.dumps({
            "root": root,
            "total_bytes": tree.total_bytes,
            "total_files": tree.files,
            "folders": [{"name": f.name, "bytes": f.total_bytes, "files": f.files} for f in folders],
            "largest_files": [{"rel": rel, "bytes": size} for rel, _path, size in largest],
            "reparse_points": [{"rel": e.rel, "target": e.reparse_target} for e in reparses],
            "budget": {"max_total_gb": args.max_total_gb, "max_folder_gb": args.max_folder_gb},
            "breaches": breaches,
            "verdict": "OVER-BUDGET" if breaches else "within-budget",
        }, indent=2))
    else:
        print("root: %s" % root)
        print("total: %s (%d bytes, %d files)" % (human(tree.total_bytes), tree.total_bytes, tree.files))
        print("")
        print("%-52s %12s %10s" % ("entry", "size", "files"))
        print("-" * 78)
        for folder in folders:
            print("%-52s %12s %10d" % (folder.name[:52], human(folder.total_bytes), folder.files))
        print("")
        print("largest files:")
        for rel, _path, size in largest:
            print("  %12s  %s" % (human(size), rel))
        if reparses:
            print("")
            print("reparse points (NOT followed, NOT counted):")
            for entry in reparses:
                print("  %s -> %s" % (entry.rel, entry.reparse_target))
        print("")
        if breaches:
            print("OVER-BUDGET:")
            for breach in breaches:
                print("  %s" % breach)
        else:
            print("within budget")

    return 1 if breaches else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
