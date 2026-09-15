"""Extract structural heading map from all 5 system prompt slots."""
import json, re
from pathlib import Path

DIR = Path(__file__).parent
FILES = sorted(DIR.glob("*.json"))

body = None
for f in FILES:
    wrapper = json.loads(f.read_text("utf-8"))
    raw = wrapper["body"]
    body = json.loads(raw) if isinstance(raw, str) else raw
    break  # берём первый — они идентичны для sys[0-3]

sys_msgs = [m for m in body["messages"] if m["role"] == "system"]

for i, msg in enumerate(sys_msgs):
    content = msg["content"] if isinstance(msg["content"], str) else msg["content"][0]["text"]
    lines = content.split("\n")

    print(f"\n{'='*60}")
    print(f"sys[{i}] — {len(content):,} chars (~{len(content)//4:,} tokens)")
    print(f"{'='*60}")

    # Extract headings: ##, ###, #, XML tags
    headings = []
    for ln in lines:
        stripped = ln.strip()
        if stripped.startswith("### "):
            headings.append(("H3", stripped[4:].strip()))
        elif stripped.startswith("## "):
            headings.append(("H2", stripped[3:].strip()))
        elif stripped.startswith("# "):
            headings.append(("H1", stripped[2:].strip()))
        elif re.match(r"^<(/?)\w+", stripped):
            tag = re.match(r"^<(/?)(\w+)", stripped)
            if tag:
                depth = 1 if tag.group(1) else 0
                headings.append(("TAG", f"<{tag.group(2)}>"))

    if headings:
        for level, text in headings:
            indent = {"H1":"  ","H2":"    ","H3":"      ","TAG":"        "}.get(level, "  ")
            print(f"  {indent}{level} {text}")
    else:
        # For non-heading content, show first/last lines
        print(f"  (no headings)")
        print(f"  FIRST: {lines[0][:120]}")
        if len(lines) > 1:
            print(f"  LAST:  {lines[-1][:120]}")

print(f"\n{'='*60}")
print(f"TOTAL: {sum(len(m['content'] if isinstance(m['content'],str) else m['content'][0]['text']) for m in sys_msgs):,} chars")
