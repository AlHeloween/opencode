#!/usr/bin/env python3
"""Focused wire analysis for the newest captures: per-request usage + raw-diff verdicts.

For each of the newest N raw-wire envelopes:
  - byte length of body_raw
  - matching per-response SSE -> prompt_tokens, cached_tokens, provider
  - raw-diff verdict vs the previous capture (prefix/suffix/delta)
Prints a chronological table to expose any cache reset and its divergence point.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 14
RAW_DIR = os.path.join(".opencode", "data", "gateway", "raw-wire")
RESP_DIR = os.path.join(".opencode", "data", "gateway", "per-response")


def load_usage(uuid: str) -> tuple[int, int, str]:
    matches = glob.glob(os.path.join(RESP_DIR, f"*{uuid}.json"))
    if not matches:
        return -1, -1, "?"
    with open(matches[0], encoding="utf-8") as handle:
        data = json.load(handle)
    raw = str(data.get("body_raw", ""))
    prompt = cached = -1
    provider = "?"
    for match in re.finditer(r"data: (\{.*\})", raw):
        try:
            chunk = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if chunk.get("provider"):
            provider = chunk["provider"]
        usage = chunk.get("usage")
        if usage:
            prompt = int(usage.get("prompt_tokens") or 0)
            cached = int((usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
    return prompt, cached, provider


def rawdiff(prev: str, curr: str) -> str:
    if prev == curr:
        return "identical"
    limit = min(len(prev), len(curr))
    start = 0
    while start < limit and prev[start] == curr[start]:
        start += 1
    end = 0
    while end < limit - start and prev[len(prev) - 1 - end] == curr[len(curr) - 1 - end]:
        end += 1
    inserted = len(curr) - len(prev)
    verdict = "pure-append" if start + end == len(prev) else "MUTATION"
    return f"{verdict} D@{start} d{inserted:+d}"


paths = sorted(glob.glob(os.path.join(RAW_DIR, "*.json")))[-COUNT:]
prev_raw = ""
print(f"{'time':<9}{'uuid':<9}{'bytes':>9}  {'verdict vs prev':<28}{'prompt':>8}{'cached':>8}{'hit%':>7}  provider")
for path in paths:
    name = os.path.basename(path)
    stamp, uuid = name[11:19], name[35:43]
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    raw = str(data.get("body_raw", ""))
    prompt, cached, provider = load_usage(uuid)
    verdict = rawdiff(prev_raw, raw) if prev_raw else "first"
    hit = cached / prompt * 100 if prompt > 0 else 0.0
    print(f"{stamp:<9}{uuid:<9}{len(raw):>9}  {verdict:<28}{prompt:>8}{cached:>8}{hit:>6.1f}%  {provider}")
    prev_raw = raw
