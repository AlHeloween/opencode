"""Deep dive: compare system prompt slots across two requests."""
import json, os
from pathlib import Path

DIR = Path(__file__).parent
FILES = sorted(DIR.glob("*.json"))

def load_body(path):
    wrapper = json.loads(path.read_text("utf-8"))
    body = wrapper["body"]
    if isinstance(body, str):
        body = json.loads(body)
    return body, wrapper

bodies = []
for f in FILES:
    body, wrapper = load_body(f)
    bodies.append((f.name, body, wrapper))

# Compare system messages across the two requests
print("=== SYSTEM MESSAGE SLOTS ===\n")
for i in range(5):
    print(f"--- sys[{i}] ---")
    samples = []
    for name, body, _ in bodies:
        msgs = [m for m in body["messages"] if m["role"] == "system"]
        m = msgs[i]
        c = m["content"]
        if isinstance(c, list):
            text = c[0].get("text", "[no text]")
        else:
            text = c
        samples.append((name, text))

    t0 = samples[0][1]
    t1 = samples[1][1]

    print(f"  earlier: {len(t0):,} chars")
    print(f"  later:   {len(t1):,} chars")
    print(f"  identical: {t0 == t1}")
    print(f"  first 120: {t0[:120]}")
    print(f"  last  120: ...{t0[-120:]}")
    if len(t0) < 200:
        print(f"  FULL: {t0}")
    print()

# Key insight: are the TWO REQUESTS IDENTICAL?
b0 = bodies[0][1]
b1 = bodies[1][1]

# Compare top-level fields (ignore messages for now)
for k in ["model", "max_tokens", "thinking", "reasoning_effort", "stream"]:
    v0 = b0.get(k)
    v1 = b1.get(k)
    same = "SAME" if v0 == v1 else f"DIFF: {v0!r} vs {v1!r}"
    print(f"  {k}: {same}")

# Compare tools
t0_names = [t.get("function",{}).get("name","?") for t in b0.get("tools",[])]
t1_names = [t.get("function",{}).get("name","?") for t in b1.get("tools",[])]
print(f"\n  Tools: both {len(t0_names)} tools, identical: {t0_names == t1_names}")

# Compare user message
u0 = [m for m in b0["messages"] if m["role"] == "user"][0]
u1 = [m for m in b1["messages"] if m["role"] == "user"][0]
uc0 = u0["content"][0]["text"] if isinstance(u0["content"], list) else u0["content"]
uc1 = u1["content"][0]["text"] if isinstance(u1["content"], list) else u1["content"]
print(f"\n  User msg earlier: {len(uc0):,} chars — {uc0[:200]}")
print(f"  User msg later:   {len(uc1):,} chars — {uc1[:200]}")
print(f"  User msgs identical: {uc0 == uc1}")

# Diff: what's different between the two?
print(f"\n=== DIFF ===")
print(f"  Timestamp diff: {bodies[1][2]['timestamp'] - bodies[0][2]['timestamp']}ms")
print(f"  RequestId diff: {bodies[0][2]['requestId']} vs {bodies[1][2]['requestId']}")

# Sys[4] — the mutable tail — should have different session banners
s40 = [m for m in b0["messages"] if m["role"]=="system"][4]
s41 = [m for m in b1["messages"] if m["role"]=="system"][4]
c40 = s40["content"] if isinstance(s40["content"], str) else s40["content"][0]["text"]
c41 = s41["content"] if isinstance(s41["content"], str) else s41["content"][0]["text"]
print(f"\n  sys[4] (mutable tail) identical: {c40 == c41}")
if c40 != c41:
    print(f"  earlier sys[4]: {c40}")
    print(f"  later sys[4]:   {c41}")

print("\n=== SUMMARY ===")
total_sys_0 = sum(len((m["content"] if isinstance(m["content"],str) else m["content"][0]["text"])) for m in [x for x in b0["messages"] if x["role"]=="system"])
total_sys_1 = sum(len((m["content"] if isinstance(m["content"],str) else m["content"][0]["text"])) for m in [x for x in b1["messages"] if x["role"]=="system"])
print(f"  Total system prompt: {total_sys_0:,} chars (~{total_sys_0//4:,} tokens)")
print(f"  Kernel in slot[1]:   25,877 chars (~6,500 tokens)")
print(f"  Tool schemas slot[2]: 101,919 chars (~25,500 tokens) — BIGGEST")
print(f"  Path system slot[3]:  68,401 chars (~17,100 tokens)")
print(f"  Total overhead:       ~50K tokens before user message")
