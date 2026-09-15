"""
Analyze gateway per-request/response diffs for cache and conversation insight.

Usage: python experiments/2026-08-12_gateway-wire-analysis/gateway_diff_analysis.py
"""
import json, glob, os, sys
from difflib import unified_diff
from pathlib import Path

GW = Path(".opencode/data/gateway")

def load_json_files(directory, pattern="*.json"):
    """Load all JSON files sorted by timestamp."""
    files = sorted(Path(directory).glob(pattern))
    results = []
    for f in files:
        try:
            results.append((f, json.loads(f.read_text(encoding="utf-8"))))
        except json.JSONDecodeError as e:
            print(f"  SKIP {f.name}: {e}")
    return results

def estimate_stable_prefix_size(body, prev_body):
    """Count how many messages are identical in the prefix (KV-cache relevant)."""
    msgs = body.get("messages", [])
    prev_msgs = prev_body.get("messages", [])
    same = 0
    for a, b in zip(msgs, prev_msgs):
        if json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True):
            same += 1
        else:
            break
    return same, len(prev_msgs), len(msgs)

def summarize_body(body):
    """Summary of request body for analysis."""
    msgs = body.get("messages", [])
    tools = body.get("tools", [])
    return {
        "model": body.get("model", "?"),
        "messages": len(msgs),
        "tools": len(tools),
        "max_tokens": body.get("max_tokens", "?"),
        "stream": body.get("stream", "?"),
    }

print("=" * 60)
print("GATEWAY DIFF ANALYSIS")
print("=" * 60)

# ── Per-request analysis ──
print("\n=== PER-REQUEST ===")
reqs = load_json_files(GW / "per-request")
print(f"Found {len(reqs)} request files\n")

for i, ((path, data), (prev_path, prev_data)) in enumerate(zip(reqs[1:], reqs), 1):
    body = data.get("body", {})
    prev_body = prev_data.get("body", {})
    
    same, prev_total, total = estimate_stable_prefix_size(body, prev_body)
    cache_hit_pct = (same / prev_total * 100) if prev_total else 0
    
    print(f"--- Request {i}: {path.name[:50]}...")
    print(f"  Messages: {prev_total} → {total}  (+{total - prev_total})")
    print(f"  Stable prefix: {same}/{prev_total} ({cache_hit_pct:.0f}% cacheable)")
    
    # What changed?
    added = total - prev_total
    if added > 0:
        new_msgs = body.get("messages", [])[prev_total:]
        for msg in new_msgs:
            role = msg.get("role", "?")
            content = str(msg.get("content", ""))[:80]
            print(f"  + {role}: {content}...")
    
    # Check if tools/model/max_tokens changed
    prev_sum = summarize_body(prev_body)
    curr_sum = summarize_body(body)
    diffs = []
    for k in ["model", "tools", "max_tokens", "stream"]:
        if prev_sum[k] != curr_sum[k]:
            diffs.append(f"{k}: {prev_sum[k]} → {curr_sum[k]}")
    if diffs:
        print(f"  ⚠️ STRUCTURAL CHANGE: {', '.join(diffs)}")
    else:
        print(f"  ✅ Structure identical (good for cache)")
    print()

# ── Per-response analysis ──
print("\n=== PER-RESPONSE ===")
resps = load_json_files(GW / "per-response")
print(f"Found {len(resps)} response files\n")

for i, ((path, data), (prev_path, prev_data)) in enumerate(zip(resps[1:], resps), 1):
    body = data.get("body", [])
    prev_body = prev_data.get("body", [])
    
    if isinstance(body, list) and isinstance(prev_body, list):
        # SSE: count chunks
        print(f"--- Response {i}: {path.name[:50]}...")
        print(f"  Type: SSE stream")
        print(f"  Chunks: {len(prev_body)} → {len(body)}")
        # Show first meaningful difference
        for j, (c, pc) in enumerate(zip(body, prev_body)):
            if c != pc:
                try:
                    cj = json.loads(c)
                    pcj = json.loads(pc)
                    cd = cj.get("choices", [{}])[0].get("delta", {})
                    pcd = pcj.get("choices", [{}])[0].get("delta", {})
                    cc = cd.get("content") or cd.get("reasoning_content", "")
                    pcc = pcd.get("content") or pcd.get("reasoning_content", "")
                    print(f"  Diff starts at chunk {j}: '{pcc}' → '{cc}'")
                except:
                    print(f"  Diff starts at chunk {j}")
                break
        print(f"  ⚠️ Response diffs are token-level SSE noise — not useful for analysis")
    else:
        # Non-streaming
        print(f"--- Response {i}: non-streaming, {len(str(body))} chars")

# ── Summary ──
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
if reqs:
    last_body = reqs[-1][1].get("body", {})
    msgs = last_body.get("messages", [])
    print(f"Last request: {len(msgs)} messages, model={last_body.get('model','?')}")
    # Show message roles
    roles = [m.get("role","?") for m in msgs]
    from collections import Counter
    rc = Counter(roles)
    print(f"Role distribution: {dict(rc)}")
    
    # Estimate token usage (rough: 4 chars ≈ 1 token)
    total_chars = sum(len(json.dumps(m)) for m in msgs)
    print(f"Total context: ~{total_chars} chars ≈ ~{total_chars//4} tokens")

print("\nDone.")
