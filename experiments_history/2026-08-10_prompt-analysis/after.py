"""Show what's AFTER the user message in the payload."""
import json
from pathlib import Path

DIR = Path(__file__).parent

for fname in ["earlier.json"]:
    raw_bytes = (DIR / fname).read_bytes()
    text = raw_bytes.decode("utf-8")

    wrapper = json.loads(text)
    raw = wrapper["body"]
    body = json.loads(raw) if isinstance(raw, str) else raw
    msgs = body["messages"]
    user_msg = [m for m in msgs if m["role"] == "user"][0]
    user_text = user_msg["content"][0]["text"] if isinstance(user_msg["content"], list) else user_msg["content"]

    query = user_text.split("\n")[0]  # "2+2=?"
    idx_start = text.find(query)
    idx_end = idx_start + len(user_text)

    print(f"=== {fname} === {len(raw_bytes):,} bytes")
    print(f"  Query: '{query}' at offset {idx_start:,}")
    print(f"  User message content: {len(user_text):,} chars ({idx_start:,} → {idx_end:,})")
    print()

    # Full user message
    print(f"  === FULL USER MESSAGE ===")
    for i, ln in enumerate(user_text.split("\n")):
        print(f"  [{i:3d}] {ln[:140]}")
    print()

    # What comes after user message content in the file
    after_user = text[idx_end:]
    print(f"  === AFTER USER MESSAGE ({len(after_user):,} bytes) ===")

    # Parse the JSON structure after
    lines = after_user.split("\n")
    for ln in lines[:40]:
        print(f"  {ln[:200]}")
    if len(lines) > 40:
        print(f"  ... ({len(lines)} total lines)")

    # Also show: what are the top-level body keys AFTER messages?
    print(f"\n  === BODY KEYS AFTER messages ===")
    for k in body:
        v = body[k]
        if k == "messages":
            continue
        if isinstance(v, list):
            print(f"  {k}: [{len(v)} items]")
        elif isinstance(v, dict):
            print(f"  {k}: {{...{len(v)} keys}}")
        elif isinstance(v, str):
            print(f"  {k}: {v[:120]}")
        else:
            print(f"  {k}: {v}")
