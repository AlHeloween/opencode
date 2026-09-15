#!/usr/bin/env python3
"""Inspect newest raw-wire captures: model, cache identifier, top-level keys.

Answers: does the current wire carry prompt_cache_key for GLM requests,
and what route (provider pin) do the newest bodies use?
"""

from __future__ import annotations

import glob
import json
import os

paths = sorted(glob.glob(os.path.join(".opencode", "data", "gateway", "raw-wire", "*.json")))[-8:]
print(f"newest {len(paths)} raw-wire captures:\n")
for path in paths:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    raw = str(data.get("body_raw", ""))
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"{os.path.basename(path)}: INVALID JSON ({error})")
        continue
    print(os.path.basename(path))
    print(f"  model:            {body.get('model')}")
    print(f"  prompt_cache_key: {body.get('prompt_cache_key')!r}")
    print(f"  provider:         {body.get('provider')!r}")
    print(f"  top-level keys:   {sorted(body.keys())}")
    print()
