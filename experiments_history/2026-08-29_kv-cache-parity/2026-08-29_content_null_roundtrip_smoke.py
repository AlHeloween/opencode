#!/usr/bin/env python3
"""Content round-trip smoke: prove where assistant content "" dies into null.

Chain, all on REAL gateway captures (no guesses):
  1. per-response/*.raw.txt (exact SSE) -> accumulate delta.content -> ""
     (Z.AI deltas always carry content: "" on reasoning/text deltas)
  2. SDK body build: `content: text || null` (@openrouter/ai-sdk-provider
     dist/index.js:3204) -> JS falsy conflation -> null  [the birth]
  3. per-request/*.json -> assistant message content values on the wire now.

Re-run after rebuilding opencode (fix: adaptive-client rewriteReasoningContent
restores "" for null): step 3 must flip null -> "" on new turns.
"""
import glob
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GW = os.path.join(REPO, ".opencode", "data", "gateway")


def newest(pattern, n):
    files = glob.glob(os.path.join(GW, pattern))
    return sorted(files, key=os.path.getmtime)[-n:]


def step1_response_truth():
    """Accumulate delta.content from the newest SSE captures."""
    print("== step 1: provider truth (per-response SSE deltas) ==")
    verdict = None
    for path in newest(os.path.join("per-response", "*.raw.txt"), 3):
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = [ln for ln in fh.read().splitlines() if ln.startswith("data: ")]
        text_parts = []
        n_content_empty = n_content_null = n_content_text = 0
        for ln in lines:
            payload = ln[len("data: "):]
            if payload == "[DONE]":
                continue
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            for choice in chunk.get("choices", []):
                delta = choice.get("delta") or {}
                if "content" not in delta:
                    continue
                value = delta["content"]
                if value is None:
                    n_content_null += 1
                elif value == "":
                    n_content_empty += 1
                    text_parts.append(value)
                else:
                    n_content_text += 1
                    text_parts.append(value)
        accumulated = "".join(text_parts)
        name = os.path.basename(path)
        if n_content_empty or n_content_null:
            print(
                f"  {name}: content deltas: empty-string={n_content_empty} "
                f"null={n_content_null} text={n_content_text} -> accumulated={accumulated!r}"
            )
            if accumulated == "":
                verdict = 'input truth is "" (empty string), NOT null'
    print(f"  => {verdict or 'no reasoning deltas in sampled captures'}")
    return verdict


def step2_sdk_birth(truth):
    """Emulate the SDK body build: content: text || null."""
    print("== step 2: SDK body build (dist/index.js:3204 `content: text || null`) ==")
    if truth is None:
        print("  skipped (no accumulated \"\" input in sampled captures)")
        return
    text = ""  # what the SDK accumulated (step 1)
    wire_content = text or None  # JS `text || null`, falsy conflation
    print(f'  accumulated text = {text!r};  text || null -> {wire_content!r}')
    print(f'  => "" is DESTROYED into {wire_content!r} here (null != "" semantically)')


def step3_wire_state():
    """Assistant message content values in the newest outgoing bodies."""
    print("== step 3: wire state (per-request assistant message content) ==")
    nulls = empty = text = 0
    files = newest(os.path.join("per-request", "*.json"), 5)
    for path in files:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        for message in data.get("body", {}).get("messages", []):
            if message.get("role") != "assistant":
                continue
            value = message.get("content")
            if value is None:
                nulls += 1
            elif value == "":
                empty += 1
            else:
                text += 1
    print(
        f"  {len(files)} newest captures: assistant content -> null={nulls} "
        f'empty-string={empty} text={text}'
    )
    if nulls and not empty:
        print("  => pre-fix wire: nulls present (SDK birth) — rebuild required")
    elif empty:
        print('  => post-fix wire: "" restored — round-trip faithful')
    return nulls, empty


def main():
    if not os.path.isdir(GW):
        print(f"gateway capture dir not found: {GW} (enable perRequest debug)")
        return 1
    truth = step1_response_truth()
    step2_sdk_birth(truth)
    step3_wire_state()
    return 0


if __name__ == "__main__":
    sys.exit(main())
