#!/usr/bin/env python3
"""Dump role sequence + assistant KEY ORDER from the newest raw-wire bodies.

Answers: (1) do tool results follow their tool_calls assistant immediately?
(2) where does reasoning_content sit relative to tool_calls in serialization?
(3) where do image parts live?
"""

from __future__ import annotations

import glob
import json
import os

paths = sorted(glob.glob(os.path.join(".opencode", "data", "gateway", "raw-wire", "*.json")))[-2:]
for path in paths:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    body = json.loads(str(data["body_raw"]))
    print(os.path.basename(path))
    for index, message in enumerate(body["messages"]):
        role = message.get("role")
        extra = ""
        if role == "assistant":
            extra = f" keys={list(message.keys())}"
            if message.get("tool_calls"):
                names = [tc.get("function", {}).get("name") for tc in message["tool_calls"]]
                extra += f" tools={names}"
        elif role == "tool":
            serialized = json.dumps(message.get("content"), ensure_ascii=False)
            extra = f" id=..{str(message.get('tool_call_id'))[-6:]}{' IMG' if 'image_url' in serialized else ''}"
            extra += f" len={len(serialized)}"
        elif role == "user" and isinstance(message.get("content"), list):
            kinds = [part.get("type") for part in message["content"] if isinstance(part, dict)]
            extra = f" parts={kinds}"
        print(f"  #{index:>3} {role:<9}{extra}")
    print()
