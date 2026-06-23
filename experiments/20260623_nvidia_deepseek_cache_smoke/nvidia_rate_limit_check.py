"""Quick test: NVIDIA rate limit check + chat_template_kwargs test."""
import json, time, ssl, socket

with open("bin/auth.json") as f:
    key = json.load(f)["nvidia"]["key"]

HOST = "integrate.api.nvidia.com"
MODEL = "deepseek-ai/deepseek-v4-pro"

def send(body: dict, timeout_s: int = 60) -> tuple:
    data = json.dumps(body).encode("utf-8")
    req = (
        f"POST /v1/chat/completions HTTP/1.1\r\n"
        f"Host: {HOST}\r\n"
        f"Authorization: Bearer {key}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(data)}\r\n"
        f"Connection: close\r\n\r\n"
    ).encode() + data

    t0 = time.time()
    sock = socket.create_connection((HOST, 443), timeout=10)
    ssock = ssl.create_default_context().wrap_socket(sock, server_hostname=HOST)
    ssock.settimeout(timeout_s)
    ssock.sendall(req)

    resp = b""
    while True:
        try:
            chunk = ssock.recv(4096)
            if not chunk:
                break
            resp += chunk
        except socket.timeout:
            break
    ssock.close()
    elapsed = time.time() - t0

    text = resp.decode("utf-8", errors="replace")
    parts = text.split("\r\n\r\n", 1)
    if len(parts) > 1:
        status = parts[0].split("\r\n")[0]
        try:
            result = json.loads(parts[1])
            return status, result, elapsed
        except json.JSONDecodeError:
            return status, None, elapsed
    return "NO_RESPONSE", None, elapsed

print("Waiting 5s for rate limit reset...")
time.sleep(5)

# Test 1: With chat_template_kwargs (the required parameter)
print("\n[1] With chat_template_kwargs:")
status, r, elapsed = send({
    "model": MODEL,
    "messages": [{"role": "user", "content": "Say hi in one word"}],
    "max_tokens": 5,
    "temperature": 0,
    "stream": False,
    "chat_template_kwargs": {"thinking": True},
})
print(f"  {status} ({elapsed:.1f}s)")
if r and "usage" in r:
    u = r["usage"]
    print(f"  tokens={u.get('total_tokens')} hit={u.get('prompt_cache_hit_tokens',0)} miss={u.get('prompt_cache_miss_tokens',0)}")
    if "choices" in r:
        print(f"  content: {r['choices'][0]['message']['content'][:100]}")
elif r:
    print(f"  body: {json.dumps(r, indent=2)[:300]}")

# If successful, test 2: without chat_template_kwargs
if r and "usage" in r:
    print("\n[2] WITHOUT chat_template_kwargs (regression check):")
    status2, r2, elapsed2 = send({
        "model": MODEL,
        "messages": [{"role": "user", "content": "Say bye in one word"}],
        "max_tokens": 5,
        "temperature": 0,
        "stream": False,
    })
    print(f"  {status2} ({elapsed2:.1f}s)")
    if r2 and "usage" in r2:
        u = r2["usage"]
        print(f"  tokens={u.get('total_tokens')} hit={u.get('prompt_cache_hit_tokens',0)}")
        if "choices" in r2:
            print(f"  content: {r2['choices'][0]['message']['content'][:100]}")
    elif r2:
        print(f"  body: {json.dumps(r2, indent=2)[:300]}")

print("\nDone.")
