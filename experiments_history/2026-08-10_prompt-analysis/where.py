"""Show exactly where 2+2 and 3+3 sit in the payload."""
import json
from pathlib import Path

DIR = Path(__file__).parent

for fname in ["earlier.json", "later.json"]:
    wrapper = json.loads((DIR / fname).read_text("utf-8"))
    raw = wrapper["body"]
    body = json.loads(raw) if isinstance(raw, str) else raw
    messages = body["messages"]

    print(f"=== {fname} ===")
    print(f"  Total messages: {len(messages)}")
    for i, m in enumerate(messages):
        role = m["role"]
        content = m["content"]
        if isinstance(content, list):
            text = content[0].get("text", "[?]") if content else "[empty]"
        else:
            text = content
        preview = text[:100].replace("\n", "\\n")
        print(f"  [{i}] role={role}  len={len(text):,}  preview: {preview}...")
    print()
