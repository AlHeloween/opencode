"""What's in the 25K cache MISS? Check if tools count toward prompt_tokens."""
import json
from pathlib import Path

DIR = Path(__file__).parent
wrapper = json.loads((DIR / "earlier.json").read_text("utf-8"))
raw = wrapper["body"]
body = json.loads(raw) if isinstance(raw, str) else raw

# messages total
msgs = body["messages"]
msg_total = sum(len(json.dumps(m)) for m in msgs)
sys_total = sum(len(json.dumps(m)) for m in msgs if m["role"]=="system")
user_total = sum(len(json.dumps(m)) for m in msgs if m["role"]=="user")

# tools total  
tools_json = json.dumps(body.get("tools", []))
tools_len = len(tools_json)

# Whole body without tools
body_no_tools = {k: v for k, v in body.items() if k != "tools"}
body_no_tools_json = json.dumps(body_no_tools)

print(f"=== SIZE BREAKDOWN ===")
print(f"  messages total JSON:  {msg_total:,} bytes")
print(f"    system messages:    {sys_total:,} bytes")
print(f"    user message:       {user_total:,} bytes")
print(f"  tools JSON:           {tools_len:,} bytes")
print(f"  body w/o tools:       {len(body_no_tools_json):,} bytes")
print()

# DB says for 2+2: prompt_tokens=77,924  cache_hit=52,864  cache_miss=25,060
# Rough token estimate (chars/4):
total_est = len(json.dumps(body)) / 4
msg_est = msg_total / 4
tools_est = tools_len / 4
sys_est = sys_total / 4
user_est = user_total / 4

print(f"=== TOKEN ESTIMATES (÷4) ===")
print(f"  total body:      {total_est:,.0f}")
print(f"  messages:        {msg_est:,.0f}")
print(f"    system:        {sys_est:,.0f}")
print(f"    user:          {user_est:,.0f}")
print(f"  tools:           {tools_est:,.0f}")
print()

# DB numbers
cache_hit = 52864
cache_miss = 25060
prompt = 77924

print(f"=== DB REALITY ===")
print(f"  prompt_tokens:       {prompt}")
print(f"  cache_hit_tokens:    {cache_hit}")
print(f"  cache_miss_tokens:   {cache_miss}")
print(f"  miss/total:          {cache_miss/prompt*100:.0f}%")
print()
print(f"  cache_hit ≈ sys_msgs est:  {cache_hit:,} vs {sys_est:,.0f}  (diff: {cache_hit-sys_est:+,.0f})")
print(f"  cache_miss ≈ user+overhead:{cache_miss:,} vs {user_est+2000:,.0f}  (diff: {cache_miss-user_est-2000:+,.0f})")

# If tools count as prompt tokens, cache_miss should include them
miss_if_tools = cache_miss - tools_est
print(f"\n  If tools ARE in prompt_tokens: cache_miss - tools_est = {miss_if_tools:,.0f} tokens leftover")
print(f"  That leftover ≈ user msg:     {user_est:,.0f}")
if abs(miss_if_tools - user_est) < 1000:
    print(f"  ✅ MATCH — tools ARE counted in prompt_tokens and cache MISS")
else:
    print(f"  ❌ NO MATCH — tools may NOT be in prompt_tokens")
