#!/usr/bin/env python3
"""Check parseability of raw-wire body_raw captures (wire-truth check)."""

from __future__ import annotations

import glob
import json
import sys

paths = sys.argv[1:] or sorted(glob.glob(r".opencode\data\gateway\raw-wire\*.json"))
bad = 0
for path in paths:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    raw = str(data.get("body_raw", ""))
    try:
        json.loads(raw)
        ok = "ok"
    except json.JSONDecodeError as error:
        ok = f"INVALID JSON: {error}"
        bad += 1
        print(f"{path}\n  len={len(raw)}  {ok}\n  head={raw[:120]!r}\n  tail={raw[-120:]!r}")
if not bad:
    print(f"all {len(paths)} body_raw parse clean")
