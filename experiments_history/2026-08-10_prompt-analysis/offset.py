"""Find exact byte offset of "2+2" and "3+3" in the JSON files."""
import json
from pathlib import Path

DIR = Path(__file__).parent

for fname in ["earlier.json", "later.json"]:
    raw_bytes = (DIR / fname).read_bytes()
    text = raw_bytes.decode("utf-8")
    print(f"=== {fname} === {len(raw_bytes):,} bytes total\n")

    # Find the user message content
    wrapper = json.loads(text)
    raw = wrapper["body"]
    body = json.loads(raw) if isinstance(raw, str) else raw
    msgs = body["messages"]
    user_msg = [m for m in msgs if m["role"] == "user"][0]
    user_text = user_msg["content"][0]["text"] if isinstance(user_msg["content"], list) else user_msg["content"]

    query = user_text.split("\n")[0]  # "2+2=?" or "3+3=?"
    print(f"  Query: '{query}'")

    # Find in raw text
    idx = text.find(query)
    if idx >= 0:
        pct = idx * 100.0 / len(text)
        before = text[max(0,idx-60):idx].replace("\n","\\n")
        after = text[idx:idx+120].replace("\n","\\n")
        print(f"  Offset: {idx:,} bytes ({pct:.1f}% into file)")
        print(f"  Before: ...{before}")
        print(f"  At:     {after}...")
        print(f"  After system wall: {idx:,} bytes = {idx//4:,} tokens of overhead before user question")
    print()
