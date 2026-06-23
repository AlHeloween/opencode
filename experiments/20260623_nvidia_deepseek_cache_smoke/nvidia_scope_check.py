"""Final NVIDIA test: try different model + fresh key to isolate 429 scope."""
import json, time, ssl, socket

with open("bin/auth.json") as f:
    key = json.load(f)["nvidia"]["key"]

HOST = "integrate.api.nvidia.com"

def send(model: str, label: str):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Say hi"}],
        "max_tokens": 5, "temperature": 0, "stream": False,
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
    ssock.settimeout(30)
    ssock.sendall(req)

    resp = b""
    while True:
        try:
            chunk = ssock.recv(4096)
            if not chunk: break
            resp += chunk
        except socket.timeout: break
    ssock.close()

    text = resp.decode("utf-8", errors="replace")
    parts = text.split("\r\n\r\n", 1)
    status = parts[0].split("\r\n")[0] if parts else "???"
    elapsed = time.time() - t0
    print(f"  [{label}] {model}: {status} ({elapsed:.1f}s)")

# Test different models to see 429 scope
print("Testing which models are rate-limited:")
send("nvidia/nemotron-3-super-120b-a12b", "nemotron")
time.sleep(1)
send("deepseek-ai/deepseek-v4-pro", "deepseek-v4-pro")
time.sleep(1)
send("deepseek-ai/deepseek-v4-flash", "deepseek-v4-flash")
time.sleep(1)
send("meta/llama-3.3-70b-instruct", "llama")
time.sleep(1)
send("mistralai/mistral-large", "mistral")

print("\nIf only deepseek models are 429, it's model-specific throttling.")
print("If all are 429, it's account-level rate limit.")
