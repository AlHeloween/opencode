#!/usr/bin/env python3
"""E2 post-rebuild: x-session-id on the wire, canonical key order, cache warmup."""

from __future__ import annotations

import glob
import json
import os

reqs = sorted(glob.glob(os.path.join(".opencode", "data", "gateway", "per-request", "*.json")))
print(f"per-request captures: {len(reqs)} total; newest 2:\n")
for path in reqs[-2:]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    headers = data.get("headers") or {}
    sid = headers.get("x-session-id") or headers.get("X-Session-Id")
    print(os.path.basename(path))
    print(f"  x-session-id header: {sid if sid else 'ABSENT'}")
    body = data.get("body") or {}
    if isinstance(body, dict):
        body_sid = body.get("session_id")
        print(f"  body session_id:     {body_sid if body_sid else 'ABSENT'}")
        assistants = [
            (index, list(message.keys()))
            for index, message in enumerate(body.get("messages", []))
            if message.get("role") == "assistant"
        ]
        if assistants:
            canonical = all(
                "tool_calls" not in keys
                or "reasoning_content" not in keys
                or keys.index("reasoning_content") < keys.index("tool_calls")
                for _, keys in assistants
            )
            print(f"  assistants: {len(assistants)}, canonical order (reasoning before tools): {canonical}")
            print(f"  last assistant keys: {assistants[-1][1]}")
    print()

print("per-response usage (newest 2):")
for path in sorted(glob.glob(os.path.join(".opencode", "data", "gateway", "per-response", "*.json")))[-2:]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    raw = str(data.get("body_raw", ""))
    usage = None
    for line in raw.split("\n"):
        if line.startswith("data: ") and line.strip() != "data: [DONE]":
            try:
                chunk = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if isinstance(chunk, dict) and chunk.get("usage"):
                usage = chunk["usage"]
    provider = None
    for line in raw.split("\n"):
        if line.startswith("data: "):
            try:
                chunk = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if isinstance(chunk, dict) and chunk.get("provider"):
                provider = chunk["provider"]
                break
    details = (usage or {}).get("prompt_tokens_details") or {}
    print(os.path.basename(path))
    print(f"  provider={provider} prompt={usage.get('prompt_tokens') if usage else '?'} cached={details.get('cached_tokens')}")
