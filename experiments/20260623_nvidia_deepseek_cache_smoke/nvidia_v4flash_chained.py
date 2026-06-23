"""
FINAL EXPERIMENT: NVIDIA deepseek-v4-flash chained conversation.
v4-pro is model-specifically 429'd, so we use v4-flash which responds 200 OK.
Same experiment structure as the DeepSeek DIRECT test for apples-to-apples comparison.
"""
import json, time, ssl, socket
from pathlib import Path

with open(Path(__file__).resolve().parents[2] / "bin" / "auth.json") as f:
    key = json.load(f)["nvidia"]["key"]

HOST = "integrate.api.nvidia.com"
MODEL = "deepseek-ai/deepseek-v4-flash"

SYSTEM = (
    "[NV-FLASH-EXPERIMENT]\n"
    "You are a helpful Python coding assistant.\n\n"
    + "RULES: Write clean Python, use type hints and docstrings.\n"
    + ("def placeholder(): pass  # padding\n" * 60)
)

TURN1 = "Write a Python function `fibonacci(n: int) -> int` that computes the nth Fibonacci number recursively."

TURN2 = "Now write the same Fibonacci function iteratively instead."

def call(messages: list, label: str) -> dict | None:
    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "max_tokens": 300,
        "temperature": 0,
        "stream": False,
        "chat_template_kwargs": {"thinking": True},
    }).encode()

    req = (
        f"POST /v1/chat/completions HTTP/1.1\r\n"
        f"Host: {HOST}\r\n"
        f"Authorization: Bearer {key}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Connection: close\r\n\r\n"
    ).encode() + body

    t0 = time.time()
    sock = socket.create_connection((HOST, 443), timeout=10)
    ssock = ssl.create_default_context().wrap_socket(sock, server_hostname=HOST)
    ssock.settimeout(60)
    ssock.sendall(req)

    resp = b""
    while True:
        try:
            chunk = ssock.recv(4096)
            if not chunk: break
            resp += chunk
        except socket.timeout: break
    ssock.close()

    elapsed = time.time() - t0
    text = resp.decode("utf-8", errors="replace")
    parts = text.split("\r\n\r\n", 1)
    if len(parts) > 1:
        try:
            result = json.loads(parts[1])
            result["_elapsed"] = elapsed
            result["_label"] = label
            return result
        except: pass
    print(f"  [{label}] PARSE ERROR ({elapsed:.1f}s): {text[:200]}")
    return None

def summary(resp, label):
    if not resp: return f"[{label}] NO RESPONSE"
    u = resp.get("usage", {})
    hit = u.get("prompt_cache_hit_tokens", 0)
    miss = u.get("prompt_cache_miss_tokens", 0)
    fp = resp.get("system_fingerprint", "")[:35]
    elapsed = resp.get("_elapsed", 0)
    pct = f"{(hit/(hit+miss)*100):.0f}%" if (hit+miss) > 0 else "N/A"
    return f"[{label}] total={u.get('total_tokens')} prompt={u.get('prompt_tokens')} hit={hit} miss={miss} hit%={pct} fp={fp} ({elapsed:.1f}s)"

print(f"Model: {MODEL}")
print(f"System chars: {len(SYSTEM)}")

# TURN 1
print("\n" + "#"*60)
print("# TURN 1: system + user")
print("#"*60)
t1 = call([
    {"role": "system", "content": SYSTEM},
    {"role": "user", "content": TURN1},
], "T1")
print(f"  {summary(t1, 'T1')}")
if t1:
    print(json.dumps(t1, indent=2, ensure_ascii=False)[:2000])
    assistant = t1["choices"][0]["message"]
    time.sleep(2)

    # TURN 2
    print("\n" + "#"*60)
    print("# TURN 2: system + user + assistant + user (prefix should hit cache)")
    print("#"*60)
    t2 = call([
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": TURN1},
        assistant,
        {"role": "user", "content": TURN2},
    ], "T2")
    print(f"  {summary(t2, 'T2')}")
    if t2:
        print(json.dumps(t2, indent=2, ensure_ascii=False)[:2000])

        # Compare
        print("\n" + "="*60)
        print("COMPARISON")
        print("="*60)
        u1, u2 = t1["usage"], t2["usage"]
        print(f"  T1: {u1['prompt_tokens']} prompt tokens, {t1['_elapsed']:.1f}s")
        print(f"  T2: {u2['prompt_tokens']} prompt tokens, {t2['_elapsed']:.1f}s")
        hit2 = u2.get('prompt_cache_hit_tokens', 0)
        miss2 = u2.get('prompt_cache_miss_tokens', 0)
        print(f"  T2 cache: hit={hit2} miss={miss2}")
        if hit2 > 0:
            print(f"  >>> NVIDIA CACHING WORKS ({hit2} tokens cached) <<<")
        else:
            print(f"  >>> NVIDIA NO CACHE (0 tokens cached) <<<")
        print(f"  T1 fp: {t1.get('system_fingerprint','')}")
        print(f"  T2 fp: {t2.get('system_fingerprint','')}")

print("\nDone.")
