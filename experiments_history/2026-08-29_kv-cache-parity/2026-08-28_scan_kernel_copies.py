#!/usr/bin/env python3
"""Scan gateway per-request captures: count kernel (system prompt) copies per request.

The kernel signature: the big system message starting with '# Semantic Vector (SV)'.
For each capture (newest first): timestamp, kernel copies, system bytes, body bytes.
Reveals when duplication started and which turns (incl. summaries) carry it.
"""

from __future__ import annotations

import glob
import hashlib
import json
import os

CAPTURE_DIR = os.path.join(".opencode", "data", "gateway", "per-request")
KERNEL_MARK = "Semantic Vector (SV)"

paths = sorted(glob.glob(os.path.join(CAPTURE_DIR, "*.json")))
print(f"scanning ALL {len(paths)} captures — transitions of kernel count:\n")
rows = []
for path in paths:
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        raw = str(data.get("body_raw", ""))
        if not raw:
            continue
        body = json.loads(raw)
    except Exception:  # noqa: BLE001 - diagnostic scanner
        continue
    messages = body.get("messages") or []
    systems = [m for m in messages if m.get("role") == "system"]
    kernel_copies = 0
    sys_bytes = 0
    for m in systems:
        content = m.get("content")
        text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
        sys_bytes += len(text)
        if KERNEL_MARK in text[:400]:
            kernel_copies += 1
    stamp = os.path.basename(path).split("_")[0]
    rows.append((stamp, kernel_copies, len(systems), sys_bytes, len(raw)))

# Print only transitions + first/last of each count
prev = None
for stamp, k, n, sb, rb in rows:
    if k != prev:
        print(f">>> kernels={k} starts at {stamp} (systems={n} sys_bytes={sb})")
        prev = k
print(f"\nlast capture: {rows[-1][0]} kernels={rows[-1][1]}")
