"""Check actual key order in the HTTP body — which comes first?"""
import json
from pathlib import Path

DIR = Path(__file__).parent
wrapper = json.loads((DIR / "earlier.json").read_text("utf-8"))
raw = wrapper["body"]
body = json.loads(raw) if isinstance(raw, str) else raw

# Re-serialize to see the ORDER keys were written
body_str = raw if isinstance(raw, str) else json.dumps(body, indent=2)

# Find positions of top-level keys in the raw byte stream
keys_in_order = []
for k in body:
    idx = body_str.find(f'"{k}"')
    keys_in_order.append((idx, k))
keys_in_order.sort()

print("=== TOP-LEVEL KEY ORDER IN HTTP BODY ===")
for idx, k in keys_in_order:
    print(f"  byte {idx:>8,}:  \"{k}\"")
print()

# Also check: what does the JSON spec say about key order?
print("=== JSON SPEC ===")
print("RFC 7159: 'An object is an unordered collection of zero or more name/value pairs'")
print("BUT: JSON.stringify preserves insertion order in V8/Node/Bun.")
print()

# So the question is: does AI SDK put tools before or after messages?
# Let's dump the first 500 bytes to see
print("=== FIRST 500 BYTES OF HTTP BODY ===")
print(body_str[:600])
