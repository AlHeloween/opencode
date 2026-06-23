"""
Quick test: NVIDIA + chat_template_kwargs (the missing parameter).
Tests whether adding chat_template_kwargs unblocks the API.
"""
import json, time, ssl, socket
from pathlib import Path

AUTH_PATH = Path(__file__).resolve().parents[2] / "bin" / "auth.json"
with open(AUTH_PATH) as f:
    key = json.load(f)["nvidia"]["key"]

HOST = "integrate.api.nvidia.com"
MODEL = "deepseek-ai/deepseek-v4-pro"

SYSTEM = (
    "You are a helpful coding assistant.\n"
    + ("padding line to reach some tokens. " * 20)
)
USER = "What is 2+2? Reply with only the number."

def send(label: str, extra_fields: dict) -> dict | None:
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": USER},
        ],
        "max_tokens": 10,
        "temperature": 0,
        "stream": False,
        **extra_fields,
    }
    data = json.dumps(body).encode("utf-8")
    req = (
        f"POST /v1/chat/completions HTTP/1.1\r\n"
        f"Host: {HOST}\r\n"
        f"Authorization: Bearer {key}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(data)}\r\n"
        f"Connection: close\r\n"
        f"\r\n"
    ).encode() + data

    print(f"\n[{label}] Sending...")
    t0 = time.time()
    sock = socket.create_connection((HOST, 443), timeout=10)
    ctx = ssl.create_default_context()
    ssock = ctx.wrap_socket(sock, server_hostname=HOST)
    ssock.settimeout(30)
    ssock.sendall(req)

    resp = b""
    while True:
        try:
            chunk = ssock.recv(4096)
            if not chunk:
                break
            resp += chunk
        except socket.timeout:
            print(f"[{label}] TIMEOUT after {time.time()-t0:.1f}s")
            ssock.close()
            return None

    ssock.close()
    elapsed = time.time() - t0
    text = resp.decode("utf-8", errors="replace")
    parts = text.split("\r\n\r\n", 1)
    if len(parts) > 1:
        status = parts[0].split("\r\n")[0]
        body_text = parts[1]
        try:
            result = json.loads(body_text)
            result["_elapsed"] = elapsed
            result["_label"] = label
            return result
        except json.JSONDecodeError:
            print(f"[{label}] Non-JSON response ({elapsed:.1f}s): {body_text[:500]}")
            return None
    else:
        print(f"[{label}] No response ({elapsed:.1f}s)")
        return None

# ── Test 1: WITHOUT chat_template_kwargs (current opencode behavior) ────────
print("=" * 60)
print("TEST 1: WITHOUT chat_template_kwargs (baseline - expected timeout)")
print("=" * 60)
r1 = send("no-ctk", {"thinking": {"type": "enabled"}})
if r1:
    print(f"  SUCCESS! total={r1['usage']['total_tokens']} ({r1['_elapsed']:.1f}s)")
    print(json.dumps(r1, indent=2, ensure_ascii=False)[:1000])
else:
    print("  TIMEOUT (expected)")

# ── Test 2: WITH chat_template_kwargs ───────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 2: WITH chat_template_kwargs (the fix)")
print("=" * 60)
r2 = send("with-ctk", {
    "thinking": {"type": "enabled"},
    "chat_template_kwargs": {"thinking": True},
})
if r2:
    u = r2["usage"]
    print(f"  SUCCESS! total={u['total_tokens']} prompt={u['prompt_tokens']} "
          f"hit={u.get('prompt_cache_hit_tokens',0)} "
          f"miss={u.get('prompt_cache_miss_tokens',0)} "
          f"({r2['_elapsed']:.1f}s)")
    print(json.dumps(r2, indent=2, ensure_ascii=False)[:1500])
else:
    print("  TIMEOUT or ERROR")

# ── If Test 2 works, Test 3: chained conversation ──────────────────────────
if r2:
    print("\n" + "=" * 60)
    print("TEST 3: Chained conversation WITH chat_template_kwargs")
    print("=" * 60)

    # Turn 1
    t1_body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Write a Python function factorial(n) recursively."},
        ],
        "max_tokens": 300,
        "temperature": 0,
        "stream": False,
        "thinking": {"type": "enabled"},
        "chat_template_kwargs": {"thinking": True},
    }
    t1 = send("T1", t1_body)
    if t1:
        u1 = t1["usage"]
        print(f"  T1: total={u1['total_tokens']} hit={u1.get('prompt_cache_hit_tokens',0)} miss={u1.get('prompt_cache_miss_tokens',0)} ({t1['_elapsed']:.1f}s)")
        assistant = t1["choices"][0]["message"]

        time.sleep(2)

        # Turn 2
        t2_body = {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": "Write a Python function factorial(n) recursively."},
                assistant,
                {"role": "user", "content": "Now write it iteratively."},
            ],
            "max_tokens": 300,
            "temperature": 0,
            "stream": False,
            "thinking": {"type": "enabled"},
            "chat_template_kwargs": {"thinking": True},
        }
        t2 = send("T2", t2_body)
        if t2:
            u2 = t2["usage"]
            print(f"  T2: total={u2['total_tokens']} hit={u2.get('prompt_cache_hit_tokens',0)} miss={u2.get('prompt_cache_miss_tokens',0)} ({t2['_elapsed']:.1f}s)")
            hit = u2.get("prompt_cache_hit_tokens", 0)
            miss = u2.get("prompt_cache_miss_tokens", 0)
            pct = f"{(hit/(hit+miss)*100):.0f}%" if (hit+miss) > 0 else "N/A"
            print(f"  >>> CACHE: {'HIT' if hit > 0 else 'MISS'} — {hit}/{hit+miss} tokens ({pct}) <<<")

print("\nDone.")
