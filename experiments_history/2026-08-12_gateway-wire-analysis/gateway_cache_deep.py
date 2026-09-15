"""
Deep dive: what changed in the problematic Request 2 (8→6, 50% cache).
Shows EXACTLY which messages differ and why.
"""
import json, glob
from pathlib import Path

GW = Path(".opencode/data/gateway/per-request")
reqs = sorted(GW.glob("*.json"))

# Load the problematic pair: Request 1→2 (which had 8→6 messages)
prev = json.loads(reqs[1].read_text(encoding="utf-8"))
curr = json.loads(reqs[2].read_text(encoding="utf-8"))

prev_msgs = prev.get("body", {}).get("messages", [])
curr_msgs = curr.get("body", {}).get("messages", [])

print(f"=== COMPACTION DETECTED ===")
print(f"Previous: {len(prev_msgs)} messages")
print(f"Current:  {len(curr_msgs)} messages")
print()

# Find which messages are the same (prefix) and which changed
stable = 0
for a, b in zip(prev_msgs, curr_msgs):
    if json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True):
        stable += 1
    else:
        break

print(f"Stable prefix: {stable} messages (same as before)")
print(f"Changed/different from position {stable}")
print()

# Show the messages side by side at the break point
print(f"--- Messages at position {stable} ---")
print(f"PREV [{prev_msgs[stable]['role']}]:")
content = prev_msgs[stable].get("content", "")
print(f"  content: {content[:150]}...")
print(f"  len: {len(content)} chars")

print(f"\nCURR [{curr_msgs[stable]['role']}]:")
content_c = curr_msgs[stable].get("content", "")
print(f"  content: {content_c[:150]}...")
print(f"  len: {len(content_c)} chars")

# Check if it's a compaction marker
for i, msg in enumerate(curr_msgs):
    role = msg.get("role", "?")
    content = str(msg.get("content", ""))
    if "COMPACTED" in content or "compaction" in content.lower():
        print(f"\n⚠️  COMPACTION MARKER at msg[{i}] ({role})")
        print(f"  {content[:200]}...")
    if "message*" in content or "summary" in content.lower():
        print(f"\n📋 POSSIBLE SUMMARY at msg[{i}] ({role}): {content[:100]}...")

# Show full role sequence
print(f"\n--- Message role sequence ---")
print(f"PREV: {[m['role'] for m in prev_msgs]}")
print(f"CURR: {[m['role'] for m in curr_msgs]}")
