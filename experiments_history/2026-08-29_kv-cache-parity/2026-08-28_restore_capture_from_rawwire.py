#!/usr/bin/env python3
"""Restore a corrupted `!`-dir gateway capture from the canonical raw-wire file.

The `!`-dir double-write dropped the leading `{` on 7d5e1561, so its request
body is unparseable. The authoritative bytes live in
raw-wire/<ts>_<uuid>.json -> body_raw. This script re-derives the pretty
request body from there and overwrites the `!`-dir copy.
"""

from __future__ import annotations

import json
import os
import sys

PAIRS = [
    (
        r".opencode\data\gateway\raw-wire\2026-08-28T18-51-54-541Z-7d5e1561-0068-4713-8ac8-83134aa03e0d.json",
        r".opencode\data\gateway\per-response\!\2026-08-28T18-51-54-541Z-7d5e1561-0068-4713-8ac8-83134aa03e0d.json",
    ),
]


def restore(src: str, dst: str) -> None:
    with open(src, encoding="utf-8") as handle:
        data = json.load(handle)
    body_raw = str(data.get("body_raw", ""))
    if not body_raw:
        raise SystemExit(f"no body_raw in {src}")
    pretty = json.dumps(json.loads(body_raw), ensure_ascii=False, indent=2)
    with open(dst, "w", encoding="utf-8", newline="") as handle:
        handle.write(pretty)
        if not pretty.endswith("\n"):
            handle.write("\n")
    print(f"restored {os.path.getsize(dst):>9} bytes  {dst}")


def main() -> int:
    pairs = sys.argv[1:3] if len(sys.argv) >= 2 else PAIRS
    for src, dst in pairs:
        restore(src, dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
