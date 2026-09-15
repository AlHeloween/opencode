#!/usr/bin/env python3
"""Check whether stream thinking (bbd94ee6) entered the next outgoing chain (2b8dbbb4)."""

from __future__ import annotations

import json

path = r".opencode\data\gateway\raw-wire\2026-08-28T14-05-24-578Z-2b8dbbb4-2284-487d-9421-8cb59e5e1282.json"
data = json.load(open(path, encoding="utf-8"))
messages = json.loads(str(data["body_raw"]))["messages"]

assistants = [(i, m) for i, m in enumerate(messages) if m.get("role") == "assistant"]
print(f"assistant messages in chain: {len(assistants)}")

with_reasoning = [i for i, m in assistants if "reasoning" in m or "reasoning_details" in m]
print(f"with reasoning fields: {len(with_reasoning)} (tail indices: {with_reasoning[-5:]})")

index, last = assistants[-1]
print(f"LAST assistant (idx {index}) keys: {sorted(last.keys())}")
print(f"  reasoning len: {len(str(last.get('reasoning') or ''))}")
print(f"  reasoning_details entries: {len(last.get('reasoning_details') or [])}")
print(f"  has tool_calls: {'tool_calls' in last}")
print(f"  has reasoning_content key: {'reasoning_content' in last}")

# Distribution: reasoning on tool-call turns vs final-answer turns
tool_turns = sum(1 for _, m in assistants if "tool_calls" in m)
both = sum(1 for _, m in assistants if "tool_calls" in m and ("reasoning" in m or "reasoning_details" in m))
no_tool = len(assistants) - tool_turns
both_no_tool = sum(
    1 for _, m in assistants if "tool_calls" not in m and ("reasoning" in m or "reasoning_details" in m)
)
print(f"assistant with tool_calls: {tool_turns} (of them with reasoning: {both})")
print(f"assistant without tool_calls: {no_tool} (of them with reasoning: {both_no_tool})")
