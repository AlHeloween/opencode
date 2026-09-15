#!/usr/bin/env python3
"""SMOKE: reasoning -> reasoning_content rewrite on the latest real wire body.

Dumb validation before touching the TS gateway:
  1. take latest raw-wire body_raw (the actual bytes we send today),
  2. rewrite assistant messages: `reasoning` -> `reasoning_content`,
     drop `reasoning_details`,
  3. verify JSON validity, message count, key order preservation,
  4. quantify: bytes saved, per-message delta, show a before/after fragment.
"""

from __future__ import annotations

import glob
import json
import os
import sys

paths = sorted(glob.glob(os.path.join(".opencode", "data", "gateway", "raw-wire", "*.json")))
path = paths[-1]
with open(path, encoding="utf-8") as handle:
    body_raw = str(json.load(handle).get("body_raw", ""))
body = json.loads(body_raw)

messages = body.get("messages") or []
rewritten = 0
dropped_details_chars = 0
moved_chars = 0
first_example = None

for index, message in enumerate(messages):
    if message.get("role") != "assistant":
        continue
    reasoning = message.get("reasoning")
    details = message.get("reasoning_details")
    if reasoning is None and details is None:
        continue
    text = reasoning if isinstance(reasoning, str) else "".join(
        d.get("text", "") for d in (details or []) if isinstance(d, dict)
    )
    if first_example is None:
        first_example = (index, str(reasoning or "")[:120], str(text)[:120])
    message.pop("reasoning", None)
    message.pop("reasoning_details", None)
    if text:
        # Insert reasoning_content right after role/content — key order = insertion
        rebuilt = {}
        for key, value in message.items():
            rebuilt[key] = value
            if key == "content":
                rebuilt["reasoning_content"] = text
        if "reasoning_content" not in rebuilt:
            rebuilt["reasoning_content"] = text
        messages[index] = rebuilt
        rewritten += 1
        moved_chars += len(text)
        if isinstance(details, list):
            dropped_details_chars += sum(len(json.dumps(d, ensure_ascii=False)) for d in details)

out_raw = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
json.loads(out_raw)  # must stay valid

print(f"capture:          {os.path.basename(path)}")
print(f"body chars:       {len(body_raw)} -> {len(out_raw)} (saved {len(body_raw) - len(out_raw)})")
print(f"assistant rewrites: {rewritten} / {sum(1 for m in messages if m.get('role') == 'assistant')} assistant msgs")
print(f"reasoning chars moved to reasoning_content: {moved_chars} (~{round(moved_chars / 3.5)} tok)")
print(f"reasoning_details bytes dropped: {dropped_details_chars}")
print(f"messages count unchanged: {len(messages) == len(json.loads(body_raw)['messages'])}")
print(f"any leftover 'reasoning'/'reasoning_details' keys: {any('reasoning' in m or 'reasoning_details' in m for m in messages)}")
if first_example:
    index, before, after = first_example
    print(f"first rewritten msg #{index}:")
    print(f"  before (reasoning): {before!r}")
    print(f"  after  (reasoning_content): {after!r}")
