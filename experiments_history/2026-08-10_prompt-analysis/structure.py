"""Show the ACTUAL JSON structure — nesting levels, not flat."""
import json
from pathlib import Path

DIR = Path(__file__).parent
wrapper = json.loads((DIR / "earlier.json").read_text("utf-8"))
raw = wrapper["body"]
body = json.loads(raw) if isinstance(raw, str) else raw

print("=== TOP-LEVEL JSON STRUCTURE ===\n")
# Show keys and nesting
def show_structure(obj, indent=0, max_depth=3):
    prefix = "  " * indent
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "messages":
                print(f"{prefix}{k}: [{len(v)} messages — {sum(len(str(m)) for m in v):,} chars total]")
                for i, m in enumerate(v):
                    c = m.get("content","")
                    clen = len(c) if isinstance(c, str) else sum(len(p.get("text","")) for p in c if isinstance(p, dict))
                    print(f"{prefix}  [{i}] role={m['role']} content_len={clen:,}")
            elif k == "tools":
                names = [t.get("function",{}).get("name","?") for t in v]
                total = len(json.dumps(v))
                print(f"{prefix}{k}: [{len(v)} functions, {total:,} chars JSON]")
                if indent < max_depth:
                    for n in names[:5]:
                        print(f"{prefix}  - {n}")
                    if len(names) > 5:
                        print(f"{prefix}  ... +{len(names)-5} more")
            elif isinstance(v, (str, int, float, bool, type(None))):
                vs = str(v)[:120]
                print(f"{prefix}{k}: {vs}")
            elif isinstance(v, list):
                print(f"{prefix}{k}: [{len(v)} items]")
            elif isinstance(v, dict):
                if indent < max_depth:
                    print(f"{prefix}{k}:")
                    show_structure(v, indent+1, max_depth)
                else:
                    print(f"{prefix}{k}: {{...}}")
    elif isinstance(obj, list):
        print(f"{prefix}[{len(obj)} items]")

show_structure(body)

# Now: show that tools is a TOP-LEVEL sibling of messages, NOT inside messages
print("\n\n=== KEY INSIGHT ===")
print(f"messages is a top-level key with {len(body['messages'])} entries")
print(f"tools is a TOP-LEVEL sibling of messages — {len(body['tools'])} functions")
print(f"They are at the SAME nesting level:")
print(f"  body.messages  (array of message objects)")
print(f"  body.tools     (array of function definitions)")
print(f"  body.model     (string)")
print(f"  body.max_tokens (number)")
print()
print(f"Order in JSON doesn't matter — they're siblings, not parent/child.")
print(f"The HTTP body is a flat dict, not an ordered sequence.")

# What's the RAW wire format? Let's reconstruct
import json as j
reconstructed = json.loads(raw) if isinstance(raw, str) else raw
print(f"\nTop-level keys in order they appear in JSON:")
for k in reconstructed:
    print(f"  {k}")
