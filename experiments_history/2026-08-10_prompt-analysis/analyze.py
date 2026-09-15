"""Analyze two per-request gateway JSONs — compare structure and content."""
import json, os, sys
from pathlib import Path

DIR = Path(__file__).parent
FILES = sorted(DIR.glob("*.json"))
print(f"Found {len(FILES)} JSONs")
for f in FILES:
    print(f"  {f.name} ({os.path.getsize(f):,} bytes)")

print("\n" + "="*60)

for f in FILES:
    print(f"\n### {f.name}")
    try:
        wrapper = json.loads(f.read_text("utf-8"))
    except Exception:
        print("  ERROR: not valid JSON!")
        continue

    print(f"  Wrapper keys: {list(wrapper.keys())}")
    body_raw = wrapper.get("body")
    if isinstance(body_raw, dict):
        body = body_raw
    elif isinstance(body_raw, str):
        try:
            body = json.loads(body_raw)
        except Exception:
            print(f"  ERROR: body is string but not parseable JSON ({len(body_raw)} chars)")
            print(f"  Body prefix: {body_raw[:200]}")
            continue
    else:
        print(f"  ERROR: body is {type(body_raw)}")
        continue

    print(f"  Body keys: {list(body.keys())}")
    print(f"  Model: {body.get('model')}")
    messages = body.get("messages", [])
    print(f"  Messages: {len(messages)}")

    # Role distribution
    roles = {}
    for m in messages:
        r = m.get("role", "?")
        roles[r] = roles.get(r, 0) + 1
    print(f"  Roles: {roles}")

    # Analyze system messages
    sys_msgs = [m for m in messages if m.get("role") == "system"]
    print(f"  System messages: {len(sys_msgs)}")

    for i, sm in enumerate(sys_msgs):
        content = sm.get("content")
        if isinstance(content, str):
            clen = len(content)
            has_gated = "GATED_WORKFLOW" in content
            has_smit = "Smit" in content
        elif isinstance(content, list) and len(content) > 0:
            text = content[0].get("text", "") if isinstance(content[0], dict) else str(content[0])
            clen = len(text)
            has_gated = "GATED_WORKFLOW" in text
            has_smit = "Smit" in text
        else:
            clen = 0
            has_gated = False
            has_smit = False
        print(f"    sys[{i}] len={clen:,} has_GATED={has_gated} has_Smit={has_smit}")

    # Check providerOptions on first system for cache markers
    if sys_msgs:
        po = sys_msgs[0].get("providerOptions")
        if po:
            print(f"    first sys providerOptions keys: {list(po.keys())}")
            oai = po.get("openaiCompatible", {})
            if oai:
                print(f"    openaiCompatible: {list(oai.keys())}")
                cc = oai.get("cache_control")
                if cc:
                    print(f"    cache_control: {cc}")

    # Top-level keys of interest
    for k in ["system", "tools", "temperature", "top_p", "max_tokens", "stream"]:
        v = body.get(k)
        if v is not None:
            if isinstance(v, (list,)):
                print(f"  {k}: [{len(v)} items]")
            elif isinstance(v, dict):
                print(f"  {k}: {{...{len(v)} keys}}")
            else:
                print(f"  {k}: {v}")

    # Tool count
    tools = body.get("tools")
    if isinstance(tools, list):
        tool_names = [t.get("name", "?") if isinstance(t, dict) else "?" for t in tools]
        print(f"  Tools ({len(tool_names)}): {', '.join(tool_names[:20])}{'...' if len(tool_names)>20 else ''}")

print("\n" + "="*60)
print("DONE")
