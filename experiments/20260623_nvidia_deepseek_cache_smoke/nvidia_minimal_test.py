"""Quick test: NVIDIA + DeepSeek V4 — try multiple formats and minimal request."""
import json, time, ssl, socket

with open("bin/auth.json") as f:
    key = json.load(f)["nvidia"]["key"]

HOST = "integrate.api.nvidia.com"
MODEL = "deepseek-ai/deepseek-v4-pro"

def try_request(label: str, body: dict, timeout_s: int = 45):
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

    print(f"\n[{label}] body keys: {list(body.keys())}")
    t0 = time.time()
    try:
        sock = socket.create_connection((HOST, 443), timeout=10)
        ctx = ssl.create_default_context()
        ssock = ctx.wrap_socket(sock, server_hostname=HOST)
        ssock.settimeout(timeout_s)
        ssock.sendall(req)
        resp = b""
        while True:
            try:
                chunk = ssock.recv(4096)
                if not chunk: break
                resp += chunk
            except socket.timeout:
                print(f"  TIMEOUT after {time.time()-t0:.1f}s")
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
                u = result.get("usage", {})
                print(f"  {status} ({elapsed:.1f}s) tokens={u.get('total_tokens','?')}"
                      f" hit={u.get('prompt_cache_hit_tokens',0)}")
                return result
            except json.JSONDecodeError:
                print(f"  {status} ({elapsed:.1f}s) non-JSON: {body_text[:200]}")
                return None
        else:
            print(f"  No response body ({elapsed:.1f}s)")
            return None
    except Exception as e:
        print(f"  Error: {e}")
        return None

# Only use non-reasoning for minimal test
BASE = {
    "model": MODEL,
    "messages": [{"role": "user", "content": "Say hi"}],
    "max_tokens": 5,
    "temperature": 0,
    "stream": False,
}

# Test 1: Absolute minimal (no reasoning, no extra fields)
try_request("minimal", {**BASE})

# Test 2: With chat_template_kwargs format from issue
try_request("ctk-v1", {**BASE, "chat_template_kwargs": {"enable_thinking": True, "thinking": True}})

# Test 3: With chat_template_kwargs thinking only
try_request("ctk-v2", {**BASE, "chat_template_kwargs": {"thinking": True}})

# Test 4: Use a non-DeepSeek model to check if API works at all
try_request("nemotron", {**{**BASE, "model": "nvidia/nemotron-3-super-120b-a12b"}})

print("\nDone.")
